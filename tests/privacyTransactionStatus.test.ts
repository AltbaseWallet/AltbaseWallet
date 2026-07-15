import assert from 'node:assert/strict'
import test from 'node:test'
import { privacyStatusAfterConfirmations } from '../src/utils/privacyTransactionStatus.ts'

test('a privacy transaction is confirmed after its first confirmation', () => {
  assert.equal(privacyStatusAfterConfirmations('confirmed', 0), 'pending')
  assert.equal(privacyStatusAfterConfirmations('confirmed', 1), 'confirmed')
  assert.equal(privacyStatusAfterConfirmations('confirmed', 8), 'confirmed')
  assert.equal(privacyStatusAfterConfirmations('pending', 8), 'pending')
})
