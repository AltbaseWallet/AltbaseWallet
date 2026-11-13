'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createJiti } = require('jiti'), { k12 } = require('@noble/hashes/sha3-addons')
const { QubicHelper } = require('@qubic-lib/qubic-ts-library/dist/qubicHelper')
test('Qubic transaction IDs match independent KangarooTwelve digests and the SDK canonical encoder offline', async () => {
  const { qubicTransactionId } = await createJiti(__filename).import('../src/utils/qubicTransactionId.ts')
  const sdk = new QubicHelper()
  for (const size of [144, 145, 256, 8192]) {
    const wire = Uint8Array.from({ length: size }, (_, i) => (i * 17 + size) & 255)
    const expected = await sdk.getHumanReadableBytes(k12(wire))
    assert.equal(await qubicTransactionId(wire), expected)
    assert.match(expected, /^[a-z]{60}$/)
  }
  await assert.rejects(qubicTransactionId(new Uint8Array(143)), /Invalid/)
})
