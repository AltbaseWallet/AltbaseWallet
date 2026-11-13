'use strict'
// Independent FullNode profile format. No production-wallet source or profile
// is used here. BIP39 and the cryptographic primitives come from maintained
// libraries; this module only defines storage and IPC conventions.
const crypto = require('node:crypto')
const { promisify } = require('node:util')
const { generateMnemonic, validateMnemonic } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english')
const scrypt = promisify(crypto.scrypt)
const METHODS = new Set(['health', 'generatePhrase', 'validatePhrase', 'createWalletSecret', 'verifyWalletPassword', 'decryptWalletSecret'])
const PREFIX = 'fullnode-scrypt-v1:'
const AAD = Buffer.from('AltbaseFullNode:profile:v1')
const normalize = phrase => typeof phrase === 'string' && phrase.length <= 256 ? phrase.normalize('NFKD').trim().toLowerCase().replace(/\s+/g, ' ') : ''
const validPhrase = phrase => phrase.split(' ').length === 12 && validateMnemonic(phrase, wordlist)
const passwordValue = value => {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value) > 1024) throw Error('Invalid wallet password')
  return value
}
const decode = (text, length, max = length) => {
  if (typeof text !== 'string' || text.length > max * 2 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw Error('Invalid encrypted profile')
  const buffer = Buffer.from(text, 'base64')
  if (buffer.length < length || buffer.length > max || buffer.toString('base64') !== text) throw Error('Invalid encrypted profile')
  return buffer
}
const decodeSalt = value => {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) throw Error('Unsupported profile encryption format')
  return decode(value.slice(PREFIX.length), 16)
}
const derive = (password, salt) => scrypt(passwordValue(password), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
const proof = key => crypto.createHash('sha256').update(key.subarray(32)).digest()
async function request(method, params = {}) {
  if (!METHODS.has(method)) throw Error('Unsupported vault operation')
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('Invalid vault parameters')
  if (method === 'health') return { backend: 'altbase-fullnode', vault: 'scrypt-aes256gcm-v1', ok: 'true' }
  if (method === 'generatePhrase') return { phrase: generateMnemonic(wordlist, 128) }
  if (method === 'validatePhrase') return { isValid: String(validPhrase(normalize(params.phrase))) }
  if (method === 'createWalletSecret') {
    const phrase = normalize(params.phrase)
    if (!validPhrase(phrase)) throw Error('Invalid recovery phrase')
    if ([true, 'true'].includes(params.requirePhraseAcknowledgement) && ![true, 'true'].includes(params.phraseAcknowledged)) throw Error('Recovery phrase acknowledgement is required')
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12)
    const key = await derive(params.password, salt)
    const plain = Buffer.from(phrase)
    try {
      const cipher = crypto.createCipheriv('aes-256-gcm', key.subarray(0, 32), iv, { authTagLength: 16 })
      cipher.setAAD(AAD)
      const sealed = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()])
      return { cipherText: sealed.toString('base64'), iv: iv.toString('base64'), salt: PREFIX + salt.toString('base64'),
        verifySalt: PREFIX + salt.toString('base64'), verifyHash: proof(key).toString('base64') }
    } finally { key.fill(0); plain.fill(0) }
  }
  if (method === 'verifyWalletPassword') {
    try {
      const expected = decode(params.verifyHash, 32), key = await derive(params.password, decodeSalt(params.verifySalt))
      try { return { isValid: String(crypto.timingSafeEqual(proof(key), expected)) } }
      finally { key.fill(0) }
    } catch { return { isValid: 'false' } }
  }
  const salt = decodeSalt(params.salt), iv = decode(params.iv, 12), sealed = decode(params.cipherText, 17, 512)
  const key = await derive(params.password, salt)
  let plain
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key.subarray(0, 32), iv, { authTagLength: 16 })
    decipher.setAAD(AAD); decipher.setAuthTag(sealed.subarray(-16))
    // Do not expose unauthenticated decipher.update output before final passes.
    const first = decipher.update(sealed.subarray(0, -16))
    try { plain = Buffer.concat([first, decipher.final()]) }
    finally { first.fill(0) }
    const phrase = plain.toString('utf8')
    if (!validPhrase(phrase)) throw Error('Invalid encrypted profile')
    return { phrase }
  } catch { throw Error('Wrong password or damaged encrypted profile') }
  finally { key.fill(0); plain?.fill(0) }
}
module.exports = { request, supports: method => METHODS.has(method) }
