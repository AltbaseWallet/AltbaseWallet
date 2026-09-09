import type { Transaction } from '../types/transaction'

/** Old releases inferred execution from a scheduled tick or a relay acknowledgement. */
export const normalizeQubicTransaction = (tx: Transaction): Transaction => {
  if (tx.coinId !== 'qubic' || tx.verification === 'verified') return tx
  return { ...tx, status: 'pending', confirmations: 0, verification: 'unverified' }
}
