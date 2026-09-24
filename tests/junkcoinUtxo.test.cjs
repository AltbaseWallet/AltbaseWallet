'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../ops/remote-nodes/adapters/junkcoinUtxo.cjs'), 'utf8')
const context = { module: { exports: {} }, Date, Map, Set, require(name) {
  if (name === '../lib/rpc.cjs') return { RpcError: class extends Error {}, createBitcoinRpc: () => { throw Error('No real RPC in fixtures') } }
  if (name === '../lib/mapConcurrent.cjs') return require('../ops/remote-nodes/lib/mapConcurrent.cjs')
  throw Error(name)
} }
vm.runInNewContext(source, context)
const { createJunkcoinUtxoReads } = context.module.exports
const hash = 'a'.repeat(64), id = n => n.toString(16).padStart(64, '0'), script = '76a914' + 'b'.repeat(40) + '88ac'
function fixture() {
  const state = {
    chain: { blocks: 1000, headers: 1000, bestblockhash: hash, initialblockdownload: false },
    scan: { success: true, height: 1000, bestblock: hash, total_amount: 15, unspents: [
      { txid: id(1), vout: 0, amount: 10, height: 931, scriptPubKey: script },
      { txid: id(2), vout: 0, amount: 5, height: 932, scriptPubKey: script },
    ] },
    live: { [id(1)]: { bestblock: hash, value: 10, confirmations: 70, coinbase: true, scriptPubKey: { hex: script } },
      [id(2)]: { bestblock: hash, value: 5, confirmations: 69, coinbase: true, scriptPubKey: { hex: script } } },
    transactions: [], scans: 0, failMethod: null,
  }
  const rpc = async (method, params) => {
    if (method === state.failMethod) throw Error('fixture unavailable')
    if (state.override) { const value = await state.override(method, params); if (value !== undefined) return value }
    switch (method) {
      case 'validateaddress': return { isvalid: true, scriptPubKey: script }
      case 'getblockchaininfo': return state.chain
      case 'getrawmempool': return state.transactions.map(tx => tx.txid)
      case 'scantxoutset': state.scans++; return state.scan
      case 'gettxout': assert.equal(params[2], false); return state.live[params[0]]
      case 'getrawtransaction': return state.transactions.find(tx => tx.txid === params[0])
      default: throw Error('Unexpected RPC: ' + method)
    }
  }
  return { state, adapter: createJunkcoinUtxoReads({ rpc }) }
}
test('full scan includes old funds and applies Junkcoin maturity at 70 blocks', async () => {
  const { adapter } = fixture(), value = await adapter.getBalance('fixture')
  assert.equal(value.balance, 1_500_000_000)
  assert.equal(value.balance_spendable, 1_000_000_000)
  assert.equal(value.immature, 500_000_000)
  assert.equal((await adapter.getUtxos('fixture')).utxos.length, 1)
})
test('balance and UTXO requests coalesce one complete scan', async () => {
  const { adapter, state } = fixture()
  await Promise.all([adapter.getBalance('fixture'), adapter.getUtxos('fixture', { fast: true })])
  assert.equal(state.scans, 1)
})
test('completed empty scan is a verified zero', async () => {
  const { adapter, state } = fixture();state.scan.unspents = [];state.scan.total_amount = 0
  assert.equal((await adapter.getBalance('fixture')).balance, 0)
})
for (const [name, change] of [
  ['unfinished scan', s => { s.scan.success = false }],
  ['missing output list', s => { delete s.scan.unspents }],
  ['mismatched total', s => { s.scan.total_amount = 16 }],
  ['duplicate output', s => { s.scan.unspents.push(s.scan.unspents[0]) }],
  ['foreign script', s => { s.scan.unspents[0].scriptPubKey = '51' }],
  ['missing maturity proof', s => { delete s.live[id(2)].coinbase }],
  ['missing recent maturity output', s => { s.live[id(2)] = null }],
  ['lagging node', s => { s.chain.headers++ }],
  ['RPC failure', s => { s.failMethod = 'scantxoutset' }],
]) test(name + ' stays unavailable, including fast UTXO requests', async () => {
  const { adapter, state } = fixture();change(state)
  await assert.rejects(adapter.getBalance('fixture'))
  await assert.rejects(adapter.getUtxos('fixture', { fast: true }))
})
test('pending spend and child change are counted exactly once', async () => {
  const { adapter, state } = fixture()
  state.transactions = [
    { txid: id(3), vin: [{ txid: id(1), vout: 0 }], vout: [{ n: 0, value: 4, scriptPubKey: { hex: script } }, { n: 1, value: 5.9, scriptPubKey: { hex: '51' } }] },
    { txid: id(4), vin: [{ txid: id(3), vout: 0 }], vout: [{ n: 0, value: 3, scriptPubKey: { hex: script } }] },
  ]
  const value = await adapter.getBalance('fixture')
  assert.equal(value.balance, 800_000_000)
  assert.equal(value.pendingOutgoing, 700_000_000)
  assert.equal(value.balance_spendable, 0)
  assert.equal(value.immature, 500_000_000)
  assert.equal((await adapter.getMempool('fixture')).pending.length, 2)
})
test('new mempool invalidates cached snapshot and incoming outputs are not spendable', async () => {
  const { adapter, state } = fixture();await adapter.getBalance('fixture')
  state.transactions = [{ txid: id(3), vin: [{ txid: id(99), vout: 0 }], vout: [{ n: 0, value: 0.00000001, scriptPubKey: { hex: script } }] }]
  const value = await adapter.getBalance('fixture')
  assert.equal(value.balance, 1_500_000_001);assert.equal(value.pendingIncoming, 1)
  assert.equal(value.balance_spendable, 1_000_000_000);assert.equal(state.scans, 2)
})
test('tip change while scanning does not return a partial balance', async () => {
  const { adapter, state } = fixture();let calls = 0
  state.override = async method => method === 'getblockchaininfo' && ++calls === 2 ? { ...state.chain, bestblockhash: id(99) } : undefined
  await assert.rejects(adapter.getBalance('fixture'), /changed/)
})
test('scans of different addresses are serialized for the daemon', async () => {
  const { adapter, state } = fixture();let active = 0, max = 0
  state.override = async method => {
    if (method !== 'scantxoutset') return
    active++;max = Math.max(max, active)
    await new Promise(resolve => setTimeout(resolve, 10));active--
    return state.scan
  }
  await Promise.all(['a', 'b', 'c'].map(address => adapter.getBalance(address)))
  assert.equal(max, 1)
})
test('large mature balances need no per-output transaction RPCs', async () => {
  const { adapter, state } = fixture()
  state.scan.unspents = Array.from({ length: 5000 }, (_, i) => ({ txid: id(i + 1), vout: 0, amount: 1, height: 1, scriptPubKey: script }))
  state.scan.total_amount = 5000;state.failMethod = 'gettxout'
  const value = await adapter.getBalance('fixture')
  assert.equal(value.balance, 500_000_000_000)
  assert.equal(value.utxos.length, 5000)
})
