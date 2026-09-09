export type SendFeeMode = 'auto' | 'manual'

// Automatic fees are recalculated against the final UTXO set immediately
// before signing. Locking an earlier MAX estimate turns it into a manual fee
// and can underpay when the number of spendable inputs changes.
export const shouldLockFinalFee = (feeMode: SendFeeMode, privacyCoin: boolean) =>
  feeMode === 'manual' || privacyCoin

const amountUnits = (value: string) => {
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) throw new Error('Invalid transaction amount')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

export class SpendApprovalChangedError extends Error {
  readonly code = 'SPEND_APPROVAL_CHANGED'
}

export const isSpendApprovalChanged = (error: unknown) =>
  error instanceof SpendApprovalChangedError
  || (error instanceof Error && /^(The network fee increased\.|The MAX amount changed\.|CKB MAX amount changed)/.test(error.message))

/** Recalculation may lower a fee, but cannot increase the user's approval. */
export const assertApprovedSpend = (params: {
  actualFee: string
  maxFee?: string
  actualAmount: string
  approvedAmount: string
  sendMax?: boolean
}) => {
  if (params.maxFee !== undefined && amountUnits(params.actualFee) > amountUnits(params.maxFee)) {
    throw new SpendApprovalChangedError('The network fee increased. Review the updated fee and confirm again.')
  }
  if (params.sendMax && amountUnits(params.actualAmount) !== amountUnits(params.approvedAmount)) {
    throw new SpendApprovalChangedError('The MAX amount changed. Click MAX again and confirm the updated amount.')
  }
}
