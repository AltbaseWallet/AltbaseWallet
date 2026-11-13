'use strict'
// Run with the packaged Windows EXE in Electron-as-Node mode. No RPC or wallet.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { createRequire } = require('node:module')
assert.equal(process.platform, 'win32', 'This check requires the real Windows runtime')
assert.ok(process.versions.electron, 'Run using the packaged Electron executable')
const appRequire = createRequire(path.join(path.dirname(process.execPath), 'resources/app.asar/package.json'))
const { PluginManager } = appRequire('./electron/plugins/manager.cjs')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-startup-qa-'))
const manifest = path.join(temporary, 'manifest.json'), factory = path.join(temporary, 'factory.cjs')
fs.writeFileSync(manifest, JSON.stringify({ id: 'offline-delay', version: '1.0.0' }))
fs.writeFileSync(factory, `exports.createPlugin=async()=>{
  await new Promise(resolve=>setTimeout(resolve,22000));
  return {request:async method=>{if(method!=='validate')throw Error('Only read validation is supported');return true}};
}`)
const manager = new PluginManager({ installedRoots: [], dataRoot: path.join(temporary, 'data'), clientOptions: { timeout: 1000 } })
const client = manager.clientFor({ type: 'javascript', source: manifest, entry: factory, descriptor: { id: 'offline-delay' } })
async function main() {
  const started = Date.now()
  assert.equal(await client.request('validate', { address: 'PUBLIC_OFFLINE_FIXTURE' }), true)
  const elapsedMs = Date.now() - started
  assert.ok(elapsedMs >= 22000, 'Fixture must exercise startup beyond the old 20-second limit')
  assert.equal(client.options.timeout, 1000, 'Startup must not extend the operation deadline')
  return { at: new Date().toISOString(), passed: true, platform: process.platform,
    delayedStartupMs: 22000, elapsedMs, startupBudgetMs: client.options.startupTimeout,
    operationBudgetMs: client.options.timeout, networkOperations: 0, transactionOperations: 0 }
}
main().finally(async () => {
  // Windows holds the worker's current directory until the process closes.
  const child = client.child
  const closed = child && child.exitCode === null && child.signalCode === null
    ? new Promise(resolve => child.once('close', resolve)) : Promise.resolve()
  client.close()
  await closed
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}).then(result => console.log(JSON.stringify(result)))
  .catch(() => { console.error('Windows startup budget check failed'); process.exitCode = 1 })
