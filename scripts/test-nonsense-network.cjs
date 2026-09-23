'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const adapterSource = fs.readFileSync(path.join(root, 'ops/remote-nodes/adapters/nonsenseCtl.cjs'), 'utf8')
// Exercise the actual unchanged wallet status mapper, not a copy of its rules.
const clientSource = fs.readFileSync(path.join(root, 'src/services/coinApiService.ts'), 'utf8')
const mapper = clientSource.slice(clientSource.indexOf('export const networkToStatus ='), clientSource.indexOf('/* ───── balances'))
const mapperContext = { exports: {} }
vm.runInNewContext(ts.transpileModule(mapper, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, mapperContext)
const networkToStatus = mapperContext.exports.networkToStatus
const baseline = {
  GetBlockDagInfo: { networkName: 'nonsense-mainnet', blockCount: '268738', headerCount: '527870', virtualDaaScore: '527862' },
  GetInfo: { isSynced: true, isUtxoIndexed: true, serverVersion: '2.3.0' },
}
function adapter(overrides = {}, servers = ['primary']) {
  const calls = []
  const fixture = { ...baseline, ...overrides }
  const exports = {}
  const context = {
    module: { exports }, exports, Buffer, setTimeout, clearTimeout,
    require(name) {
      if (name === '../lib/rpc.cjs') return { RpcError: class RpcError extends Error {} }
      assert.equal(name, 'node:child_process')
      return { spawn(binary, args) {
        const child = new EventEmitter()
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}
        const command = args[2]
        calls.push({ command, endpoint: args[0] })
        assert.ok(['GetInfo', 'GetBlockDagInfo'].includes(command), 'network checks must only read RPC status')
        queueMicrotask(() => {
          const value = typeof fixture[command] === 'function' ? fixture[command](args[0]) : fixture[command]
          if (value instanceof Error) { child.stderr.emit('data', Buffer.from(value.message)); child.emit('close', 1); return }
          const key = `${command[0].toLowerCase()}${command.slice(1)}Response`
          child.stdout.emit('data', Buffer.from(JSON.stringify({ [key]: value })))
          child.emit('close', 0)
        })
        return child
      } }
    },
  }
  vm.runInNewContext(adapterSource, context, { filename: 'nonsenseCtl.cjs' })
  return { api: context.module.exports.createNonsenseCtlAdapter({ rpcServers: servers }), calls }
}
test('a synced pruned DAG remains active in the unchanged wallet', async () => {
  const { api } = adapter()
  const n = await api.getNetwork()
  assert.equal(networkToStatus({ blocks: 268738, headers: 527870, initialBlockDownload: false }), 'syncing')
  assert.equal(networkToStatus(n), 'active')
  assert.equal(n.blocks, 527862); assert.equal(n.headers, 527862)
  assert.equal(n.dagBlockCount, 268738); assert.equal(n.dagHeaderCount, 527870)
})
test('an unpruned synchronized DAG is active', async () => {
  const { api } = adapter({ GetBlockDagInfo: { ...baseline.GetBlockDagInfo, blockCount: '527870' } })
  assert.equal(networkToStatus(await api.getNetwork()), 'active')
})
test('an explicit unsynchronized node is never overridden by local counts', async () => {
  const { api } = adapter({ GetInfo: { ...baseline.GetInfo, isSynced: false } })
  const n = await api.getNetwork()
  assert.equal(n.initialBlockDownload, true); assert.equal(networkToStatus(n), 'syncing')
})
test('a missing UTXO index is not reported ready', async () => {
  const { api } = adapter({ GetInfo: { ...baseline.GetInfo, isUtxoIndexed: false } })
  assert.equal(networkToStatus(await api.getNetwork()), 'syncing')
})
test('GetInfo failure stays an error instead of becoming active', async () => {
  const { api } = adapter({ GetInfo: new Error('fixture RPC unavailable') })
  await assert.rejects(api.getNetwork(), /RPC unavailable/)
})
test('incomplete sync status is rejected', async () => {
  const { api } = adapter({ GetInfo: {} })
  await assert.rejects(api.getNetwork(), /incomplete network status/)
})
test('missing, negative, nonnumeric and unsafe DAA scores are rejected', async () => {
  for (const virtualDaaScore of [undefined, null, '-1', 'bad', '9007199254740993']) {
    const { api } = adapter({ GetBlockDagInfo: { ...baseline.GetBlockDagInfo, virtualDaaScore } })
    await assert.rejects(api.getNetwork(), /incomplete network status/)
  }
})
test('RPC failover still recovers on the secondary endpoint', async () => {
  const fixture = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, endpoint => endpoint.endsWith('primary') ? new Error('primary unavailable') : v]))
  const { api, calls } = adapter(fixture, ['primary', 'secondary'])
  assert.equal(networkToStatus(await api.getNetwork()), 'active')
  assert.ok(calls.some(call => call.endpoint.endsWith('secondary')))
})
