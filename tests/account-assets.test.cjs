'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { unsigned, parseAmount, formatAmount, fromHex, hexQuantity } = require('../modules/account-common/amounts.cjs')
const { assessSpam, assetVisible, displayText } = require('../modules/account-common/spam.cjs')
test('account amounts preserve atomic integers and precision without floating point', () => {
  assert.equal(parseAmount('123456789.123456789123456789', 18), 123456789123456789123456789n)
  assert.equal(formatAmount('123456789123456789123456789', 18), '123456789.123456789123456789')
  assert.equal(formatAmount('1', 255), '0.' + '0'.repeat(254) + '1')
  assert.equal(parseAmount('0.' + '0'.repeat(254) + '1', 255), 1n)
  assert.equal(parseAmount('0001.23000', 2), 123n)
  assert.equal(formatAmount('0', 18), '0')
  const maximum = (1n << 256n) - 1n
  assert.equal(fromHex(hexQuantity(maximum)), maximum)
  assert.equal(unsigned(maximum.toString()), maximum)
  for (const value of ['-1', '1e3', ' 1', 'NaN', '1.', '.5', '0.0000011']) {
    assert.throws(() => parseAmount(value, 6))
  }
  assert.throws(() => unsigned(Number.MAX_SAFE_INTEGER + 1))
  assert.throws(() => unsigned((1n << 256n).toString()))
  assert.throws(() => parseAmount('18446744073709551616', 0, { bits: 64 }))
})
test('spam is hidden until an explicit per-asset override; unknown is not silently called spam', () => {
  for (const metadata of [{ name: 'Claim reward at bad.xyz' }, { symbol: 'US\u202eDC' }]) {
    const result = assessSpam(metadata)
    assert.equal(result.classification, 'spam')
    assert.equal(assetVisible(result), false)
    assert.equal(assetVisible(result, 'show'), true)
    assert.equal(assetVisible(result, 'hide'), false)
  }
  assert.equal(assessSpam({ name: 'New project', symbol: 'NEW' }).classification, 'unverified')
  assert.equal(assessSpam({}, { verified: true }).classification, 'verified')
  assert.equal(assessSpam({}, { spam: true }).classification, 'spam')
  assert.equal(assessSpam({}, { blocked: true }).classification, 'spam')
  assert.equal(assetVisible(assessSpam({}), 'hide'), false)
  assert.equal(displayText('A\u202eBC', 'Unknown'), 'ABC')
})
