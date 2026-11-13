'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { profileLayout, hasProfileStorage } = require('../electron/profile-layout.cjs')
const { requestProfileVault } = require('../electron/profile-vault.cjs'), vault = require('../electron/vault.cjs')
const { NativeCoreClient } = require('../electron/native-core-client.cjs')
const { bundle } = require('./bundle-helper.cjs')

test('released profile locations are shared and module code is independent of profile selection', () => {
  const root = path.join(os.tmpdir(), 'application-data')
  assert.equal(profileLayout(root).userData, path.join(root, 'Altbase'))
  assert.equal(profileLayout(root, 'Wallet1').userData, path.join(root, 'Altbase Profiles/wallet1'))
  assert.equal(profileLayout(root, '', true).userData, path.join(root, 'AltbaseFullNode'))
  assert.equal(profileLayout(root, 'Wallet1', true).userData, path.join(root, 'AltbaseFullNode Profiles/wallet1'))
  assert.equal(profileLayout(root, 'Wallet1').modules, profileLayout(root, 'Wallet2', true).modules)
  assert.throws(() => profileLayout(root, '../outside'))
})

test('a common module directory alone does not hide a previous default wallet during migration', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-profile-storage-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'modules'))
  assert.equal(hasProfileStorage(directory), false)
  fs.writeFileSync(path.join(directory, 'Local State'), '{}')
  assert.equal(hasProfileStorage(directory), true)
})

test('released native envelopes and previous working-copy envelopes unlock through one vault router', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-vault-compat-'))
  const client = new NativeCoreClient({ isPackaged: false, getPath: () => directory }, 'offline-vault-test')
  t.after(() => { client.stop(); fs.rmSync(directory, { recursive: true, force: true }) })
  const phrase = (await vault.request('generatePhrase')).phrase, password = crypto.randomBytes(24).toString('hex')
  const native = (method, params) => client.request(method, params)
  const sealed = await requestProfileVault('createWalletSecret', { phrase, password, requirePhraseAcknowledgement: 'false' }, native)
  assert.ok(!sealed.salt.startsWith('fullnode-scrypt-v1:'))
  assert.ok((await native('decryptWalletSecret', { ...sealed, password })).phrase === phrase)
  assert.ok((await requestProfileVault('decryptWalletSecret', { ...sealed, password }, native)).phrase === phrase)
  assert.equal((await requestProfileVault('verifyWalletPassword', { ...sealed, password }, native)).isValid, 'true')
  assert.equal((await requestProfileVault('verifyWalletPassword', { ...sealed, password: password + 'wrong' }, native)).isValid, 'false')
  const previous = await vault.request('createWalletSecret', { phrase, password })
  const forbiddenNative = () => { throw Error('Local working-copy envelopes must not reach the native decoder') }
  assert.ok((await requestProfileVault('decryptWalletSecret', { ...previous, password }, forbiddenNative)).phrase === phrase)
  assert.equal((await requestProfileVault('verifyWalletPassword', { ...previous, password }, forbiddenNative)).isValid, 'true')
  await assert.rejects(requestProfileVault('decryptWalletSecret', { ...sealed, password: password + 'wrong' }, native), /Wrong password/)
})

async function storageFixture(values, fail = () => false) {
  const data = new Map(Object.entries(values)), object = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { if (fail(key)) throw Error('fixture quota'); data.set(key, value) },
    removeItem: key => data.delete(key), key: index => [...data.keys()][index] ?? null,
    get length() { return data.size },
  }
  const storage = new Proxy(object, { ownKeys: () => [...data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) })
  const api = await bundle('src/services/storageService.ts', {}, { localStorage: storage })
  return { api: api.storageService, data }
}

test('namespace import preserves encrypted originals and brings addresses and scoped cache together', async () => {
  const values = {
    'altbase_fullnode:wallet-meta': '{"isCreated":true,"fixture":"encrypted"}',
    'altbase_fullnode:wallet-addresses': '{"fixture":"PUBLIC_FIXTURE"}',
    'altbase_fullnode:coins:wf-fixture': '[{"id":"fixture","balance":"12"}]',
  }
  const { api, data } = await storageFixture(values)
  assert.equal(api.get('wallet-meta', null).isCreated, true)
  for (const [key, value] of Object.entries(values)) {
    assert.equal(data.get(key), value)
    assert.equal(data.get(key.replace('altbase_fullnode:', 'altbase_wallet:')), value)
  }
  api.clear()
  assert.equal(api.get('wallet-meta', null), null, 'Clearing must not resurrect an encrypted backup namespace')
})

test('a populated released wallet is never mixed with another working-copy wallet', async () => {
  const { api, data } = await storageFixture({
    'altbase_wallet:wallet-meta': '{"wallet":"released"}',
    'altbase_wallet:wallet-addresses': '{"fixture":"RELEASED_PUBLIC"}',
    'altbase_fullnode:wallet-meta': '{"wallet":"previous"}',
    'altbase_fullnode:wallet-addresses': '{"fixture":"PREVIOUS_PUBLIC"}',
    'altbase_fullnode:coins:wf-previous': '[{"id":"fixture","balance":"99"}]',
  })
  assert.equal(api.get('wallet-meta', null).wallet, 'released')
  assert.equal(api.get('wallet-addresses', {}).fixture, 'RELEASED_PUBLIC')
  assert.equal(data.has('altbase_wallet:coins:wf-previous'), false)
  assert.equal(data.has('altbase_fullnode:wallet-meta'), true)
})

test('failed namespace import rolls back and keeps the complete original profile for retry', async () => {
  let failing = true
  const { api, data } = await storageFixture({
    'altbase_fullnode:wallet-meta': '{"isCreated":true}',
    'altbase_fullnode:wallet-addresses': '{"fixture":"PUBLIC_FIXTURE"}',
  }, key => { if (failing && key === 'altbase_wallet:wallet-addresses') { failing = false; return true } return false })
  assert.throws(() => api.get('wallet-meta', null), /original data was retained/)
  assert.equal(data.has('altbase_wallet:wallet-meta'), false)
  assert.equal(data.has('altbase-profile-namespace-migrated-v1'), false)
  assert.equal(api.get('wallet-meta', null).isCreated, true)
  assert.equal(api.get('wallet-addresses', {}).fixture, 'PUBLIC_FIXTURE')
})
