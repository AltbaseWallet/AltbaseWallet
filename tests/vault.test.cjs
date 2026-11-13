'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const vault = require('../electron/vault.cjs')
const password = () => crypto.randomBytes(24).toString('base64')
async function fixture() {
  const phrase = (await vault.request('generatePhrase')).phrase, pass = password()
  const sealed = await vault.request('createWalletSecret', { phrase, password: pass })
  return { phrase, pass, sealed }
}
test('independent profile generation validates and decrypts without native coin libraries', async () => {
  const { phrase, pass, sealed } = await fixture()
  assert.ok((await vault.request('validatePhrase', { phrase })).isValid === 'true')
  const opened = await vault.request('decryptWalletSecret', { ...sealed, password: pass })
  // Do not use equality assertions that might print recovery values on failure.
  assert.ok(opened.phrase === phrase)
  assert.ok(!JSON.stringify(sealed).includes(phrase))
  assert.equal((await vault.request('verifyWalletPassword', { ...sealed, password: pass })).isValid, 'true')
})
test('incorrect passwords cannot verify or decrypt a profile', async () => {
  const { sealed } = await fixture(), wrong = password()
  assert.equal((await vault.request('verifyWalletPassword', { ...sealed, password: wrong })).isValid, 'false')
  await assert.rejects(vault.request('decryptWalletSecret', { ...sealed, password: wrong }), /Wrong password|damaged/)
})
test('modified ciphertext, tag, nonce and salt fail authentication', async () => {
  const { sealed, pass } = await fixture()
  for (const field of ['cipherText', 'iv', 'salt']) {
    const value = { ...sealed }, prefix = field === 'salt' ? 'fullnode-scrypt-v1:' : ''
    const bytes = Buffer.from(value[field].slice(prefix.length), 'base64'); bytes[0] ^= 1
    value[field] = prefix + bytes.toString('base64')
    await assert.rejects(vault.request('decryptWalletSecret', { ...value, password: pass }))
  }
  const value = { ...sealed }, bytes = Buffer.from(value.cipherText, 'base64'); bytes[bytes.length - 1] ^= 1
  value.cipherText = bytes.toString('base64')
  await assert.rejects(vault.request('decryptWalletSecret', { ...value, password: pass }))
})
test('each encryption uses an independent salt and nonce', async () => {
  const { phrase, pass, sealed } = await fixture()
  const other = await vault.request('createWalletSecret', { phrase, password: pass })
  assert.notEqual(other.iv, sealed.iv); assert.notEqual(other.salt, sealed.salt); assert.notEqual(other.cipherText, sealed.cipherText)
})
test('invalid formats, invalid phrases and missing acknowledgements fail without echoing inputs', async () => {
  const marker = 'INVALID_PRIVATE_INPUT'
  await assert.rejects(vault.request('createWalletSecret', { phrase: marker, password: password() }), e => !e.message.includes(marker))
  const phrase = (await vault.request('generatePhrase')).phrase
  await assert.rejects(vault.request('createWalletSecret', { phrase, password: password(), requirePhraseAcknowledgement: true }), /acknowledgement/)
  await assert.rejects(vault.request('decryptWalletSecret', { salt: 'not-supported', password: password() }), /format/)
  assert.equal((await vault.request('verifyWalletPassword', { verifyHash: 'bad', verifySalt: 'bad', password: marker })).isValid, 'false')
})
