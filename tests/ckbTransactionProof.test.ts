import assert from 'node:assert/strict'
import test from 'node:test'
import { Cell, Transaction } from '@ckb-ccc/core'
import { assertProvenCkbCell } from '../src/utils/ckbTransactionProof.ts'

test('CKB inputs must match the capacity and scripts committed by their outpoint', () => {
  const lock = { codeHash: `0x${'11'.repeat(32)}`, hashType: 'type' as const, args: '0x1234' }
  const transaction = Transaction.from({ outputs: [{ capacity: 200_00000000n, lock }], outputsData: ['0x'] })
  const cell = Cell.from({ outPoint: { txHash: transaction.hash(), index: 0 }, cellOutput: transaction.outputs[0], outputData: '0x' })
  assert.doesNotThrow(() => assertProvenCkbCell(transaction, cell))
  const underreported = cell.clone()
  underreported.cellOutput.capacity = 100_00000000n
  assert.throws(() => assertProvenCkbCell(transaction, underreported), /capacity, script or data/)
  const tampered = transaction.clone()
  tampered.outputs[0].capacity = 100_00000000n
  assert.throws(() => assertProvenCkbCell(tampered, underreported), /hash does not match/)
  assert.throws(() => assertProvenCkbCell(undefined, cell), /hash does not match/)
})
