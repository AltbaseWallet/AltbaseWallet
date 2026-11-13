'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const { NativeCoreClient } = require('../electron/native-core-client.cjs')
const { loadBinaryJavascript } = require('../electron/plugins/binary-javascript.cjs')
const { requireBinary } = require('../scripts/runtime-platform.cjs')
const root = path.resolve(__dirname, '..'), target = `${process.platform}-${process.arch}`
const modules = path.join(root, 'local-checks/coin-binaries', target)
test('all 39 installed coin folders contain real executable libraries; the native bridge maps those exact files', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-module-binaries-'))
  const modules = path.join(data, 'modules')
  await require('../electron/plugins/module-directory.cjs').prepareModuleDirectory(path.join(root, 'local-checks/coin-binaries', target), modules)
  const manager = new PluginManager({ bundledRoot: modules, installedRoots: [], dataRoot: data,
    hostPath: path.join(root, 'native-plugin-host/bin', target, 'altbase_plugin_host') })
  const client = new NativeCoreClient({ isPackaged: false, getPath: () => data }, 'binary-layout-test', { modulesDirectory: modules })
  t.after(() => { manager.closeSessions(); client.stop(); fs.rmSync(data, { recursive: true, force: true }) })
  const catalog = await manager.discover()
  assert.equal(catalog.modules.length, 39); assert.deepEqual(catalog.diagnostics, [])
  for (const descriptor of catalog.modules) {
    const definition = JSON.parse(fs.readFileSync(path.join(modules, descriptor.id, 'manifest.json')))
    assert.ok(definition.nativeRuntime.binaries.length > 0, descriptor.id)
    for (const file of definition.nativeRuntime.binaries) requireBinary(path.join(modules, descriptor.id, file), target)
  }
  await client.request('listWalletModules')
  const phrase = require('@scure/bip39').entropyToMnemonic(new Uint8Array(16), require('@scure/bip39/wordlists/english').wordlist)
  await client.request('privacyScope', { coin: 'monero', phrase })
  if (process.platform === 'linux') {
    const maps = fs.readFileSync(`/proc/${client.child.pid}/maps`, 'utf8')
    for (const id of ['bitcoin', 'bitcoincashii', 'zano', 'epic', 'monero']) {
      assert.ok(maps.includes(modules + '/' + id + '/'), id + ' must load from its common module folder')
    }
    assert.ok(!maps.includes(root + '/native-core/'), 'No fallback to the former private runtime directory')
  }
  assert.equal(await manager.request('tron', 'validate', { address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' }), true)
  const workerMaps = fs.readFileSync(`/proc/${manager.modules.get('tron').client.child.pid}/maps`, 'utf8')
  assert.ok(workerMaps.includes(modules + '/tron/altbase_tron.so'))
  assert.ok(manager.runtimeAsset('kaspa', 'kaspa_bg.wasm'))
  assert.equal(manager.runtimeAsset('kaspa', '../../outside.wasm'), null)
})
test('compiled account libraries execute the complete factory and retain offline dependency injection', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-binary-factory-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const definition = JSON.parse(fs.readFileSync(path.join(modules, 'tron/manifest.json')))
  const factory = loadBinaryJavascript(path.join(modules, 'tron', definition.runtime.binaryPlatforms[target]))
  const runtime = factory.createPlugin({ dataDirectory: directory, adapter: { validate: () => true, normalize: value => value, head: async () => ({ height: 456 }),
    balance: async () => '1234567', discover: async () => ({ candidates: [], complete: false }) }, iconCache: {} })
  t.after(() => runtime.close())
  const snapshot = await runtime.request('snapshot', { addresses: ['PUBLIC_BINARY_FIXTURE'] })
  assert.equal(snapshot.network.blocks, 456)
  assert.equal(snapshot.balances.PUBLIC_BINARY_FIXTURE.balance, '1234567')
  await runtime.waitForIdle()
})
