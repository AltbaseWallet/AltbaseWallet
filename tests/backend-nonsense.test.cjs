'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { EventEmitter } = require('node:events')

function fixture({ failBoth = false } = {}) {
  const calls = [], context = { module: { exports: {} }, Buffer, setTimeout, clearTimeout }
  let delayedInfo
  const primary = '127.0.0.1:39110', secondary = '127.0.0.1:39112'
  function spawn(_binary, args) {
    const endpoint = args[0].split('=')[1], command = args[2]
    calls.push({ endpoint, command })
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}
    const finish = ok => {
      if (ok) {
        const result = command === 'GetBlockDagInfo'
          ? { virtualDaaScore: '123', blockCount: '100', headerCount: '500', networkName: 'nonsense-mainnet' }
          : { isSynced: true, isUtxoIndexed: true, serverVersion: 'fixture' }
        const key = command[0].toLowerCase() + command.slice(1) + 'Response'
        child.stdout.emit('data', Buffer.from(JSON.stringify({ [key]: result })))
      } else child.stderr.emit('data', Buffer.from('Fixture endpoint unavailable'))
      child.emit('close', ok ? 0 : 1)
    }
    if (endpoint === primary && command === 'GetInfo' && !delayedInfo && !failBoth) {
      delayedInfo = () => finish(false)
    } else {
      queueMicrotask(() => {
        finish(endpoint === secondary && !failBoth)
        // DAG fallback changes the shared preferred endpoint before the first
        // info request fails. Its own fallback must still try the standby.
        if (endpoint === secondary && command === 'GetBlockDagInfo' && delayedInfo) setImmediate(delayedInfo)
      })
    }
    return child
  }
  context.require = name => {
    if (name === 'node:child_process') return { spawn }
    if (name === '../lib/rpc.cjs') return { RpcError: class extends Error {} }
    throw Error('Unexpected fixture dependency')
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ops/backend/nonsenseCtl.cjs'), 'utf8'), context)
  return { adapter: context.module.exports.createNonsenseCtlAdapter(), calls, primary, secondary }
}

test('Nonsense concurrent RPC failures still try the healthy standby once', async () => {
  const { adapter, calls, primary, secondary } = fixture()
  const network = await adapter.getNetwork()
  assert.equal(network.blocks, 123); assert.equal(network.initialBlockDownload, false)
  assert.deepEqual(calls.filter(x => x.command === 'GetInfo').map(x => x.endpoint), [primary, secondary])
  const count = calls.length
  await adapter.getNetwork()
  assert.ok(calls.slice(count).every(x => x.endpoint === secondary))
})

test('Nonsense unavailable endpoints return an error after one attempt each', async () => {
  const { adapter, calls, primary, secondary } = fixture({ failBoth: true })
  await assert.rejects(adapter.getNetwork(), /Nonsense RPC unavailable/)
  for (const command of ['GetInfo', 'GetBlockDagInfo']) {
    assert.deepEqual(calls.filter(x => x.command === command).map(x => x.endpoint), [primary, secondary])
  }
})
