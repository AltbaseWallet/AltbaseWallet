import assert from 'node:assert/strict'
import test from 'node:test'
import { getBytes, hexlify, sha256 } from 'ethers'
import { assertProvenUtxo, verifiedTransactionOutputs } from '../src/utils/utxoTransactionProof.ts'

const script = `76a914${'11'.repeat(20)}88ac`
const input = `${'aa'.repeat(32)}0000000000ffffffff`
const output = `00e1f5050000000019${script}` // 100,000,000 satoshis
const raw = `0100000001${input}01${output}00000000`
const txid = (hex: string) => hexlify(getBytes(sha256(sha256(`0x${hex}`))).reverse()).slice(2)

test('legacy input amount is bound to the previous transaction, not the node summary', () => {
  const outputs = verifiedTransactionOutputs(raw, txid(raw))
  assert.equal(outputs[0].satoshis, 100_000_000n)
  assert.doesNotThrow(() => assertProvenUtxo(outputs[0], { satoshis: '100000000', script }))
  assert.throws(() => assertProvenUtxo(outputs[0], { satoshis: '1000000', script }), /does not match/)
  assert.throws(() => assertProvenUtxo(undefined, { satoshis: '100000000', script }), /does not match/)
})

test('a modified proof cannot keep the original transaction id', () => {
  assert.throws(() => verifiedTransactionOutputs(raw.replace('00e1f505', '40420f00'), txid(raw)), /hash does not match/)
  assert.throws(() => verifiedTransactionOutputs(raw.slice(0, -6), txid(raw)), /Truncated/)
})

test('SegWit proof is checked against the txid with witnesses removed', () => {
  const witnessed = `01000000000101${input}01${output}0101aa00000000`
  assert.equal(verifiedTransactionOutputs(witnessed, txid(raw))[0].satoshis, 100_000_000n)
  assert.throws(() => verifiedTransactionOutputs(witnessed, txid(witnessed)), /hash does not match/)
})

test('Peercoin v2 proofs retain nTime while v3 uses the standard header', () => {
  for (const version of [2, 3]) {
    const header = Buffer.alloc(version < 3 ? 8 : 4)
    header.writeInt32LE(version)
    if (version < 3) header.writeUInt32LE(1700000000, 4)
    const body = Buffer.from('01' + '11'.repeat(32) + '0000000000ffffffff01e803000000000000015100000000', 'hex')
    const raw = Buffer.concat([header, body])
    const txid = Buffer.from(getBytes(sha256(sha256(raw)))).reverse().toString('hex')
    const outputs = verifiedTransactionOutputs(raw.toString('hex'), txid, { peercoin: true })
    assert.deepEqual(outputs, [{ satoshis: 1000n, script: '51' }])
  }
})
