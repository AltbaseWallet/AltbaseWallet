import type { Transaction } from '../types/transaction'

const EPIC_PENDING_CONFIRMATION_WINDOW_MS = 10 * 60_000

const txTimeMs = (tx: Pick<Transaction, 'createdAt'>) => {
  const value = Date.parse(tx.createdAt)
  return Number.isFinite(value) ? value : 0
}

const normalizedAddress = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized === 'restore' ? '' : normalized
}

const pendingMatchesConfirmed = (pending: Transaction, confirmed: Transaction) => {
  if (
    pending.coinId !== 'epic'
    || confirmed.coinId !== 'epic'
    || pending.status !== 'pending'
    || confirmed.status !== 'confirmed'
    || pending.type !== confirmed.type
    || pending.amount !== confirmed.amount
  ) return false

  const pendingTime = txTimeMs(pending)
  const confirmedTime = txTimeMs(confirmed)
  if (
    pendingTime <= 0
    || confirmedTime <= 0
    || Math.abs(pendingTime - confirmedTime) > EPIC_PENDING_CONFIRMATION_WINDOW_MS
  ) return false

  const pendingTo = normalizedAddress(pending.to)
  const confirmedTo = normalizedAddress(confirmed.to)
  if (pendingTo && confirmedTo && pendingTo !== confirmedTo) return false

  const pendingFrom = normalizedAddress(pending.from)
  const confirmedFrom = normalizedAddress(confirmed.from)
  if (pendingFrom && confirmedFrom && pendingFrom !== confirmedFrom) return false

  if (pending.type === 'outgoing') {
    if (!pendingTo || !confirmedTo || pendingTo !== confirmedTo) return false
    if (pending.fee && confirmed.fee && pending.fee !== confirmed.fee) return false
  }
  return true
}

export const reconcileEpicPendingDuplicates = (
  previous: Transaction[],
  incoming: Transaction[],
) => {
  const confirmed = incoming.filter((tx) => tx.coinId === 'epic' && tx.status === 'confirmed')
  if (confirmed.length === 0) return { transactions: previous, removedCount: 0 }

  const claimedConfirmed = new Set<string>()
  let removedCount = 0
  const transactions = previous.filter((pending) => {
    if (pending.coinId !== 'epic' || pending.status !== 'pending') return true
    const match = confirmed
      .filter((candidate) => !claimedConfirmed.has(candidate.txHash.toLowerCase()))
      .filter((candidate) => pendingMatchesConfirmed(pending, candidate))
      .sort((a, b) => Math.abs(txTimeMs(a) - txTimeMs(pending)) - Math.abs(txTimeMs(b) - txTimeMs(pending)))[0]
    if (!match) return true
    claimedConfirmed.add(match.txHash.toLowerCase())
    removedCount += 1
    return false
  })
  return { transactions, removedCount }
}
