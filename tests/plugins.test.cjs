'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const { manifest } = require('../electron/plugins/manifest.cjs')
const root = path.resolve(__dirname, '..'), target = `${process.platform}-${process.arch}`
const suffix = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so'
const host = path.join(root, 'native-plugin-host/bin', target, 'altbase_plugin_host' + (process.platform === 'win32' ? '.exe' : ''))
const fixture = file => path.join(root, 'local-checks/fixtures', target, file + suffix)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function setup(t, { bundled = false, timeout = 3000 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-fullnode-test-'))
  const installed = path.join(directory, 'plugins'), data = path.join(directory, 'data')
  fs.mkdirSync(installed)
  const manager = new PluginManager({ bundledRoot: bundled ? path.join(root, 'coin-plugins') : null,
    installedRoots: [installed], hostPath: host, dataRoot: data, clientOptions: { timeout, startupTimeout: 3000 } })
  t.after(async () => { manager.closeSessions(); await new Promise(resolve => setTimeout(resolve, 80)); fs.rmSync(directory, { recursive: true, force: true }) })
  const native = (name = 'fixture-native', destination = name) => fs.copyFileSync(fixture(name), path.join(installed, destination + suffix))
  const javascript = () => fs.cpSync(path.join(root, 'examples/javascript-fixture'), path.join(installed, 'javascript'), { recursive: true })
  return { directory, installed, data, manager, native, javascript }
}
test('all 33 compatibility modules and their icons load from external manifests', async t => {
  const { manager } = setup(t, { bundled: true })
  const catalog = await manager.discover()
  assert.equal(catalog.modules.filter(m => m.runtimeType === 'legacy').length, 33)
  assert.equal(catalog.modules.filter(m => m.capabilities.includes('assets')).length, 6)
  assert.deepEqual(catalog.diagnostics, [])
  assert.ok(catalog.modules.every(m => m.coin.iconUrl?.startsWith('altbase-coin://')))
  assert.equal(catalog.modules.find(m => m.id === 'bitcoincashii').coin.cryptoParams.sighashStyle, 'bip143-forkid')
})
test('drop a bare native library into an already built host and remove it without rebuilding', async t => {
  const { manager, native, installed } = setup(t)
  const before = hash(host)
  assert.equal((await manager.discover()).modules.length, 0)
  native()
  assert.equal((await manager.discover()).modules[0].id, 'fixture-native')
  assert.equal(await manager.request('fixture-native', 'derive', { mnemonic: 'NOT_A_REAL_SEED' }), 'ALTBASE_FIXTURE_ADDRESS')
  const snapshot = await manager.request('fixture-native', 'snapshot', {})
  assert.equal(snapshot.walletBalance.balance, '425000000')
  assert.equal((await manager.request('fixture-native', 'estimateMax', {})).amountCoin, '4.2495')
  assert.match((await manager.request('fixture-native', 'send', { amountCoin: '1' })).txid, /^fixture-only-/)
  fs.unlinkSync(path.join(installed, 'fixture-native' + suffix))
  assert.equal((await manager.discover()).modules.length, 0)
  await assert.rejects(manager.request('fixture-native', 'snapshot'), /not installed/)
  assert.equal(hash(host), before)
})
test('a module upgrade preserves its data directory and does not change the host', async t => {
  const { manager, native, installed, data } = setup(t)
  native(); await manager.discover(); await manager.request('fixture-native', 'snapshot')
  const saved = path.join(data, 'fixture-native', 'scan-result.json')
  fs.writeFileSync(saved, JSON.stringify({ height: 123, profile: 'fixture-public-profile' }))
  const before = hash(host)
  fs.copyFileSync(fixture('fixture-native-updated'), path.join(installed, 'pending.tmp'))
  fs.renameSync(path.join(installed, 'pending.tmp'), path.join(installed, 'fixture-native' + suffix))
  const next = await manager.discover()
  assert.equal(next.modules[0].version, '1.1.0')
  assert.equal((await manager.request('fixture-native', 'snapshot')).coin, 'fixture-native')
  assert.equal(JSON.parse(fs.readFileSync(saved, 'utf8')).height, 123)
  assert.equal(hash(host), before)
})
test('duplicate IDs disable the ambiguous module and explain the collision', async t => {
  const { manager, native } = setup(t)
  native(); native('fixture-native', 'duplicate')
  const result = await manager.discover()
  assert.equal(result.modules.length, 0); assert.match(result.diagnostics[0].error, /Duplicate/)
})
test('wrong ABI and invalid binaries cannot take down another module', async t => {
  const { manager, native, installed } = setup(t)
  native(); native('fixture-bad-abi'); fs.writeFileSync(path.join(installed, 'broken' + suffix), 'not a library')
  const result = await manager.discover()
  assert.equal(result.modules.length, 1); assert.equal(result.diagnostics.length, 2)
  assert.equal(await manager.request('fixture-native', 'validate', { address: 'ALTBASE_FIXTURE_ADDRESS' }), true)
})
test('a native crash is contained; the next explicit read can reopen the module', async t => {
  const { manager, native } = setup(t); native(); await manager.discover()
  await assert.rejects(manager.request('fixture-native', 'snapshot', { testCrash: true }), /exited|closed/)
  assert.equal((await manager.request('fixture-native', 'snapshot')).walletBalance.balance, '425000000')
})
test('a timed out request is rejected and queued calls are not replayed', async t => {
  const { manager, native } = setup(t, { timeout: 50 }); native(); await manager.discover()
  const result = await Promise.allSettled([
    manager.request('fixture-native', 'snapshot', { testTimeout: true }),
    manager.request('fixture-native', 'send', { amountCoin: '1' }),
  ])
  assert.ok(result.every(r => r.status === 'rejected'))
  assert.match(result[0].reason.message, /timed out/)
})
test('JavaScript modules use the same discovery and request contract', async t => {
  const { manager, javascript } = setup(t); javascript(); await manager.discover()
  assert.equal(await manager.request('fixture-javascript', 'derive'), 'ALTBASE_JS_FIXTURE_ADDRESS')
  assert.equal((await manager.request('fixture-javascript', 'snapshot')).walletBalance.balance, '125000000')
})
test('module errors never echo a supplied recovery value', async t => {
  const { manager, javascript } = setup(t); javascript(); await manager.discover()
  const secret = 'FAKE_SENSITIVE_INPUT'
  await assert.rejects(manager.request('fixture-javascript', 'derive', { mnemonic: secret, testError: true }), e => !e.message.includes(secret) && /operation failed/.test(e.message))
})
test('an uncertain mock send is attempted once and never automatically retried', async t => {
  const { manager, javascript, data } = setup(t); javascript(); await manager.discover()
  await assert.rejects(manager.request('fixture-javascript', 'send', { testFailAfterWrite: true }))
  manager.closeSessions()
  await manager.request('fixture-javascript', 'snapshot')
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'fixture-javascript/fixture-public-state.json'), 'utf8')).sends, 1)
})
test('wallet lock closes sessions without removing profiles', async t => {
  const { manager, native, data } = setup(t); native(); await manager.discover()
  await manager.request('fixture-native', 'derive')
  fs.writeFileSync(path.join(data, 'fixture-native', 'public-scan'), '123')
  const client = manager.modules.get('fixture-native').client
  manager.closeSessions(); assert.equal(client.closed, true)
  assert.equal(fs.readFileSync(path.join(data, 'fixture-native', 'public-scan'), 'utf8'), '123')
  assert.equal((await manager.request('fixture-native', 'snapshot')).coin, 'fixture-native')
})
test('writes cannot be disguised as node reads', async t => {
  const { manager, native } = setup(t); native(); await manager.discover()
  await assert.rejects(manager.request('fixture-native', 'nodeRequest', { method: 'POST', path: '/tx/broadcast', body: {} }), /Only read operations/)
  await assert.rejects(manager.request('fixture-native', 'unknown'), /not supported/)
})
test('refresh cannot interrupt an active module operation', async t => {
  const { manager, native } = setup(t, { timeout: 80 }); native(); await manager.discover()
  const operation = manager.request('fixture-native', 'derive', { testTimeout: true })
  const rejection = assert.rejects(operation)
  await assert.rejects(manager.discover(), /current module transaction/)
  await rejection
})
test('traversal and symlinked runtime files are rejected', async t => {
  const { manager, javascript, directory, installed } = setup(t); javascript()
  const filename = path.join(installed, 'javascript/manifest.json'), original = JSON.parse(fs.readFileSync(filename, 'utf8'))
  fs.writeFileSync(path.join(directory, 'outside.cjs'), 'throw Error("must not load")')
  fs.writeFileSync(filename, JSON.stringify({ ...original, runtime: { type: 'javascript', entry: '../../outside.cjs' } }))
  assert.match((await manager.discover()).diagnostics[0].error, /escapes/)
  fs.symlinkSync(path.join(directory, 'outside.cjs'), path.join(installed, 'javascript/escape.cjs'))
  fs.writeFileSync(filename, JSON.stringify({ ...original, runtime: { type: 'javascript', entry: 'escape.cjs' } }))
  assert.match((await manager.discover()).diagnostics[0].error, /escapes/)
})
test('unsupported manifest versions and malformed metadata are rejected', () => {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'examples/javascript-fixture/manifest.json'), 'utf8'))
  for (const patch of [{ abiVersion: 2 }, { schemaVersion: 2 }, { id: '../escape' }, { decimals: -1 }, { capabilities: [] }, { explorerUrl: 'javascript:alert(1)' }]) assert.throws(() => manifest({ ...original, ...patch }))
  for (const id of ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9', 'constructor', 'prototype']) assert.throws(() => manifest({ ...original, id }))
})
test('an icon-only update invalidates the catalog icon URL', async t => {
  const { manager, javascript, installed } = setup(t); javascript()
  const filename=path.join(installed,'javascript/manifest.json'), definition=JSON.parse(fs.readFileSync(filename,'utf8'))
  definition.icon='icon.svg'; fs.writeFileSync(filename,JSON.stringify(definition))
  const icon=path.join(installed,'javascript/icon.svg');fs.writeFileSync(icon,'<svg xmlns="http://www.w3.org/2000/svg"/>')
  const before=(await manager.discover()).modules[0].coin.iconUrl
  fs.writeFileSync(icon,'<svg xmlns="http://www.w3.org/2000/svg"><title>updated</title></svg>')
  assert.notEqual((await manager.discover()).modules[0].coin.iconUrl,before)
})
test('an unreadable module root does not hide modules from another root', async t => {
  const { manager, javascript, directory } = setup(t);javascript()
  const badRoot=path.join(directory,'not-a-directory');fs.writeFileSync(badRoot,'fixture')
  manager.installedRoots.unshift(badRoot)
  const catalog=await manager.discover()
  assert.equal(catalog.modules.length,1);assert.match(catalog.diagnostics[0].error,/not readable/)
})
test('a request waiting for discovery is cancelled when the wallet locks', async t => {
  const { manager, javascript }=setup(t);javascript();await manager.discover()
  let finish;manager.scan=new Promise(resolve=>{finish=resolve})
  const operation=manager.request('fixture-javascript','derive'), rejection=assert.rejects(operation,/session changed/)
  manager.closeSessions();finish();await rejection;manager.scan=null
  assert.equal(manager.modules.get('fixture-javascript').client,null)
})
test('a worker can return its final buffered response before exiting', async t => {
  const { directory }=setup(t),{ PluginClient }=require('../electron/plugins/client.cjs')
  const worker=path.join(directory,'final-response.cjs')
  fs.writeFileSync(worker,`process.stdout.write('{}\\n');let data='';process.stdin.on('data',c=>{data+=c;if(data.split('\\n').length>=3){process.stdout.write(JSON.stringify({ok:true,result:'x'.repeat(262144)})+'\\n',()=>process.exit(0))}})`)
  const client=new PluginClient({executable:process.execPath,args:[worker],timeout:3000,startupTimeout:3000})
  t.after(()=>client.close())
  assert.equal((await client.request('snapshot',{})).length,262144)
})
test('a cold JavaScript SDK startup may exceed five seconds without consuming its RPC budget', async t => {
  const { manager, javascript, installed } = setup(t)
  javascript(); manager.clientOptions = { timeout: 1000 }
  const directory = path.join(installed, 'javascript')
  const definition = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  fs.writeFileSync(path.join(directory, definition.runtime.entry), `exports.createPlugin=async()=>{await new Promise(resolve=>setTimeout(resolve,5200));return{request:async()=>true}}`)
  await manager.discover()
  assert.equal(await manager.request('fixture-javascript', 'validate', { address: 'public-fixture' }), true)
})
