'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
test('Qubic gateway only emits confirmed deltas with positive execution evidence', async () => {
  const own = 'A'.repeat(60), other = 'B'.repeat(60)
  const old = Module._load
  Module._load = function (request, parent, isMain) {
    if (request.endsWith('/lib/rpc.cjs')) return {
      RpcError: class RpcError extends Error {},
      httpRequest: async (url) => ({status:200, body:JSON.stringify(url.pathname.endsWith('/tick-info')
        ? {tickInfo:{tick:200}}
        : {transactions:[true,false,undefined].map((moneyFlew,i) => ({hash:`fixture-${i}`,source:other,destination:own,amount:'998',tickNumber:120,moneyFlew,timestamp:1700000000000}))})}),
    }
    return old.call(this, request, parent, isMain)
  }
  try {
    const {createQubicRpcAdapter} = require('../ops/remote-nodes/adapters/qubicRpc.cjs')
    const h = await createQubicRpcAdapter().getHistory(own)
    assert.deepEqual(h.deltas.map(x => x.txid), ['fixture-0'])
    assert.deepEqual(h.mempool.map(x => x.txid), ['fixture-1','fixture-2'])
    assert.deepEqual(h.transactions.map(x => x.status), ['confirmed','pending','pending'])
    assert.deepEqual(h.transactions.map(x => x.confirmations), [81,0,0])
  } finally {Module._load = old}
})
