'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const tar = require('tar')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const { ModuleUpdater, readActive } = require('../electron/plugins/updater.cjs')
const { signCatalog, verifyCatalog } = require('../electron/plugins/catalog.cjs')
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-delivery-')), managed = path.join(root, 'managed'), assets = new Map()
  const pair = crypto.generateKeyPairSync('ed25519'), privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' })
  const manager = new PluginManager({ bundledRoot: path.join(root, 'bundled'), installedRoots: [path.join(root, 'installed')], managedRoot: managed, dataRoot: path.join(root, 'data'), hostPath: '/unused' })
  t.after(() => { manager.closeSessions(); fs.rmSync(root, { recursive: true, force: true }) })
  await manager.discover()
  async function archive(version, { broken = false } = {}) {
    const dir = path.join(root, 'source-' + version), coin = path.join(dir, 'unit')
    fs.mkdirSync(coin, { recursive: true })
    fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify({ schemaVersion: 1, id: 'unit-package', version, modules: [{ id: 'unit-coin', directory: 'unit' }] }))
    fs.writeFileSync(path.join(coin, 'manifest.json'), JSON.stringify({ schemaVersion: 1, abiVersion: 1, id: 'unit-coin', name: 'Delivery fixture', ticker: 'UNIT', version, kind: 'account', networkId: 'unit-mainnet', decimals: 8,
      capabilities: ['derive', 'validate', 'snapshot', 'nodeRequest'], runtime: { type: 'javascript', entry: 'index.cjs' } }))
    fs.writeFileSync(path.join(coin, 'index.cjs'), broken ? 'throw Error("offline broken package")' : `exports.createPlugin = async () => ({ request: async method => method === 'validate' ? true : '${version}' })`)
    const filename = path.join(root, version + '.tar.gz'); await tar.c({ cwd: dir, file: filename, gzip: true }, ['bundle.json', 'unit'])
    const data = fs.readFileSync(filename), url = 'https://modules.example/' + version
    assets.set(url, data)
    return { id: 'unit-package', name: 'Fixture', version, coins: ['unit-coin'], packages: { any: { url, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length } } }
  }
  function catalog(modules, issued = new Date().toISOString()) {
    const payload = { schemaVersion: 1, application: 'altbase-fullnode', issuedAt: issued, expiresAt: new Date(Date.parse(issued) + 3600000).toISOString(), modules }
    const envelope = signCatalog(payload, privateKey)
    assets.set('https://modules.example/catalog', Buffer.from(JSON.stringify(envelope)))
    return envelope
  }
  const updater = new ModuleUpdater({ manager, root: managed, walletVersion: '0.1.2', config: { url: 'https://modules.example/catalog', publicKey }, fetchBytes: async url => { assert.ok(assets.has(url)); return assets.get(url) } })
  return { root, managed, manager, updater, archive, catalog, publicKey, assets }
}
test('signed backend catalog installs a new coin and updates it without rebuilding, preserving module state', async t => {
  const f = await fixture(t)
  f.catalog([await f.archive('1.0.0')])
  assert.equal((await f.updater.check()).changed, true)
  assert.equal(await f.manager.request('unit-coin', 'derive'), '1.0.0')
  fs.writeFileSync(path.join(f.root, 'data/unit-coin/public-scan.json'), '{"height":42}')
  f.catalog([await f.archive('1.1.0')])
  assert.equal((await f.updater.check()).changed, true)
  assert.equal(await f.manager.request('unit-coin', 'derive'), '1.1.0')
  assert.equal(fs.readFileSync(path.join(f.root, 'data/unit-coin/public-scan.json'), 'utf8'), '{"height":42}')
  assert.equal((await f.updater.check()).changed, false)
  assert.equal(readActive(f.managed).packages['unit-package'].version, '1.1.0')
})
test('upgrading the wallet past a downloaded module keeps the newer bundled coin and its saved state', async t => {
  const f = await fixture(t)
  f.catalog([await f.archive('1.0.0')]); await f.updater.check()
  await f.manager.request('unit-coin', 'validate', { address: 'public-fixture' })
  fs.writeFileSync(path.join(f.root, 'data/unit-coin/public-scan.json'), '{"height":42}')
  await f.archive('1.2.0')
  fs.cpSync(path.join(f.root, 'source-1.2.0/unit'), path.join(f.root, 'bundled/unit'), { recursive: true })
  const catalog = await f.manager.discover()
  assert.deepEqual(catalog.diagnostics, [])
  assert.equal(catalog.modules.find(m => m.id === 'unit-coin').version, '1.2.0')
  assert.equal(await f.manager.request('unit-coin', 'derive'), '1.2.0')
  assert.equal(fs.readFileSync(path.join(f.root, 'data/unit-coin/public-scan.json'), 'utf8'), '{"height":42}')
  f.catalog([await f.archive('1.3.0')]); assert.equal((await f.updater.check()).changed, true)
  assert.equal(await f.manager.request('unit-coin', 'derive'), '1.3.0')
})
test('tampered catalog, archive and broken factory never replace the working module', async t => {
  const f = await fixture(t)
  f.catalog([await f.archive('1.0.0')]); await f.updater.check()
  const bad = f.catalog([await f.archive('1.1.0')]); bad.signature = Buffer.alloc(64).toString('base64')
  f.assets.set('https://modules.example/catalog', Buffer.from(JSON.stringify(bad)))
  assert.ok((await f.updater.check()).error)
  const archive = await f.archive('1.2.0'); f.catalog([archive]); f.assets.set(archive.packages.any.url, Buffer.from('wrong digest'))
  assert.ok((await f.updater.check()).error)
  f.catalog([await f.archive('1.3.0', { broken: true })]); assert.ok((await f.updater.check()).error)
  assert.equal(await f.manager.request('unit-coin', 'derive'), '1.0.0')
  assert.equal(readActive(f.managed).packages['unit-package'].version, '1.0.0')
})
test('busy wallet defers activation and old signed catalogs cannot roll versions back', async t => {
  const f = await fixture(t), item = await f.archive('1.0.0'), old = new Date(Date.now() - 60000).toISOString()
  f.catalog([item]); f.manager.activeWrites = 1
  assert.match((await f.updater.check()).error, /deferred/)
  assert.equal(f.manager.catalog().modules.length, 0)
  f.manager.activeWrites = 0; assert.equal((await f.updater.check()).changed, true)
  f.catalog([item], old); assert.ok((await f.updater.check()).error)
  assert.equal(await f.manager.request('unit-coin', 'derive'), '1.0.0')
})
test('catalog rejects expiration, duplicate identities and untrusted signatures', async t => {
  const f = await fixture(t), item = await f.archive('1.0.0'), envelope = f.catalog([item])
  assert.equal(verifyCatalog(envelope, f.publicKey).modules.length, 1)
  assert.throws(() => verifyCatalog(envelope, f.publicKey, { now: Date.now() + 7200000 }), /expired/)
  assert.throws(() => f.catalog([item, item]), /Invalid module catalog entry/)
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })
  assert.throws(() => verifyCatalog(envelope, other), /signature/)
})
