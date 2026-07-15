export type ConfirmationStatus = 'pending' | 'confirmed' | 'failed'

const nonNegativeInteger = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export const resolveTransactionConfirmations = (
  status: ConfirmationStatus,
  reportedConfirmations: unknown,
  blockHeight: unknown,
  tipHeight: unknown,
) => {
  if (status !== 'confirmed') return 0

  const block = nonNegativeInteger(blockHeight)
  const tip = nonNegativeInteger(tipHeight)
  const confirmationsFromHeight = block > 0 && tip >= block ? tip - block + 1 : 0

  return Math.max(1, nonNegativeInteger(reportedConfirmations), confirmationsFromHeight)
}
