import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUsdPrice } from '../src/utils/formatAmount.ts'

test('very small USD prices use ordinary decimal notation', () => {
  assert.equal(formatUsdPrice(0.000000479599), '$0.0000004796')
  assert.equal(formatUsdPrice(0.000071487), '$0.00007149')
  assert.equal(formatUsdPrice(0), '$0')
})
