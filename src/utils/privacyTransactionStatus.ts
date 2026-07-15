import type { TransactionStatus } from '../types/transaction'

export const privacyStatusAfterConfirmations = (
  status: TransactionStatus,
  confirmations: number,
): TransactionStatus => (
  status === 'confirmed' && confirmations < 1 ? 'pending' : status
)
