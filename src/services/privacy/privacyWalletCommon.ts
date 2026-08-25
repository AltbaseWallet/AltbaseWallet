import type { NativePrivacyRecoveryProgress } from '../nativeCoreService'
import type { PrivacyWalletResponse } from '../privacyWalletTypes'

export const summarizeProgress = (progress: NativePrivacyRecoveryProgress) => ({
  progressToken: progress.progressToken,
  fromHeight: progress.fromHeight,
  currentHeight: progress.currentHeight,
  tipHeight: progress.tipHeight,
  totalBlocks: progress.totalBlocks,
  scannedBlocks: progress.scannedBlocks,
  blocksRemaining: progress.blocksRemaining,
  percent: progress.percent,
})

export type NativeProgressLogState = Map<string, {
  at: number
  currentHeight: number
  blocksRemaining: number
  percent: number
}>

export const shouldLogNativeProgress = (
  state: NativeProgressLogState,
  key: string,
  progress: NativePrivacyRecoveryProgress,
) => {
  const previous = state.get(key)
  const now = Date.now()
  if (!previous) {
    state.set(key, {
      at: now,
      currentHeight: progress.currentHeight,
      blocksRemaining: progress.blocksRemaining,
      percent: progress.percent,
    })
    return true
  }
  const smallRange = progress.blocksRemaining <= 50 || progress.totalBlocks <= 200
  const heightDelta = smallRange ? 1 : 100
  const remainingDelta = smallRange ? 1 : 100
  const shouldLog = Math.abs(progress.currentHeight - previous.currentHeight) >= heightDelta
    || Math.abs(progress.blocksRemaining - previous.blocksRemaining) >= remainingDelta
    || progress.percent !== previous.percent
    || now - previous.at >= 10_000
    || progress.blocksRemaining === 0
  if (shouldLog) {
    state.set(key, {
      at: now,
      currentHeight: progress.currentHeight,
      blocksRemaining: progress.blocksRemaining,
      percent: progress.percent,
    })
  }
  return shouldLog
}

const privacyTxDirection = (tx: unknown) => {
  if (!tx || typeof tx !== 'object') return ''
  const item = tx as {
    type?: unknown
    direction?: unknown
    tx_type?: unknown
    is_income?: unknown
  }
  if (item.is_income === true) return 'incoming'
  if (item.is_income === false) return 'outgoing'
  return String(item.type ?? item.direction ?? item.tx_type ?? '').toLowerCase()
}

const privacyTxKey = (tx: unknown, fallback: number) => {
  if (!tx || typeof tx !== 'object') return `fallback:${fallback}`
  const item = tx as {
    id?: unknown
    txid?: unknown
    txId?: unknown
    txHash?: unknown
    tx_hash?: unknown
    hash?: unknown
  }
  return String(item.txid ?? item.txId ?? item.txHash ?? item.tx_hash ?? item.hash ?? item.id ?? `fallback:${fallback}`).toLowerCase()
}

export const summarizePrivacyTransactions = (transactions?: unknown[]) => {
  let incoming = 0
  let outgoing = 0
  let unknown = 0
  let spentIncoming = 0
  const heights: number[] = []
  const first: Array<{
    key: string
    direction: string
    amount?: unknown
    fee?: unknown
    status?: unknown
    height?: unknown
    spent?: unknown
  }> = []
  for (const [index, tx] of (transactions ?? []).entries()) {
    const direction = privacyTxDirection(tx)
    if (direction.includes('incoming') || direction.includes('received')) incoming += 1
    else if (direction.includes('outgoing') || direction.includes('txsent')) outgoing += 1
    else unknown += 1
    if (!tx || typeof tx !== 'object') continue
    const item = tx as {
      amount?: unknown
      fee?: unknown
      status?: unknown
      height?: unknown
      blockHeight?: unknown
      block_height?: unknown
      spent?: unknown
    }
    if (item.spent === true && (direction.includes('incoming') || direction.includes('received'))) spentIncoming += 1
    const height = Number(item.height ?? item.blockHeight ?? item.block_height ?? 0)
    if (Number.isFinite(height) && height > 0) heights.push(Math.floor(height))
    if (first.length < 5) {
      first.push({
        key: privacyTxKey(tx, index),
        direction,
        amount: item.amount,
        fee: item.fee,
        status: item.status,
        height: item.height ?? item.blockHeight ?? item.block_height,
        spent: item.spent,
      })
    }
  }
  return {
    count: transactions?.length ?? 0,
    incoming,
    outgoing,
    unknown,
    spentIncoming,
    minHeight: heights.length ? Math.min(...heights) : undefined,
    maxHeight: heights.length ? Math.max(...heights) : undefined,
    first,
  }
}

export const summarizePrivacyResponse = (response: PrivacyWalletResponse | null | undefined) => ({
  ok: response?.ok,
  code: response?.code,
  error: response?.error,
  address: response?.address,
  balance: response?.balance,
  spendable: response?.spendable,
  txCount: response?.transactions?.length ?? 0,
  tx: summarizePrivacyTransactions(response?.transactions),
  restoreStartHeight: response?.restoreStartHeight,
  lastScannedHeight: response?.lastScannedHeight,
  scanStateLength: response?.scanState?.length ?? 0,
  sourceCode: response?.sourceCode,
  verifiedSpendState: response?.verifiedSpendState === true,
  nativeWalletFileName: response?.nativeWalletFileName,
  nativeWalletFileSize: response?.nativeWalletFileSize,
  hasNativeWalletFileBlob: Boolean(response?.nativeWalletFileBlob),
  cacheHistoryRegression: response?.cacheHistoryRegression === true,
  hasServerStatus: Boolean(response?.serverStatus),
})

export const positiveHeight = (value: unknown) => {
  const height = Number(value ?? 0)
  return Number.isFinite(height) && height > 0 ? Math.floor(height) : 0
}

export const hasSpendableReady = (response: PrivacyWalletResponse) => {
  if (!response.ok) return false
  const balance = Number.parseFloat(String(response.balance ?? '0'))
  const spendable = Number.parseFloat(String(response.spendable ?? '0'))
  return !(Number.isFinite(balance) && balance > 0 && !(Number.isFinite(spendable) && spendable > 0))
}

export const hasNativeBalanceReady = (response: PrivacyWalletResponse, nativeCode: string) => {
  if (hasSpendableReady(response)) return true
  if (!response.ok || response.code !== nativeCode) return false
  const balance = Number.parseFloat(String(response.balance ?? '0'))
  const spendable = Number.parseFloat(String(response.spendable ?? '0'))
  return Number.isFinite(balance)
    && balance > 0
    && !(Number.isFinite(spendable) && spendable > 0)
    && (response.transactions?.length ?? 0) > 0
}

export const assertOk = (response: PrivacyWalletResponse) => {
  if (!response.ok) throw new Error(response.error || response.code || 'Local wallet engine error')
  return response
}

export const cachedSnapshotResponse = (
  coin: 'zano' | 'epic' | 'monero',
  cached: {
    address?: string
    balance?: string
    spendable?: string
    transactions?: unknown[]
    restoreStartHeight?: number
    lastScannedHeight?: number
    scanState?: string
    sourceCode?: string
    verifiedSpendState?: boolean
    nativeWalletFileName?: string
    nativeWalletFileBlob?: string
    nativeWalletFileSize?: number
  },
): PrivacyWalletResponse => ({
  ok: true,
  code: `${coin}-encrypted-cache`,
  address: cached.address,
  balance: cached.balance,
  spendable: cached.spendable,
  transactions: cached.transactions,
  restoreStartHeight: cached.restoreStartHeight,
  lastScannedHeight: cached.lastScannedHeight,
  scanState: cached.scanState,
  sourceCode: cached.sourceCode,
  verifiedSpendState: cached.verifiedSpendState,
  nativeWalletFileName: cached.nativeWalletFileName,
  nativeWalletFileBlob: cached.nativeWalletFileBlob,
  nativeWalletFileSize: cached.nativeWalletFileSize,
})
