import type { Cell, Transaction } from '@ckb-ccc/core'

export const assertProvenCkbCell = (transaction: Transaction | undefined, cell: Cell) => {
  if (!transaction || transaction.hash().toLowerCase() !== cell.outPoint.txHash.toLowerCase()) {
    throw new Error('CKB previous transaction hash does not match the input')
  }
  const index = Number(cell.outPoint.index)
  const output = transaction.outputs[index]
  if (!output || output.capacity !== cell.cellOutput.capacity
    || !output.lock.eq(cell.cellOutput.lock)
    || (output.type ? !cell.cellOutput.type || !output.type.eq(cell.cellOutput.type) : !!cell.cellOutput.type)
    || transaction.outputsData[index] !== cell.outputData) {
    throw new Error('CKB input capacity, script or data does not match its transaction')
  }
}
