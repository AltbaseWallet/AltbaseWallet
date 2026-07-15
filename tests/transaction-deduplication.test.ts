import assert from 'node:assert/strict'
import test from 'node:test'

import { reconcileEpicPendingDuplicates } from '../src/services/epicTransactionReconciliation.ts'
import { dedupeTransactionsByIdentity } from '../src/services/transactionIdentity.ts'
import type { Transaction } from '../src/types/transaction.ts'

const coinIds = [
  'bitcoin',
  'bitcoin2',
  'bitcoincashii',
  'firo',
  'btgs',
  'capstash',
  'hypercoin',
  'mydogecoin',
  'pepecoin',
  'kerrigan',
  'scash',
  'litecoinii',
  'neoxa',
  'terracoin',
  'junkcoin',
  'raptoreum',
  'pearl',
  'zano',
  'epic',
  'quai',
  'qubic',
  'kaspa',
  'ckb',
]

const tx = (coinId: string, status: Transaction['status'], overrides: Partial<Transaction> = {}): Transaction => ({
  id: `${coinId}-ABCDEF`,
  coinId,
  type: 'outgoing',
  amount: '1.25',
  fee: '0.01',
  status,
  txHash: status === 'confirmed' ? 'abcdef' : 'ABCDEF',
  from: 'wallet-address',
  to: 'destination-address',
  createdAt: '2026-07-10T00:00:00.000Z',
  confirmations: status === 'confirmed' ? 5 : 0,
  ...overrides,
})

test('every coin collapses local, mempool, and confirmed copies by normalized txid', () => {
  for (const coinId of coinIds) {
    const rows = dedupeTransactionsByIdentity([
      tx(coinId, 'failed'),
      tx(coinId, 'pending', { broadcastUncertain: true }),
      tx(coinId, 'confirmed', { blockHeight: 123 }),
    ])
    assert.equal(rows.length, 1, coinId)
    assert.equal(rows[0].status, 'confirmed', coinId)
    assert.equal(rows[0].broadcastUncertain, false, coinId)
    assert.equal(rows[0].blockHeight, 123, coinId)
  }
})

test('the same txid on different chains remains separate', () => {
  const rows = dedupeTransactionsByIdentity(coinIds.map((coinId) => tx(coinId, 'confirmed')))
  assert.equal(rows.length, coinIds.length)
})

test('confirmed remote state keeps local outgoing metadata after restart', () => {
  const local = tx('bitcoin', 'pending', {
    amount: '2.5',
    fee: '0.0002',
    to: 'typed-by-user',
    spentOutpoints: [{ txid: 'input', vout: 1 }],
    balanceBefore: '8',
  })
  const remote = tx('bitcoin', 'confirmed', {
    amount: '1.4998',
    fee: undefined,
    to: 'change-output',
    blockHeight: 777,
  })
  const [merged] = dedupeTransactionsByIdentity([local, remote])
  assert.equal(merged.status, 'confirmed')
  assert.equal(merged.amount, '2.5')
  assert.equal(merged.fee, '0.0002')
  assert.equal(merged.to, 'typed-by-user')
  assert.deepEqual(merged.spentOutpoints, [{ txid: 'input', vout: 1 }])
  assert.equal(merged.balanceBefore, '8')
})

test('Epic synthetic confirmed entry replaces its matching local pending entry', () => {
  const pending = tx('epic', 'pending', {
    txHash: 'local-epic-send',
    amount: '3',
    fee: '0.01',
    createdAt: '2026-07-10T00:00:00.000Z',
  })
  const confirmed = tx('epic', 'confirmed', {
    txHash: 'epic-height-123-identity',
    amount: '3',
    fee: '0.01',
    createdAt: '2026-07-10T00:05:00.000Z',
    blockHeight: 123,
  })
  const reconciled = reconcileEpicPendingDuplicates([pending], [confirmed])
  assert.equal(reconciled.removedCount, 1)
  assert.equal(reconciled.transactions.length, 0)
})
