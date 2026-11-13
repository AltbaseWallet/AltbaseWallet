/** A locally identified transaction may have reached the node despite an error. */
export class BroadcastError extends Error {
  readonly txid: string
  readonly uncertain: boolean

  constructor(message: string, txid: string, uncertain: boolean) {
    super(message)
    this.name = 'BroadcastError'
    this.txid = txid
    this.uncertain = uncertain
  }
}

export const isAlreadyAcceptedBroadcastError = (error: unknown) =>
  error instanceof Error
  && /already in block chain|already known|already have transaction|already in (?:the )?mempool|txn-already-known/i.test(error.message)

export const isDeterministicBroadcastRejection = (error: unknown) => {
  if (!(error instanceof Error)) return false
  const status = Number((error as Error & { status?: number }).status)
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408) return true
  return /bad-txns-inputs-missingorspent|missing.?or.?spent|txn-mempool-conflict|min relay fee not met|mempool full|mempool-script-verify-flag-failed|mandatory-script-verify|non-mandatory-script-verify|bad-txns|insufficient fee|dust/i.test(error.message)
}

/** Submit once; the caller retains its durable checkpoint on an uncertain error. */
export async function submitIdentifiedTransaction(txid: string, submit: () => Promise<string>): Promise<void> {
  try {
    const actual = await submit()
    if (typeof actual !== 'string' || actual.trim().toLowerCase() !== txid.toLowerCase()) {
      throw new BroadcastError('Relay returned a different transaction ID', txid, true)
    }
  } catch (error) {
    if (error instanceof BroadcastError) throw error
    if (!isAlreadyAcceptedBroadcastError(error)) {
      throw new BroadcastError(error instanceof Error ? error.message : 'Transaction submission failed', txid, !isDeterministicBroadcastRejection(error))
    }
  }
}
