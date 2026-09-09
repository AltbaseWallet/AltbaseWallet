import type { Transaction } from '../types/transaction'

export const normalizedTransactionHash = (hash: string) => hash.trim().toLowerCase()

export const transactionIdentityKey = (tx: Pick<Transaction, 'coinId' | 'txHash' | 'id'>) => {
  const hash = normalizedTransactionHash(tx.txHash)
  return `${tx.coinId}:${hash || `missing:${tx.id}`}`
}

const statusRank: Record<Transaction['status'], number> = {
  failed: 0,
  pending: 1,
  confirmed: 2,
}

// Account sends record an estimate before broadcast. Once mined, history
// contains the receipt fee after unused gas and any price difference are returned.
export const confirmedAccountTransactionFee = (previous: Transaction, incoming: Transaction) => {
  if (incoming.coinId !== 'quai' && incoming.coinId !== 'xgr') return undefined
  for (const tx of [incoming, previous]) {
    if (tx.status === 'confirmed' && tx.fee !== undefined && /^\d+(?:\.\d+)?$/.test(tx.fee)) return tx.fee
  }
  return undefined
}

export const dedupeTransactionsByIdentity = (transactions: Transaction[]) => {
  const byKey = new Map<string, Transaction>()
  for (const tx of transactions) {
    const key = transactionIdentityKey(tx)
    const previous = byKey.get(key)
    if (!previous) {
      byKey.set(key, tx)
      continue
    }

    const preferred = statusRank[tx.status] > statusRank[previous.status] ? tx : previous
    const fallback = preferred === tx ? previous : tx
    byKey.set(key, {
      ...preferred,
      type: previous.type === 'outgoing' || tx.type === 'outgoing' ? 'outgoing' : preferred.type,
      amount: previous.type === 'outgoing' ? previous.amount : preferred.amount,
      fee: confirmedAccountTransactionFee(previous, tx)
        ?? (previous.type === 'outgoing' ? previous.fee ?? tx.fee : preferred.fee ?? fallback.fee),
      from: previous.type === 'outgoing' ? previous.from ?? tx.from : preferred.from ?? fallback.from,
      to: previous.type === 'outgoing' ? previous.to ?? tx.to : preferred.to ?? fallback.to,
      internal: previous.internal ?? tx.internal,
      balanceBefore: previous.balanceBefore ?? tx.balanceBefore,
      expectedBalanceAfter: previous.expectedBalanceAfter ?? tx.expectedBalanceAfter,
      spentOutpoints: previous.spentOutpoints ?? tx.spentOutpoints,
      broadcastUncertain: preferred.status === 'confirmed'
        ? false
        : (previous.broadcastUncertain ?? tx.broadcastUncertain),
      createdAt: previous.createdAt || tx.createdAt,
      blockHeight: preferred.blockHeight ?? fallback.blockHeight,
      confirmations: preferred.confirmations ?? fallback.confirmations,
    })
  }
  return Array.from(byKey.values())
}
