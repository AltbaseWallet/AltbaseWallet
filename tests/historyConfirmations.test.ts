import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveTransactionConfirmations } from '../src/utils/transactionConfirmations.ts'

test('history confirmations advance from block height and current network tip', () => {
  assert.equal(resolveTransactionConfirmations('confirmed', 1, 120, 125), 6)
})

test('mempool rows stay at zero confirmations even when a tip is available', () => {
  assert.equal(resolveTransactionConfirmations('pending', 8, 120, 125), 0)
})

test('a confirmed transaction never displays fewer than one confirmation', () => {
  assert.equal(resolveTransactionConfirmations('confirmed', undefined, undefined, undefined), 1)
})
