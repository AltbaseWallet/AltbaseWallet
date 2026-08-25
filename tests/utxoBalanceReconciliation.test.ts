import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldPreferUtxoTotal } from '../src/utils/utxoBalanceReconciliation.ts'

test('a partial UTXO index never lowers an authoritative wallet balance', () => {
  assert.equal(shouldPreferUtxoTotal(42_865_988n, 41_865_988n), false)
  assert.equal(shouldPreferUtxoTotal(42_865_988n, 42_865_988n), false)
})

test('a larger UTXO total can prove a newly indexed incoming credit', () => {
  assert.equal(shouldPreferUtxoTotal(41_865_988n, 42_865_988n), true)
  assert.equal(shouldPreferUtxoTotal(null, 1_000_000n), true)
})

test('an explicit pending balance wins while gateway indexes converge', () => {
  assert.equal(shouldPreferUtxoTotal(42_865_988n, 43_865_988n, true), false)
})
