import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldLockFinalFee } from '../src/utils/sendFeePolicy.ts'

test('automatic UTXO MAX fee is recalculated from the final spendable inputs', () => {
  assert.equal(shouldLockFinalFee('auto', false), false)
})

test('manual and privacy fees stay fixed after confirmation', () => {
  assert.equal(shouldLockFinalFee('manual', false), true)
  assert.equal(shouldLockFinalFee('auto', true), true)
})
