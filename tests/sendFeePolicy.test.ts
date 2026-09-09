import assert from 'node:assert/strict'
import test from 'node:test'

import { assertApprovedSpend, shouldLockFinalFee } from '../src/utils/sendFeePolicy.ts'

test('automatic UTXO MAX fee is recalculated from the final spendable inputs', () => {
  assert.equal(shouldLockFinalFee('auto', false), false)
})

test('manual and privacy fees stay fixed after confirmation', () => {
  assert.equal(shouldLockFinalFee('manual', false), true)
  assert.equal(shouldLockFinalFee('auto', true), true)
})

test('a recalculated fee cannot exceed the confirmed fee, even by one base unit', () => {
  const spend = { actualAmount: '2', approvedAmount: '2', maxFee: '0.00000001' }
  assert.doesNotThrow(() => assertApprovedSpend({ ...spend, actualFee: '0.000000010000000000' }))
  assert.throws(() => assertApprovedSpend({ ...spend, actualFee: '0.000000010000000001' }), /fee increased/)
  assert.doesNotThrow(() => assertApprovedSpend({ ...spend, actualFee: '0.000000009' }))
})

test('MAX cannot silently change the confirmed recipient amount', () => {
  const spend = { actualFee: '0.001', maxFee: '0.001', approvedAmount: '9007199254740992.00000001', sendMax: true }
  assert.doesNotThrow(() => assertApprovedSpend({ ...spend, actualAmount: '9007199254740992.000000010' }))
  assert.throws(() => assertApprovedSpend({ ...spend, actualAmount: '9007199254740992.00000002' }), /MAX amount changed/)
  assert.throws(() => assertApprovedSpend({ ...spend, actualAmount: '9007199254740992' }), /MAX amount changed/)
})
