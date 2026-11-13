'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { NativeCoreClient } = require('../electron/native-core-client.cjs')
const { requestProfileVault } = require('../electron/profile-vault.cjs')
const { entropyToMnemonic, validateMnemonic } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english')
const root = path.resolve(__dirname, '..')
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-source-vault-'))
  const current = new NativeCoreClient({ isPackaged: false, getPath: () => directory }, 'source-vault', { executableName: 'altbase_vault_bridge' })
  t.after(() => { current.stop(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { current, directory }
}
test('the rebuilt source generates standard BIP39 phrases, validates checksums and rejects invalid phrases through the vault router', async t => {
  const { current } = fixture(t)
  let nativeCalls = 0
  const call = (method, params) => { nativeCalls++; return current.request(method, params) }
  const health = await requestProfileVault('health', {}, call)
  assert.equal(health.service, 'altbase-vault')
  for (let i = 0; i < 12; i++) {
    const { phrase } = await requestProfileVault('generatePhrase', {}, call)
    assert.ok(validateMnemonic(phrase, wordlist), 'Native generation must match the independent wordlist/checksum')
    assert.equal((await requestProfileVault('validatePhrase', { phrase }, call)).isValid, 'true')
  }
  for (const phrase of ['invalid', new Array(12).fill('not-a-word').join(' ')]) {
    assert.equal((await requestProfileVault('validatePhrase', { phrase }, call)).isValid, 'false')
  }
  assert.equal(nativeCalls, 27)
})
test('source-built vault interoperates with the released native library and independently verified AES-GCM/PBKDF2 ciphertext', async t => {
  const { current, directory } = fixture(t)
  const legacy = require('./fixtures/released-vault-envelope.json')
  const publicPhrase = entropyToMnemonic(Buffer.from(legacy.entropyHex, 'hex'), wordlist)
  assert.ok((await current.request('decryptWalletSecret', { ...legacy.sealed, password: legacy.password })).phrase === publicPhrase, 'The source-built decoder must read a released-format fixture without printing the phrase')
  assert.equal((await current.request('verifyWalletPassword', { ...legacy.sealed, password: legacy.password })).isValid, 'true')
  const baseline = path.join(root, 'local-checks/vault-source-2026-11-11/baseline/linux-x64')
  let old
  if (fs.existsSync(path.join(baseline, 'libaltbase_wallet_vault.so'))) {
    fs.copyFileSync(path.join(root, 'native-core/altbase_vault_bridge'), path.join(directory, 'altbase_vault_bridge'))
    fs.chmodSync(path.join(directory, 'altbase_vault_bridge'), 0o755)
    fs.copyFileSync(path.join(baseline, 'libaltbase_wallet_vault.so'), path.join(directory, 'libaltbase_wallet_vault.so'))
    old = new NativeCoreClient({ isPackaged: false, getPath: () => directory }, 'released-vault')
    old.corePath = () => path.join(directory, 'altbase_vault_bridge')
    t.after(() => old.stop())
  }
  const phrase = entropyToMnemonic(new Uint8Array(16), wordlist), password = 'Offline-' + crypto.randomBytes(16).toString('hex') + '-Ж🔒'
  for (const [creator, reader] of old ? [[old, current], [current, old]] : [[current, current]]) {
    const sealed = await creator.request('createWalletSecret', { phrase, password, requirePhraseAcknowledgement: 'true', phraseAcknowledged: 'true' })
    assert.ok((await reader.request('decryptWalletSecret', { ...sealed, password })).phrase === phrase, 'Cross-version plaintext must match without being printed')
    assert.equal((await reader.request('verifyWalletPassword', { ...sealed, password })).isValid, 'true')
    assert.equal((await reader.request('verifyWalletPassword', { ...sealed, password: password + 'wrong' })).isValid, 'false')
    const key = crypto.pbkdf2Sync(password, Buffer.from(sealed.salt, 'base64'), 310000, 32, 'sha256')
    const cipher = Buffer.from(sealed.cipherText, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
    decipher.setAuthTag(cipher.subarray(-16))
    assert.ok(Buffer.concat([decipher.update(cipher.subarray(0, -16)), decipher.final()]).toString() === phrase, 'Independent AES-GCM decryption must match')
    key.fill(0)
    await assert.rejects(reader.request('decryptWalletSecret', { ...sealed, password: password + 'wrong' }), () => true)
    const changed = Buffer.from(sealed.cipherText, 'base64'); changed[changed.length - 1] ^= 1
    await assert.rejects(reader.request('decryptWalletSecret', { ...sealed, cipherText: changed.toString('base64'), password }), () => true)
  }
  await assert.rejects(current.request('createWalletSecret', { phrase, password, requirePhraseAcknowledgement: 'true', phraseAcknowledged: 'false' }), () => true)
})
test('Zano and EPIC privacy scope derivation matches the released bridge without accessing a wallet or network', async t => {
  const { current, directory } = fixture(t)
  const previous = new NativeCoreClient({ isPackaged: false, getPath: () => directory }, 'released-scope')
  t.after(() => previous.stop())
  const phrase = entropyToMnemonic(new Uint8Array(16).fill(7), wordlist)
  for (const coin of ['zano', 'epic']) {
    const a = await current.request('privacyScope', { coin, phrase }), b = await previous.request('privacyScope', { coin, phrase })
    assert.ok(['enginePassword', 'scope', 'payload'].every(key => typeof a[key] === 'string' && a[key] === b[key]), 'Private scope fields must match without being printed')
  }
})
