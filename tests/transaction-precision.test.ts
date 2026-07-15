import assert from 'node:assert/strict'
import test from 'node:test'

import { fromBaseUnits } from '../src/utils/decimalAmount.ts'
import { coinValueToUnits, sumCoinValuesToUnits } from '../src/utils/transactionAmounts.ts'

test('account-chain history preserves atomic amounts above Number.MAX_SAFE_INTEGER', () => {
  const units = coinValueToUnits('90071992.54740993', 8)
  assert.equal(units, 9_007_199_254_740_993n)
  assert.equal(fromBaseUnits(units, 8), '90071992.54740993')
})

test('account-chain outgoing amount and fee stay exact decimal strings', () => {
  const inputs = sumCoinValuesToUnits(['90071992.54741005'], 8)
  const outputs = sumCoinValuesToUnits(['0.00000001', '90071992.54740993'], 8)
  assert.equal(fromBaseUnits(inputs - outputs, 8), '0.00000011')
  assert.equal(fromBaseUnits(coinValueToUnits('0.00000001', 8), 8), '0.00000001')
})
