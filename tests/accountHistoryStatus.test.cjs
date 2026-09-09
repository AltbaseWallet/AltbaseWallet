'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createJiti } = require('jiti')
const jiti = createJiti(__filename)
const { mapHistoryResponseToTransactions } = jiti('../src/services/coinApiService.ts')
const { normalizeQubicTransaction } = jiti('../src/utils/qubicTransactionStatus.ts')
const history = (confirmations) => ({
  deltas: [{txid:'fixture', satoshis:'998', height:120, timestamp:1700000000}], mempool:[],
  transactions:[{txid:'fixture', confirmations, vin:[{address:'sender',value:'998'}],
    vout:[{value:'998',n:0,scriptPubKey:{address:'recipient'}}]}],
})
test('Kaspa frontend preserves the server counter without mixing DAA and blue scores', () => {
  const [tx] = mapHistoryResponseToTransactions(history(6), 'kaspa', 'recipient', 1, ['recipient'], 2_000_125)
  assert.equal(tx.confirmations, 6)
  assert.equal(tx.status, 'confirmed')
  const [fallback] = mapHistoryResponseToTransactions(history(undefined), 'kaspa', 'recipient', 1, ['recipient'], 2_000_125)
  assert.equal(fallback.confirmations, 1)
})
test('a scheduled Qubic tick cannot prove execution, while explicit network confirmation can', () => {
  for (const count of [0, undefined]) {
    const [tx] = mapHistoryResponseToTransactions(history(count), 'qubic', 'recipient', 1, ['recipient'], 1000)
    assert.equal(tx.status, 'pending')
    assert.equal(tx.confirmations, 0)
    assert.equal(tx.verification, 'unverified')
  }
  const [confirmed] = mapHistoryResponseToTransactions(history(6), 'qubic', 'recipient', 1, ['recipient'], 1000)
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.confirmations, 6)
  assert.equal(confirmed.verification, 'verified')
  assert.equal(normalizeQubicTransaction(confirmed), confirmed)
})
test('legacy Qubic success/failure and relay-only records become unverified on load', () => {
  for (const status of ['pending','confirmed','failed']) {
    const tx = normalizeQubicTransaction({coinId:'qubic',status,confirmations:999,amount:'998',balanceBefore:'998'})
    assert.equal(tx.status,'pending')
    assert.equal(tx.confirmations,0)
    assert.equal(tx.verification,'unverified')
  }
})
