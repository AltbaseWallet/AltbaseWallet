export type SendFeeMode = 'auto' | 'manual'

// Automatic fees are recalculated against the final UTXO set immediately
// before signing. Locking an earlier MAX estimate turns it into a manual fee
// and can underpay when the number of spendable inputs changes.
export const shouldLockFinalFee = (feeMode: SendFeeMode, privacyCoin: boolean) =>
  feeMode === 'manual' || privacyCoin
