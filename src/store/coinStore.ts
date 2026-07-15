import { create } from 'zustand'
import type { Coin } from '../types/coin'
import type { Transaction } from '../types/transaction'
import { atomicAmountToBigInt, coinApiService, networkToStatus, type CoinBalance, type Utxo, type WalletSnapshotCoin, type WalletSnapshotResponse } from '../services/coinApiService'
import { coinService } from '../services/coinService'
import { privacyWalletService, type NativePrivacyRecoveryProgress, type PrivacyCoin, type PrivacyWalletResponse } from '../services/privacyWalletService'
import { privacyBirthService } from '../services/privacyBirthService'
import { storageService } from '../services/storageService'
import { walletService } from '../services/walletService'
import { walletSnapshotService } from '../services/walletSnapshotService'
import { buildWalletLoadProgress, type WalletLoadProgressHandler } from '../types/walletLoadProgress'
import { fromBaseUnits, toBaseUnits } from '../utils/decimalAmount'
import { coinDebugLog, quaiDebugLog, quaiDebugLogError } from '../utils/quaiDebugLog'
import { isWalletAddressVariant } from '../utils/walletAddressOwnership'
import { isPrivacyCoin } from '../utils/privacyCoins'
import { isAccountCoin } from '../utils/accountCoins'
import { isUtxoCoin } from '../utils/utxoCoins'
import { shouldUseFreshIncomingUtxoOverlay } from '../utils/utxoBalanceSyncProfile'

type ReservedOutgoing = {
  coinId: string
  amount: string
  fee?: string
  txHash?: string
  from?: string
  to?: string
  internal?: boolean
  status?: Transaction['status']
  spentOutpoints?: Transaction['spentOutpoints']
  balanceBefore?: string
  expectedBalanceAfter?: string
  createdAt: string
}

type ApplyTransactionBalanceDeltaOptions = {
  allowIncomingLedgerDelta?: boolean
  allowConfirmedIncomingLedgerDelta?: boolean
  incomingExpectedBalance?: string
  forceOutgoingExpectedBalance?: boolean
}

type CoinStore = {
  coins: Coin[]
  /** True only on the very first hydrate (no cached coins yet) */
  loading: boolean
  /** True while a background refresh is in progress */
  refreshing: boolean
  selectedCoinId: string | null
  /** Per-coin: last time we saw `active` from the gateway (ms). Used for
   *  stickiness so a single transient timeout doesn't flip the badge. */
  lastActiveAt: Record<string, number>
  /** Per-coin: consecutive non-active responses since the last `active`. */
  consecutiveFailures: Record<string, number>
  /** Per-coin: consecutive zero-balance reads while cached balance was non-zero. */
  zeroBalanceReads: Record<string, number>
  /** Locally accepted outgoing broadcasts that are still pending on-chain. */
  reservedOutgoing: Record<string, ReservedOutgoing>
  /** Last successful status/balance startup base load in this app session. */
  sendReadyLoadedAt: number
  loadNetworkStatuses: () => Promise<void>
  loadSendReadyState: (onProgress?: WalletLoadProgressHandler) => Promise<void>
  loadCoins: (options?: { forceBalances?: boolean; bootstrapBalances?: boolean; onlyCoinIds?: string[]; skipHistoryRefresh?: boolean; skipIncomingHistoryFetch?: boolean }) => Promise<void>
  refreshPrivacyBalances: () => Promise<void>
  recordFreshIncomingTransactions: (transactions: Transaction[]) => void
  syncPendingOutgoingReservations: (transactions: Transaction[]) => void
  selectCoin: (coinId: string | null) => void
  toggleFavorite: (id: string) => Promise<void>
  toggleEnabled: (id: string) => Promise<void>
  resetVisibility: () => Promise<void>
  resetFavorites: () => Promise<void>
  resetCoinsForCurrentWallet: () => Promise<void>
  rescanPrivacyCoin: (coinId: 'zano' | 'epic', fromHeight: number) => Promise<void>
  applyTransactionBalanceDelta: (tx: Transaction, options?: ApplyTransactionBalanceDeltaOptions) => Promise<boolean>
  releaseOutgoingReservation: (txHash: string) => void
  restoreCoinBalance: (coinId: string, balance: string, spendableBalance?: string) => Promise<void>
}

// Stickiness window вЂ” keeps the badge calm against transient API hiccups.
// As long as we've seen the coin `active` within this window AND haven't yet
// hit the failure threshold of consecutive bad reads, we keep showing
// `active`. Tuned to Electrum-like behaviour: a single timeout or even a few
// in a row should never flip the indicator if the coin was just fine.
const STICKY_ACTIVE_MS = 10 * 60_000  // 10 minutes
const FAILURE_THRESHOLD = 5            // need 5 bad reads in a row to flip
const ZERO_BALANCE_THRESHOLD = 3        // avoid transient indexer zeros wiping UI
const RESERVED_OUTGOING_KEY = 'pending-outgoing-reservations'
const TRANSACTIONS_KEY = 'transactions'
const SELECTED_COIN_KEY = 'selected-coin-id'
const ORPHAN_RESERVATION_TTL_MS = 24 * 60 * 60_000
const LONG_RESERVATION_TTL_MS = 7 * 24 * 60 * 60_000
const CONFIRMED_RESERVATION_TTL_MS = 90_000
const PRIVACY_STARTUP_SNAPSHOT_TIMEOUT_MS = 2_500
const PRIVACY_BACKGROUND_SNAPSHOT_TIMEOUT_MS = 10 * 60_000
const PRIVACY_BACKGROUND_REFRESH_MS = 8_000
const EPIC_BACKGROUND_REFRESH_MS = 60_000
const PRIVACY_CACHE_BACKGROUND_WARM_MS = 60_000
const PRIVACY_CACHE_READY_BLOCK_GRACE = 10
const PRIVACY_PROGRESS_STICKY_MS = 10 * 60_000
const SEND_READY_PREFETCH_TIMEOUT_MS = 800
const SEND_READY_NETWORK_TIMEOUT_MS = 8_000
const SEND_READY_BALANCE_TIMEOUT_MS = 12_000
const SEND_READY_FRESH_MS = 2 * 60_000
const UTXO_BALANCE_FALLBACK_TIMEOUT_MS = 3_500
const INCOMING_BALANCE_GATE_MS = 24 * 60 * 60_000
const FRESH_INCOMING_BALANCE_GATE_MS = 2 * 60_000
const ACCOUNT_BALANCE_DROP_MATCH_TOLERANCE_UNITS = 100n
const INCOMING_HISTORY_SYNC_TIMEOUT_MS = 3_500
let coinLoadSeq = 0
let privacyBalanceRefreshInFlight = false
const privacyLastRefreshAt: Partial<Record<PrivacyCoin, number>> = {}
const privacyCacheWarmStartedAt: Partial<Record<PrivacyCoin, number>> = {}
const privacyNativeVerificationRequired = new Set<PrivacyCoin>()
const privacyDisplayReadyCoins = new Set<PrivacyCoin>()
const privacyLastRecoveryProgress = new Map<PrivacyCoin, {
  progress: NonNullable<Coin['recoveryProgress']>
  updatedAt: number
}>()
const privacyProgressDebugState = new Map<string, {
  at: number
  currentHeight: number
  blocksRemaining: number
  status?: Coin['status']
}>()
const appliedIncomingBalanceDeltas = new Set<string>()
const freshIncomingBalanceGateTxs = new Map<string, { expiresAt: number; transaction: Transaction }>()
const scopedKey = (key: string) => `${key}:${walletService.getWalletStorageScope()}`
const stillSameWallet = (expectedScope?: string, expectedMnemonic?: string) =>
  (!expectedScope || walletService.getWalletStorageScope() === expectedScope)
  && (!expectedMnemonic || walletService.getSessionMnemonic() === expectedMnemonic)
const normalizedTxHash = (hash: string) => hash.trim().toLowerCase()
const txKey = (tx: Pick<Transaction, 'coinId' | 'txHash'>) => `${tx.coinId}:${normalizedTxHash(tx.txHash)}`
const summarizeCoinState = (coin: Pick<Coin, 'balance' | 'spendableBalance' | 'status'> | undefined | null) =>
  coin
    ? {
        balance: coin.balance,
        spendableBalance: coin.spendableBalance,
        status: coin.status,
      }
    : null
const isQuaiAccountCoin = (coin: Pick<Coin, 'id' | 'walletEngine'> | undefined | null) =>
  coin?.id === 'quai' && coin.walletEngine === 'quai-account'
const UTXO_INCOMING_DEBUG_COIN_IDS = new Set(['scash', 'pepecoin', 'neoxa', 'junkcoin'])
const shouldDebugUtxoIncomingCoin = (coinId: string) => UTXO_INCOMING_DEBUG_COIN_IDS.has(coinId)
const PRIVACY_DEBUG_COIN_IDS = new Set(['zano', 'epic'])
const shouldDebugPrivacyCoin = (coinId: string) => PRIVACY_DEBUG_COIN_IDS.has(coinId)
const privacyDebugLog = (coinId: string, event: string, fields: Record<string, unknown> = {}) => {
  if (shouldDebugPrivacyCoin(coinId)) coinDebugLog(coinId, event, fields)
}
const summarizeQuaiCoin = (coin: Pick<Coin, 'id' | 'balance' | 'spendableBalance' | 'status'> | undefined | null) =>
  coin?.id === 'quai'
    ? {
        balance: coin.balance,
        spendableBalance: coin.spendableBalance,
        status: coin.status,
      }
    : null
const summarizePearlCoin = (coin: Pick<Coin, 'id' | 'balance' | 'spendableBalance' | 'status'> | undefined | null) =>
  coin?.id === 'pearl'
    ? {
        balance: coin.balance,
        spendableBalance: coin.spendableBalance,
        status: coin.status,
      }
    : null
const summarizeQuaiSnapshotCoin = (snapshot: WalletSnapshotCoin | undefined) => {
  if (!snapshot) return null
  return {
    walletBalance: snapshot.walletBalance
      ? {
          balance: snapshot.walletBalance.balance,
          spendable: snapshot.walletBalance.balance_spendable,
          pendingIncoming: snapshot.walletBalance.pendingIncoming,
          pendingOutgoing: snapshot.walletBalance.pendingOutgoing,
          pendingTxids: snapshot.walletBalance.pendingTxids,
          pendingOutgoingTxids: snapshot.walletBalance.pendingOutgoingTxids,
        }
      : null,
    balances: Object.fromEntries(Object.entries(snapshot.balances ?? {}).map(([address, balance]) => [
      address,
      balance
        ? {
            balance: balance.balance,
            spendable: balance.balance_spendable,
            pendingIncoming: balance.pendingIncoming,
            pendingOutgoing: balance.pendingOutgoing,
            pendingTxids: balance.pendingTxids,
            pendingOutgoingTxids: balance.pendingOutgoingTxids,
          }
        : null,
    ])),
    errors: snapshot.errors,
  }
}

const summarizePrivacySnapshot = (snapshot: {
  ok?: boolean
  code?: string
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
  error?: string
} | null | undefined) =>
  snapshot
    ? {
        ok: snapshot.ok,
        code: snapshot.code,
        error: snapshot.error,
        address: snapshot.address,
        balance: snapshot.balance,
        spendable: snapshot.spendable,
        txCount: snapshot.transactions?.length ?? 0,
        restoreStartHeight: snapshot.restoreStartHeight,
        lastScannedHeight: snapshot.lastScannedHeight,
        scanStateLength: snapshot.scanState?.length ?? 0,
        sourceCode: snapshot.sourceCode,
        verifiedSpendState: snapshot.verifiedSpendState === true,
        nativeWalletFileName: snapshot.nativeWalletFileName,
        nativeWalletFileSize: snapshot.nativeWalletFileSize,
        hasNativeWalletFileBlob: Boolean(snapshot.nativeWalletFileBlob),
      }
    : null

const privacySnapshotHeight = (snapshot: { lastScannedHeight?: number; transactions?: unknown[] } | null | undefined) => {
  const explicit = Number(snapshot?.lastScannedHeight ?? 0)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  let best = 0
  for (const tx of snapshot?.transactions ?? []) {
    const height = Number((tx as { height?: unknown; blockHeight?: unknown; block_height?: unknown }).height
      ?? (tx as { blockHeight?: unknown }).blockHeight
      ?? (tx as { block_height?: unknown }).block_height
      ?? 0)
    if (Number.isFinite(height) && height > best) best = Math.floor(height)
  }
  return best
}

const zanoSnapshotRegressesCachedHistory = (
  cached: {
    code?: string
    transactions?: unknown[]
    lastScannedHeight?: number
    scanState?: string
  } | null | undefined,
  local: {
    ok?: boolean
    code?: string
    transactions?: unknown[]
    lastScannedHeight?: number
    scanState?: string
  },
) => {
  if (!cached || !local.ok || local.code !== 'zano-native-wallet') return false
  const cachedTxCount = cached.transactions?.length ?? 0
  const localTxCount = local.transactions?.length ?? 0
  if (cachedTxCount <= localTxCount) return false
  const cachedHeight = privacySnapshotHeight(cached)
  const localHeight = privacySnapshotHeight(local)
  const localIsNotAhead = cachedHeight > 0 && localHeight > 0
    ? localHeight <= cachedHeight
    : localHeight <= 0
  return localIsNotAhead && (Boolean(cached.scanState) || !local.scanState || cachedTxCount - localTxCount >= 2)
}

const snapshotPendingOutgoingUnits = (snapshot: WalletSnapshotCoin | undefined) =>
  (() => {
    const value = atomicAmountToBigInt(snapshot?.walletBalance?.pendingOutgoing)
    return value > 0n ? value : 0n
  })()

const snapshotPendingOutgoingTxids = (snapshot: WalletSnapshotCoin | undefined) => {
  const txids = new Set<string>()
  for (const txid of snapshot?.walletBalance?.pendingOutgoingTxids ?? []) {
    if (txid) txids.add(normalizedTxHash(txid))
  }
  for (const balance of Object.values(snapshot?.balances ?? {})) {
    for (const txid of balance?.pendingOutgoingTxids ?? []) {
      if (txid) txids.add(normalizedTxHash(txid))
    }
  }
  return txids
}

const reservationTrackedBySnapshot = (
  reservation: ReservedOutgoing,
  snapshotTxids: Set<string>,
  snapshotPendingUnits: bigint,
  delta: bigint,
) => {
  const txid = reservation.txHash ? normalizedTxHash(reservation.txHash) : ''
  return (txid && snapshotTxids.has(txid)) || (snapshotPendingUnits > 0n && snapshotPendingUnits >= delta)
}

const pruneFreshIncomingBalanceGateTxs = (now = Date.now()) => {
  for (const [key, entry] of freshIncomingBalanceGateTxs.entries()) {
    if (entry.expiresAt <= now) freshIncomingBalanceGateTxs.delete(key)
  }
}

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const waitForRendererTick = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }
    globalThis.setTimeout(resolve, 0)
  })

const recoveryProgressFromNative = (progress: NativePrivacyRecoveryProgress): NonNullable<Coin['recoveryProgress']> => ({
  fromHeight: progress.fromHeight,
  currentHeight: progress.currentHeight,
  tipHeight: progress.tipHeight,
  totalBlocks: progress.totalBlocks,
  scannedBlocks: progress.scannedBlocks,
  blocksRemaining: progress.blocksRemaining,
  percent: Math.max(0, Math.min(100, progress.percent)),
})

const rememberPrivacyRecoveryProgress = (
  coinId: PrivacyCoin,
  progress?: Coin['recoveryProgress'],
) => {
  if (!progress || (progress.blocksRemaining ?? 0) <= 0) {
    privacyLastRecoveryProgress.delete(coinId)
    return
  }
  privacyLastRecoveryProgress.set(coinId, {
    progress,
    updatedAt: Date.now(),
  })
}

const getRememberedPrivacyRecoveryProgress = (coinId: PrivacyCoin) => {
  const entry = privacyLastRecoveryProgress.get(coinId)
  if (!entry) return undefined
  if (Date.now() - entry.updatedAt > PRIVACY_PROGRESS_STICKY_MS) {
    privacyLastRecoveryProgress.delete(coinId)
    return undefined
  }
  return entry.progress
}

const clearPrivacyRecoveryProgress = (coinId?: PrivacyCoin) => {
  if (coinId) {
    privacyLastRecoveryProgress.delete(coinId)
    return
  }
  privacyLastRecoveryProgress.clear()
}

const privacyProgressDebugLog = (
  coinId: string,
  source: string,
  progress: NonNullable<Coin['recoveryProgress']>,
  fields: Record<string, unknown> = {},
) => {
  if (!shouldDebugPrivacyCoin(coinId)) return
  const key = `${coinId}:${source}`
  const previous = privacyProgressDebugState.get(key)
  const now = Date.now()
  const smallRange = progress.blocksRemaining <= 50 || progress.totalBlocks <= 200
  const heightDelta = smallRange ? 1 : 100
  const remainingDelta = smallRange ? 1 : 100
  const shouldLog = !previous
    || Math.abs(progress.currentHeight - previous.currentHeight) >= heightDelta
    || Math.abs(progress.blocksRemaining - previous.blocksRemaining) >= remainingDelta
    || previous.status !== (fields.status as Coin['status'] | undefined)
    || now - previous.at >= 10_000
    || progress.blocksRemaining === 0
  if (!shouldLog) return
  privacyProgressDebugState.set(key, {
    at: now,
    currentHeight: progress.currentHeight,
    blocksRemaining: progress.blocksRemaining,
    status: fields.status as Coin['status'] | undefined,
  })
  privacyDebugLog(coinId, 'privacy.progress', {
    source,
    progress,
    nativeReadiness: PRIVACY_DEBUG_COIN_IDS.has(coinId)
      ? privacyWalletService.getNativeReadiness(coinId as PrivacyCoin)
      : 'n/a',
    recoveryPending: PRIVACY_DEBUG_COIN_IDS.has(coinId)
      ? privacyBirthService.isRecoveryPending(coinId as PrivacyCoin)
      : false,
    ...fields,
  })
}

const recoveryProgressFromHeights = (
  fromHeight: number,
  currentHeight: number,
  tipHeight: number,
): NonNullable<Coin['recoveryProgress']> => {
  const from = Math.max(0, Math.floor(fromHeight))
  const tip = Math.max(from, Math.floor(tipHeight))
  const current = Math.max(from, Math.min(tip, Math.floor(currentHeight)))
  const totalBlocks = tip >= from ? tip - from + 1 : 0
  const scannedBlocks = totalBlocks > 0 && current >= from ? Math.min(current - from + 1, totalBlocks) : 0
  const blocksRemaining = Math.max(0, totalBlocks - scannedBlocks)
  const percent = totalBlocks === 0 ? 100 : Math.max(0, Math.min(100, Math.floor((scannedBlocks * 100) / totalBlocks)))
  return {
    fromHeight: from,
    currentHeight: current,
    tipHeight: tip,
    totalBlocks,
    scannedBlocks,
    blocksRemaining,
    percent,
  }
}

const emptyWalletSnapshot = (): WalletSnapshotResponse => ({
  prices: {},
  pricesUpdatedAt: null,
  coins: {},
})

const withRecoveryProgress = (
  coins: Coin[],
  coinId: string,
  progress: NativePrivacyRecoveryProgress,
) => coins.map((coin) =>
  {
    if (coin.id !== coinId) return coin
    const nextProgress = recoveryProgressFromNative(progress)
    const previous = coin.recoveryProgress
    const nativeReady = isPrivacyCoin(coin)
      && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) === 'ready'
    const wentBackwards = previous
      && (
        nextProgress.percent < previous.percent
        || nextProgress.scannedBlocks < previous.scannedBlocks
        || (previous.blocksRemaining === 0 && nextProgress.blocksRemaining > 0 && nativeReady)
      )
    if (nativeReady && wentBackwards) {
      rememberPrivacyRecoveryProgress(coinId as PrivacyCoin, undefined)
      privacyProgressDebugLog(coinId, 'native-state', previous ?? nextProgress, {
        status: 'active',
        ignoredBackwards: true,
        incomingProgress: nextProgress,
      })
      return {
        ...coin,
        status: 'active' as Coin['status'],
        recoveryProgress: undefined,
      }
    }
    const status: Coin['status'] = privacyPendingStatus(coin, nextProgress)
    rememberPrivacyRecoveryProgress(coinId as PrivacyCoin, statusKeepsRecoveryProgress(status) ? nextProgress : undefined)
    privacyProgressDebugLog(coinId, 'native-state', wentBackwards ? previous ?? nextProgress : nextProgress, {
      status,
      wentBackwards,
    })
    return {
      ...coin,
      status,
      recoveryProgress: statusKeepsRecoveryProgress(status) ? (wentBackwards ? previous : nextProgress) : undefined,
    }
  },
)

const privacyTransactionTipHeight = (transactions: unknown[] | undefined) => {
  let best = 0
  for (const tx of transactions ?? []) {
    const height = Number((tx as { height?: unknown }).height ?? 0)
    if (Number.isFinite(height) && height > best) best = Math.floor(height)
  }
  return best
}

const cachedPrivacyProgress = async (
  coin: Coin,
  cached: { restoreStartHeight?: number; lastScannedHeight?: number; scanState?: string } | null | undefined,
) => {
  if (!isPrivacyCoin(coin)) return undefined
  const cachedRestoreStart = Number(cached?.restoreStartHeight ?? 0)
  const startHeight = Number.isFinite(cachedRestoreStart) && cachedRestoreStart > 0
    ? Math.floor(cachedRestoreStart)
    : await privacyBirthService.restoreStartHeight(coin.id as PrivacyCoin).catch(() => 0)
  const cachedHeight = privacyTransactionTipHeight((cached as { transactions?: unknown[] } | null | undefined)?.transactions)
  const cachedScannedHeight = Number(cached?.lastScannedHeight ?? 0)
  const network = await coinApiService.tryGetNetwork(coin.id).catch(() => null)
  const tipHeight = Math.max(
    Number(network?.headers ?? 0),
    Number(network?.blocks ?? 0),
    Number.isFinite(cachedScannedHeight) ? cachedScannedHeight : 0,
    cachedHeight,
    startHeight,
  )
  if (!Number.isFinite(tipHeight) || tipHeight <= 0) return undefined
  const currentHeight = Number.isFinite(cachedScannedHeight) && cachedScannedHeight > 0
    ? cachedScannedHeight
    : (Number.isFinite(cachedHeight) && cachedHeight > 0 ? cachedHeight : startHeight)
  const progress = recoveryProgressFromHeights(startHeight, currentHeight, tipHeight)
  const finalProgress = progress.blocksRemaining <= PRIVACY_CACHE_READY_BLOCK_GRACE
    ? completedPrivacyProgress(progress)
    : progress
  rememberPrivacyRecoveryProgress(coin.id as PrivacyCoin, finalProgress)
  privacyProgressDebugLog(coin.id, 'cache-estimate', finalProgress, {
    startHeight,
    cachedScannedHeight,
    cachedTxHeight: cachedHeight,
    networkBlocks: network?.blocks,
    networkHeaders: network?.headers,
    completedByGrace: progress.blocksRemaining <= PRIVACY_CACHE_READY_BLOCK_GRACE,
  })
  return finalProgress
}

const balanceStringFromSnapshot = (
  coin: Coin,
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[],
) => {
  const addressBalances = addresses
    .map((address) => coinSnapshot?.balances?.[address])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (isAccountCoin(coin) && addressBalances.length > 0) {
    const units = addressBalances.reduce(
      (sum, item) => sum + atomicAmountToBigInt(item.balance ?? item.balance_spendable),
      0n,
    )
    return fromBaseUnits(units, decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000))
  }
  const walletBalance = coinSnapshot?.walletBalance
  if (walletBalance) {
    return fromBaseUnits(
      atomicAmountToBigInt(walletBalance.balance ?? walletBalance.balance_spendable),
      decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000),
    )
  }
  const sourceBalances = addressBalances.length > 0
    ? addressBalances
    : (addresses.length === 0 ? [coinSnapshot?.walletBalance].filter((item): item is NonNullable<typeof item> => Boolean(item)) : [])
  if (sourceBalances.length === 0) return null
  const units = sourceBalances.reduce(
    (sum, item) => sum + atomicAmountToBigInt(item.balance ?? item.balance_spendable),
    0n,
  )
  return fromBaseUnits(units, decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000))
}

const mergeWalletSnapshotResults = (
  results: Array<{ items: Array<{ coin: string; addresses: string[] }>; snapshot: WalletSnapshotResponse } | null | undefined>,
) => {
  const merged = {
    items: [] as Array<{ coin: string; addresses: string[] }>,
    snapshot: {
      prices: {} as WalletSnapshotResponse['prices'],
      pricesUpdatedAt: null as WalletSnapshotResponse['pricesUpdatedAt'],
      coins: {} as WalletSnapshotResponse['coins'],
    },
  }
  for (const result of results) {
    if (!result) continue
    const existingItems = new Map(merged.items.map((item) => [item.coin, item]))
    for (const item of result.items) existingItems.set(item.coin, item)
    merged.items = Array.from(existingItems.values())
    Object.assign(merged.snapshot.prices, result.snapshot.prices ?? {})
    if (result.snapshot.pricesUpdatedAt) merged.snapshot.pricesUpdatedAt = result.snapshot.pricesUpdatedAt
    for (const [coinId, coinSnapshot] of Object.entries(result.snapshot.coins ?? {})) {
      merged.snapshot.coins[coinId] = {
        ...merged.snapshot.coins[coinId],
        ...coinSnapshot,
        network: merged.snapshot.coins[coinId]?.network ?? coinSnapshot.network ?? null,
      }
    }
  }
  return merged
}

const spendableStringFromSnapshot = (
  coin: Coin,
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[],
) => {
  if (isAccountCoin(coin) && addresses.length > 0) {
    const balances = addresses
      .map((address) => coinSnapshot?.balances?.[address])
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (balances.length > 0) {
      const units = balances.reduce(
        (sum, item) => sum + atomicAmountToBigInt(item.balance_spendable ?? item.balance),
        0n,
      )
      return fromBaseUnits(units, decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000))
    }
  }
  const balances = snapshotBalancesForAddresses(coinSnapshot, addresses)
  if (balances.length === 0) return null
  const units = balances.reduce(
    (sum, item) => sum + atomicAmountToBigInt(item.balance_spendable ?? item.balance),
    0n,
  )
  return fromBaseUnits(units, decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000))
}

const snapshotBalancesForAddresses = (
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[],
) => {
  if (coinSnapshot?.walletBalance) return [coinSnapshot.walletBalance]
  const balances = addresses
    .map((address) => coinSnapshot?.balances?.[address])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (balances.length > 0) return balances
  if (addresses.length === 0 && coinSnapshot?.walletBalance) return [coinSnapshot.walletBalance]
  return []
}

const snapshotHasSettledAddressBalance = (
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[] = [],
) => snapshotBalancesForAddresses(coinSnapshot, addresses).some((balance) => Number(balance.pendingIncoming ?? 0) === 0)

const addServerTxids = (target: Set<string>, txids: Array<string | undefined | null>) => {
  for (const txid of txids) {
    if (txid) target.add(normalizedTxHash(txid))
  }
}

const noteServerPendingIncoming = (
  txidsByCoin: Map<string, Set<string>>,
  coinsWithoutTxids: Set<string>,
  representedTxidsByCoin: Map<string, Set<string>>,
  coinId: string,
  balance?: CoinBalance | null,
) => {
  if (!balance) return
  const represented = representedTxidsByCoin.get(coinId) ?? new Set<string>()
  addServerTxids(represented, balance.pendingTxids ?? [])
  addServerTxids(represented, balance.pendingOutgoingTxids ?? [])
  addServerTxids(represented, (balance.pendingTransactions ?? []).map((tx) => tx.txid))
  addServerTxids(represented, (balance.utxos ?? []).map((utxo) => utxo.txid))
  if (represented.size > 0) representedTxidsByCoin.set(coinId, represented)

  if (Number(balance.pendingIncoming ?? 0) <= 0) return
  const txids = [
    ...(balance.pendingTxids?.filter(Boolean) ?? []),
    ...(balance.pendingTransactions ?? [])
      .filter((tx) => tx.type === 'incoming')
      .map((tx) => tx.txid)
      .filter(Boolean),
    ...(balance.utxos ?? [])
      .filter((utxo) => Number(utxo.height ?? 0) <= 0)
      .map((utxo) => utxo.txid)
      .filter(Boolean),
  ]
  if (txids.length === 0) {
    coinsWithoutTxids.add(coinId)
    return
  }
  const target = txidsByCoin.get(coinId) ?? new Set<string>()
  addServerTxids(target, txids)
  txidsByCoin.set(coinId, target)
}

const readReservedOutgoing = () => {
  const raw = storageService.get<Record<string, ReservedOutgoing>>(scopedKey(RESERVED_OUTGOING_KEY), {})
  const now = Date.now()
  const pruned = Object.fromEntries(Object.entries(raw).filter(([, reservation]) => {
    if ((reservation.status ?? 'pending') === 'pending') return true
    const createdAtMs = Date.parse(reservation.createdAt)
    return Number.isFinite(createdAtMs) && now - createdAtMs < CONFIRMED_RESERVATION_TTL_MS
  }))
  if (Object.keys(pruned).length !== Object.keys(raw).length) writeReservedOutgoing(pruned)
  return pruned
}

const writeReservedOutgoing = (reservations: Record<string, ReservedOutgoing>) =>
  storageService.set(scopedKey(RESERVED_OUTGOING_KEY), reservations)

const readStoredTransactions = () => {
  const byKey = new Map<string, Transaction>()
  for (const tx of storageService.get<Transaction[]>(scopedKey(TRANSACTIONS_KEY), [])) {
    const key = txKey(tx)
    const prev = byKey.get(key)
    if (!prev || (prev.status === 'pending' && tx.status === 'confirmed')) byKey.set(key, tx)
  }
  return Array.from(byKey.values())
}

const pendingReservationsFromTransactions = (transactions: Transaction[]) => {
  const reservations: Record<string, ReservedOutgoing> = {}
  const now = Date.now()
  for (const tx of transactions) {
    if (tx.type !== 'outgoing' || tx.status === 'failed') continue
    const createdAtMs = Date.parse(tx.createdAt)
    if (tx.status !== 'pending' && Number.isFinite(createdAtMs) && now - createdAtMs >= CONFIRMED_RESERVATION_TTL_MS) continue
    reservations[tx.txHash] = {
      coinId: tx.coinId,
      amount: tx.amount,
      fee: tx.fee,
      txHash: tx.txHash,
      from: tx.from,
      to: tx.to,
      internal: tx.internal === true || sameKnownAddress(tx.from, tx.to),
      status: tx.status,
      spentOutpoints: tx.spentOutpoints,
      balanceBefore: tx.balanceBefore,
      expectedBalanceAfter: tx.expectedBalanceAfter,
      createdAt: tx.createdAt,
    }
  }
  return reservations
}

const pendingReservationsWithStoredMetadata = (transactions: Transaction[]) => {
  const reservations = pendingReservationsFromTransactions(transactions)
  const stored = readReservedOutgoing()
  for (const [hash, reservation] of Object.entries(stored)) {
    if (reservation.status && reservation.status !== 'pending') continue
    const previous = reservations[hash]
    const merged = {
      ...previous,
      ...reservation,
      txHash: reservation.txHash ?? previous?.txHash ?? hash,
      status: reservation.status ?? previous?.status ?? 'pending',
      spentOutpoints: reservation.spentOutpoints ?? previous?.spentOutpoints,
      balanceBefore: reservation.balanceBefore ?? previous?.balanceBefore,
      expectedBalanceAfter: reservation.expectedBalanceAfter ?? previous?.expectedBalanceAfter,
    }
    reservations[hash] = {
      ...merged,
      internal: merged.internal === true || sameKnownAddress(merged.from, merged.to),
    }
  }
  return reservations
}

const sameKnownAddress = (left?: string, right?: string) => {
  const normalizedLeft = left?.trim().toLowerCase()
  const normalizedRight = right?.trim().toLowerCase()
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

const pendingIncomingFromTransactions = (
  transactions: Transaction[],
  serverPendingIncomingTxidsByCoin: Map<string, Set<string>>,
  serverPendingIncomingWithoutTxids: Set<string>,
  serverRepresentedTxidsByCoin: Map<string, Set<string>>,
  coinById: Map<string, Coin>,
) => {
  pruneFreshIncomingBalanceGateTxs()
  const candidatesByKey = new Map<string, Transaction>()
  for (const tx of transactions) {
    if (tx.type === 'incoming' && tx.status === 'pending' && !tx.spent) candidatesByKey.set(txKey(tx), tx)
  }
  for (const [key, entry] of freshIncomingBalanceGateTxs.entries()) {
    const tx = entry.transaction
    if (tx.type === 'incoming' && tx.status === 'pending' && !tx.spent && !candidatesByKey.has(key)) {
      candidatesByKey.set(key, tx)
    }
  }
  const byCoin = new Map<string, { units: bigint; keys: string[] }>()
  for (const tx of candidatesByKey.values()) {
    const key = txKey(tx)
    if (!freshIncomingBalanceGateTxs.has(key)) continue
    if (serverPendingIncomingWithoutTxids.has(tx.coinId)) continue
    const serverTxids = serverPendingIncomingTxidsByCoin.get(tx.coinId)
    const normalizedHash = normalizedTxHash(tx.txHash)
    if (serverTxids?.has(normalizedHash) || serverRepresentedTxidsByCoin.get(tx.coinId)?.has(normalizedHash)) {
      // The server already accounts for this tx in balance data. Keep the gate
      // until preloadIncomingHistory consumes it as proof for the same-cycle
      // balance increase; deleting it here made the tx row commit first and the
      // balance catch up on a later poll.
      continue
    }
    const coin = coinById.get(tx.coinId)
    if (!isUtxoCoin(coin) && !isAccountCoin(coin)) continue
    const decimals = decimalsForSatsPerCoin(coin?.satsPerCoin ?? 100_000_000)
    const amount = toBaseUnits(tx.amount, decimals)
    if (amount <= 0n) continue
    const entry = byCoin.get(tx.coinId) ?? { units: 0n, keys: [] }
    entry.units += amount
    entry.keys.push(key)
    byCoin.set(tx.coinId, entry)
  }
  return byCoin
}

const incomingUnitsAfterReservation = (
  transactions: Transaction[],
  reservation: ReservedOutgoing,
  decimals: number,
  options: { clockSkewGraceMs?: number; includeSpentIncoming?: boolean } = {},
) => {
  const reservationCreatedAtMs = Date.parse(reservation.createdAt)
  if (!Number.isFinite(reservationCreatedAtMs)) return 0n
  const clockSkewGraceMs = options.clockSkewGraceMs ?? 5_000
  let total = 0n
  for (const tx of transactions) {
    if (tx.coinId !== reservation.coinId || tx.type !== 'incoming') continue
    if (tx.spent && !options.includeSpentIncoming) continue
    const txCreatedAtMs = Date.parse(tx.createdAt)
    if (!Number.isFinite(txCreatedAtMs)) continue
    if (txCreatedAtMs < reservationCreatedAtMs - clockSkewGraceMs) continue
    const units = toBaseUnits(tx.amount || '0', decimals)
    if (units > 0n) total += units
  }
  return total
}

const capPrivacyBalanceByPendingOutgoing = (
  coin: Pick<Coin, 'id' | 'satsPerCoin'>,
  balance: string,
  spendableBalance: string | undefined,
  transactions: Transaction[] = readStoredTransactions(),
) => {
  if (coin.id !== 'epic' && coin.id !== 'zano') {
    return { balance, spendableBalance }
  }
  const decimals = decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000)
  const originalBalance = balance
  const originalSpendableBalance = spendableBalance
  let balanceUnits = toBaseUnits(balance || '0', decimals)
  let spendableUnits = toBaseUnits(spendableBalance ?? balance ?? '0', decimals)
  const capDetails: Array<{
    txHash?: string
    status?: Transaction['status']
    amount: string
    fee?: string
    internal?: boolean
    balanceBefore?: string
    expectedBalanceAfter?: string
    createdAt: string
    deltaUnits: string
    expectedAfterUnits: string | null
    laterIncomingUnits: string
    capUnits: string | null
    skipReason?: string
    balanceUnitsBefore: string
    spendableUnitsBefore: string
    balanceUnitsAfter: string
    spendableUnitsAfter: string
  }> = []
  const reservations = Object.values(pendingReservationsWithStoredMetadata(transactions))
    .filter((reservation) => reservation.coinId === coin.id && reservation.status === 'pending')
  for (const reservation of reservations) {
    if (reservation.coinId !== coin.id || reservation.status !== 'pending') continue
    const internal = reservation.internal === true || sameKnownAddress(reservation.from, reservation.to)
    const delta = (internal ? 0n : toBaseUnits(reservation.amount, decimals))
      + toBaseUnits(reservation.fee ?? '0', decimals)
    if (delta <= 0n) continue
    const before = reservation.balanceBefore ? toBaseUnits(reservation.balanceBefore, decimals) : null
    const explicitExpected = reservation.expectedBalanceAfter && !internal
      ? toBaseUnits(reservation.expectedBalanceAfter, decimals)
      : null
    let expectedAfter = explicitExpected ?? (before !== null ? before - delta : null)
    if (expectedAfter !== null && expectedAfter < 0n) expectedAfter = 0n
    const laterIncomingUnits = incomingUnitsAfterReservation(transactions, reservation, decimals, { includeSpentIncoming: true })
    const balanceUnitsBefore = balanceUnits
    const spendableUnitsBefore = spendableUnits
    if (expectedAfter === null) {
      capDetails.push({
        txHash: reservation.txHash,
        status: reservation.status,
        amount: reservation.amount,
        fee: reservation.fee,
        internal,
        balanceBefore: reservation.balanceBefore,
        expectedBalanceAfter: reservation.expectedBalanceAfter,
        createdAt: reservation.createdAt,
        deltaUnits: delta.toString(),
        expectedAfterUnits: null,
        laterIncomingUnits: laterIncomingUnits.toString(),
        capUnits: null,
        skipReason: 'missing-expected-balance',
        balanceUnitsBefore: balanceUnitsBefore.toString(),
        spendableUnitsBefore: spendableUnitsBefore.toString(),
        balanceUnitsAfter: balanceUnits.toString(),
        spendableUnitsAfter: spendableUnits.toString(),
      })
      continue
    }
    const cap = expectedAfter + laterIncomingUnits
    if (balanceUnits > cap) balanceUnits = cap
    if (spendableUnits > cap) spendableUnits = cap
    capDetails.push({
      txHash: reservation.txHash,
      status: reservation.status,
      amount: reservation.amount,
      fee: reservation.fee,
      internal,
      balanceBefore: reservation.balanceBefore,
      expectedBalanceAfter: reservation.expectedBalanceAfter,
      createdAt: reservation.createdAt,
      deltaUnits: delta.toString(),
      expectedAfterUnits: expectedAfter?.toString() ?? null,
      laterIncomingUnits: laterIncomingUnits.toString(),
      capUnits: cap.toString(),
      balanceUnitsBefore: balanceUnitsBefore.toString(),
      spendableUnitsBefore: spendableUnitsBefore.toString(),
      balanceUnitsAfter: balanceUnits.toString(),
      spendableUnitsAfter: spendableUnits.toString(),
    })
  }
  const nextBalance = fromBaseUnits(balanceUnits < 0n ? 0n : balanceUnits, decimals)
  const nextSpendableBalance = spendableBalance === undefined
    ? undefined
    : fromBaseUnits(spendableUnits < 0n ? 0n : spendableUnits, decimals)
  if (reservations.length > 0 || nextBalance !== originalBalance || nextSpendableBalance !== originalSpendableBalance) {
    coinDebugLog(coin.id, `privacy.${coin.id}.pendingOutgoingCap`, {
      input: {
        balance: originalBalance,
        spendableBalance: originalSpendableBalance,
      },
      output: {
        balance: nextBalance,
        spendableBalance: nextSpendableBalance,
      },
      reservations: capDetails,
    })
  }
  return {
    balance: nextBalance,
    spendableBalance: nextSpendableBalance,
  }
}

const pruneReservedOutgoing = (
  reservations: Record<string, ReservedOutgoing>,
  activePendingHashes = new Set<string>(),
  coins: Coin[] = [],
) => {
  const now = Date.now()
  const coinById = new Map(coins.map((coin) => [coin.id, coin]))
  return Object.fromEntries(
    Object.entries(reservations).filter(([hash, reservation]) => {
      if (activePendingHashes.has(hash)) return true
      const coin = coinById.get(reservation.coinId)
      const ttl = reservation.status !== 'pending'
        ? CONFIRMED_RESERVATION_TTL_MS
        : (isUtxoCoin(coin) ? ORPHAN_RESERVATION_TTL_MS : LONG_RESERVATION_TTL_MS)
      return now - Date.parse(reservation.createdAt) < ttl
    }),
  )
}

const normalizeReservedOutgoingFast = (
  reservations: Record<string, ReservedOutgoing>,
  coins: Coin[],
) => {
  const coinById = new Map(coins.map((coin) => [coin.id, coin]))
  return Object.fromEntries(Object.entries(reservations).map(([hash, reservation]) => {
    const coin = coinById.get(reservation.coinId)
    const internal = reservation.internal || Boolean(reservation.to && coin?.address && reservation.to === coin.address)
    return [hash, { ...reservation, internal }] as const
  }))
}

const decimalsForSatsPerCoin = (satsPerCoin = 100_000_000) => {
  let scale = Math.max(1, Math.trunc(satsPerCoin))
  let decimals = 0
  while (scale > 1 && scale % 10 === 0) {
    scale /= 10
    decimals += 1
  }
  return scale === 1 ? decimals : 8
}

const privacySnapshotBalanceFromTransactions = (rawTransactions: unknown[] | undefined, satsPerCoin = 100_000_000) => {
  if (!rawTransactions?.length) return null
  const decimals = decimalsForSatsPerCoin(satsPerCoin)
  const atomicFromRaw = (value: string | number | undefined | null) => {
    if (value === undefined || value === null) return 0n
    if (typeof value === 'number') return BigInt(Math.trunc(value))
    const text = String(value).trim()
    if (!text) return 0n
    if (/^\d+$/.test(text)) return BigInt(text)
    return toBaseUnits(text, decimals)
  }

  let ledgerTotal = 0n
  let liveOutputTotal = 0n
  let sawAmount = false
  let sawOutputMarkers = false
  for (const raw of rawTransactions) {
    const tx = raw as {
      amount?: string | number
      direction?: 'incoming' | 'outgoing'
      type?: 'incoming' | 'outgoing'
      fee?: string | number
      spent?: boolean
      subtransfers?: Array<{ amount?: string | number; is_income?: boolean }>
    }
    const direction = tx.direction ?? tx.type
    if (tx.amount !== undefined && direction) {
      const amount = toBaseUnits(String(tx.amount), decimals)
      const fee = direction === 'outgoing' ? toBaseUnits(String(tx.fee ?? '0'), decimals) : 0n
      if (direction === 'incoming') {
        ledgerTotal += amount
        if (tx.spent !== undefined) {
          sawOutputMarkers = true
          if (!tx.spent) liveOutputTotal += amount
        }
      } else {
        ledgerTotal -= amount + fee
      }
      sawAmount = true
      continue
    }
    for (const transfer of tx.subtransfers ?? []) {
      const amount = atomicFromRaw(transfer.amount)
      ledgerTotal += transfer.is_income ? amount : -amount
      sawAmount = true
    }
  }

  if (!sawAmount) return null
  const total = sawOutputMarkers ? liveOutputTotal : ledgerTotal
  return fromBaseUnits(total < 0n ? 0n : total, decimals)
}

const bestPrivacySnapshotBalance = (
  snapshot: { code?: string; sourceCode?: string; balance?: string; transactions?: unknown[] },
  satsPerCoin = 100_000_000,
) => {
  const transactionBalance = privacySnapshotBalanceFromTransactions(snapshot.transactions, satsPerCoin)
  if (snapshot.balance !== undefined && snapshot.balance !== '') {
    const parsedBalance = Number.parseFloat(snapshot.balance)
    const authoritativePrivacyCode = snapshot.code?.startsWith('epic-')
      || snapshot.code?.startsWith('zano-')
      || snapshot.sourceCode?.startsWith('epic-')
      || snapshot.sourceCode?.startsWith('zano-')
    if (authoritativePrivacyCode && Number.isFinite(parsedBalance) && parsedBalance >= 0) return snapshot.balance
    const parsedTransactionBalance = Number.parseFloat(transactionBalance ?? '')
    if (
      Number.isFinite(parsedTransactionBalance)
      && parsedTransactionBalance > 0
      && (!Number.isFinite(parsedBalance) || parsedBalance <= 0)
    ) return transactionBalance
    if (Number.isFinite(parsedBalance) && parsedBalance >= 0) return snapshot.balance
  }
  return transactionBalance ?? snapshot.balance
}

const bestPrivacySnapshotSpendable = (
  snapshot: { balance?: string; spendable?: string; transactions?: unknown[] },
  satsPerCoin = 100_000_000,
) => {
  const spendable = Number.parseFloat(snapshot.spendable ?? '')
  if (Number.isFinite(spendable) && spendable >= 0) return snapshot.spendable
  return bestPrivacySnapshotBalance(snapshot, satsPerCoin)
}

const privacySnapshotHasLockedNativeBalance = (
  coin: Coin,
  snapshot: {
    code?: string
    sourceCode?: string
    balance?: string
    spendable?: string
    transactions?: unknown[]
  },
) => {
  if (!isPrivacyCoin(coin)) return false
  const sourceCode = snapshot.code === `${coin.id}-encrypted-cache`
    ? snapshot.sourceCode
    : snapshot.code
  if (sourceCode !== `${coin.id}-native-wallet`) return false
  const balance = Number.parseFloat(bestPrivacySnapshotBalance(snapshot, coin.satsPerCoin) ?? snapshot.balance ?? '0')
  if (!Number.isFinite(balance) || balance <= 0) return false
  const spendable = Number.parseFloat(bestPrivacySnapshotSpendable(snapshot, coin.satsPerCoin) ?? '0')
  if (Number.isFinite(spendable) && spendable > 0) return false
  return (snapshot.transactions?.length ?? 0) > 0
}

const privacySnapshotHasSpendReady = (
  coin: Coin,
  snapshot: {
    code?: string
    sourceCode?: string
    balance?: string
    spendable?: string
    transactions?: unknown[]
  },
) => {
  if (!isPrivacyCoin(coin)) return true
  const balance = Number.parseFloat(bestPrivacySnapshotBalance(snapshot, coin.satsPerCoin) ?? snapshot.balance ?? '0')
  if (!Number.isFinite(balance) || balance <= 0) return true
  const spendable = Number.parseFloat(bestPrivacySnapshotSpendable(snapshot, coin.satsPerCoin) ?? '0')
  if (Number.isFinite(spendable) && spendable > 0) return true
  return privacySnapshotHasLockedNativeBalance(coin, snapshot)
}

const privacySnapshotHasRecoveredData = (snapshot: { balance?: string; transactions?: unknown[] }) => {
  if (snapshot.transactions?.length) return true
  const balance = Number.parseFloat(snapshot.balance ?? '0')
  return Number.isFinite(balance) && balance > 0
}

const privacyMarkDisplayReady = (coinId: PrivacyCoin) => {
  privacyDisplayReadyCoins.add(coinId)
}

const privacyClearDisplayReady = (coinId?: PrivacyCoin) => {
  if (coinId) {
    privacyDisplayReadyCoins.delete(coinId)
    return
  }
  privacyDisplayReadyCoins.clear()
}

const privacyDisplayIsReady = (coin: Coin) => {
  if (!isPrivacyCoin(coin)) return false
  const coinId = coin.id as PrivacyCoin
  if (!privacyDisplayReadyCoins.has(coinId)) return false
  if (privacyBirthService.isRecoveryPending(coinId)) return false
  return true
}

const privacyProgressWithinCacheReadyGrace = (progress?: Coin['recoveryProgress']) =>
  !progress || (progress.blocksRemaining ?? 0) <= PRIVACY_CACHE_READY_BLOCK_GRACE

const completedPrivacyProgress = (
  progress: NonNullable<Coin['recoveryProgress']>,
): NonNullable<Coin['recoveryProgress']> => ({
  ...progress,
  currentHeight: progress.tipHeight,
  scannedBlocks: progress.totalBlocks,
  blocksRemaining: 0,
  percent: 100,
})

const privacyCachedSnapshotCanRestoreDisplay = (
  coin: Coin,
  cached: {
    balance?: string
    spendable?: string
    transactions?: unknown[]
    scanState?: string
    nativeWalletFileBlob?: string
    nativeWalletFileSize?: number
    sourceCode?: string
    verifiedSpendState?: boolean
  },
  progress?: Coin['recoveryProgress'],
) => {
  if (!isPrivacyCoin(coin)) return false
  if (!privacySnapshotHasRecoveredData(cached)) return false
  if (!privacySnapshotHasSpendReady(coin, cached)) return false
  if (!privacyProgressWithinCacheReadyGrace(progress)) return false
  if (coin.id === 'epic') {
    return cached.verifiedSpendState === true
      && Boolean(cached.nativeWalletFileBlob)
      && Number(cached.nativeWalletFileSize ?? 0) > 0
  }
  if (cached.verifiedSpendState === true) return true
  if (coin.id === 'zano') {
    return cached.sourceCode === 'zano-compact-scan-verified'
      || Boolean(cached.scanState)
      || Boolean(cached.nativeWalletFileBlob)
  }
  return false
}

const privacySnapshotIsEmptyZero = (snapshot: { ok?: boolean; balance?: string; spendable?: string; transactions?: unknown[] }) => {
  const balance = Number.parseFloat(snapshot.balance ?? '0')
  const spendable = Number.parseFloat(snapshot.spendable ?? '0')
  return snapshot.ok === true
    && (!snapshot.transactions || snapshot.transactions.length === 0)
    && Number.isFinite(balance)
    && Number.isFinite(spendable)
    && balance <= 0
    && spendable <= 0
}

const privacySnapshotCompletesRecovery = (
  coin: Coin,
  snapshot: { balance?: string; transactions?: unknown[]; code?: string },
) => {
  if (!privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin)) return true
  if (coin.id === 'zano') {
    if (snapshot.code === 'zano-native-wallet') return true
    if (snapshot.code === 'zano-compact-scan-verified') return true
    if (
      snapshot.code === 'zano-compact-scan'
      && !snapshot.transactions?.length
      && Number.parseFloat(snapshot.balance ?? '0') <= 0
    ) return true
    return false
  }
  if (coin.id === 'epic' && snapshot.code === 'epic-native-wallet') return true
  return privacySnapshotHasRecoveredData(snapshot)
}

const privacySnapshotCanUpdateVisibleData = (
  coin: Coin,
  snapshot: { ok?: boolean; code?: string; balance?: string; transactions?: unknown[] },
) => {
  if (!snapshot.ok || snapshot.code?.endsWith('snapshot-needs-unlock')) return false
  if (snapshot.code === `${coin.id}-encrypted-cache`) return false
  const balance = Number.parseFloat(snapshot.balance ?? '0')
  if (isPrivacyCoin(coin) && Number.isFinite(balance) && balance > 0 && !snapshot.transactions?.length) return false
  if (coin.id === 'zano') {
    if (snapshot.code === 'zano-native-wallet') return true
    if (snapshot.code === 'zano-compact-scan-verified') return true
    if (
      snapshot.code === 'zano-compact-scan'
      && !snapshot.transactions?.length
      && Number.parseFloat(snapshot.balance ?? '0') <= 0
    ) return true
    return false
  }
  if (coin.id === 'epic') {
    if (snapshot.code === 'epic-native-wallet') return true
    return false
  }
  return true
}

const privacySnapshotAllowsImmediateActive = (
  coin: Coin,
  snapshot: { code?: string; balance?: string; spendable?: string; transactions?: unknown[] },
  canUpdateVisibleData: boolean,
  recoveryComplete: boolean,
) => {
  if (!recoveryComplete || !canUpdateVisibleData) return false
  if (!privacySnapshotHasSpendReady(coin, snapshot)) return false
  if (
    isPrivacyCoin(coin)
    && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
    && (coin.recoveryProgress?.blocksRemaining ?? 0) > 0
  ) return false
  if (isPrivacyCoin(coin) && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready') return false
  if (snapshot.code === `${coin.id}-native-wallet`) return true
  return false
}

const privacySnapshotRequiresNativeVerification = (
  coin: Coin,
  snapshot: { ok?: boolean; code?: string },
) => snapshot.ok === true && coin.id === 'zano' && snapshot.code === 'zano-compact-scan-needs-native'

const privacyStartupSnapshotTimeout = () => PRIVACY_STARTUP_SNAPSHOT_TIMEOUT_MS

const updatePrivacyNativeVerification = (
  coin: Coin,
  snapshot: { ok?: boolean; code?: string },
) => {
  if (!isPrivacyCoin(coin)) return
  const privacyCoin = coin.id as PrivacyCoin
  if (privacySnapshotRequiresNativeVerification(coin, snapshot)) {
    privacyNativeVerificationRequired.add(privacyCoin)
  } else if (snapshot.ok && snapshot.code === `${coin.id}-native-wallet`) {
    privacyNativeVerificationRequired.delete(privacyCoin)
  }
}

const privacyPendingStatus = (
  coin: Coin,
  progress?: Coin['recoveryProgress'],
): Coin['status'] => {
  const rememberedProgress = isPrivacyCoin(coin)
    ? getRememberedPrivacyRecoveryProgress(coin.id as PrivacyCoin)
    : undefined
  const activeProgress = progress ?? coin.recoveryProgress ?? rememberedProgress
  if ((activeProgress?.blocksRemaining ?? 0) > 0) return 'syncing'
  if (isPrivacyCoin(coin) && privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin) && !activeProgress) return 'preparing'
  return 'preparing'
}

const privacyPendingStatusForSnapshot = (
  coin: Coin,
  snapshot: { code?: string; balance?: string; spendable?: string; transactions?: unknown[] },
): Coin['status'] => {
  if (snapshot.code === `${coin.id}-native-wallet-syncing`) return 'syncing'
  if (!privacySnapshotHasSpendReady(coin, snapshot)) return privacyPendingStatus(coin)
  if (
    isPrivacyCoin(coin)
    && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
    && (coin.recoveryProgress?.blocksRemaining ?? 0) > 0
  ) return 'syncing'
  return privacyPendingStatus(coin)
}

const privacyHideBalanceDecision = (
  coin: Coin,
  status: Coin['status'],
  candidate?: Pick<Coin, 'balance' | 'spendableBalance'>,
) => {
  const target = candidate ?? coin
  const visibleCandidate = privacyCoinHasVisibleBalance(target)
  if (!isPrivacyCoin(coin)) {
    return {
      hide: false,
      reason: 'not-privacy',
      visibleCandidate,
      nativeReadiness: 'n/a',
      recoveryPending: false,
    }
  }
  const nativeReadiness = privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin)
  const recoveryPending = privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin)
  if (status === 'recovering') {
    return {
      hide: true,
      reason: 'status-recovering',
      visibleCandidate,
      nativeReadiness,
      recoveryPending,
    }
  }
  if (status === 'active') {
    return {
      hide: false,
      reason: 'status-active',
      visibleCandidate,
      nativeReadiness,
      recoveryPending,
    }
  }
  if (recoveryPending) {
    if (coin.id === 'zano' && status === 'preparing' && visibleCandidate) {
      return {
        hide: false,
        reason: 'zano-cache-visible-preparing',
        visibleCandidate,
        nativeReadiness,
        recoveryPending,
      }
    }
    return {
      hide: true,
      reason: 'birth-recovery-pending',
      visibleCandidate,
      nativeReadiness,
      recoveryPending,
    }
  }
  const hide = nativeReadiness !== 'ready' && !visibleCandidate && !privacyDisplayIsReady(coin)
  return {
    hide,
    reason: hide ? 'native-not-ready-empty-candidate' : 'keep-visible-candidate',
    visibleCandidate,
    nativeReadiness,
    recoveryPending,
  }
}

const statusKeepsRecoveryProgress = (status: Coin['status']) =>
  status === 'recovering' || status === 'syncing'

const privacyBackgroundRefreshMs = (coin: Coin) =>
  coin.id === 'epic' ? EPIC_BACKGROUND_REFRESH_MS : PRIVACY_BACKGROUND_REFRESH_MS

const applyPrivacyNativeSnapshotToCoins = async (
  coinId: PrivacyCoin,
  snapshot: PrivacyWalletResponse,
  mnemonic: string,
  expectedScope: string,
  reason: string,
) => {
  if (!stillSameWallet(expectedScope, mnemonic)) return false
  const current = useCoinStore.getState().coins.length > 0
    ? useCoinStore.getState().coins
    : await coinService.getCoins()
  if (!stillSameWallet(expectedScope, mnemonic)) return false
  const coin = current.find((item) => item.id === coinId)
  if (!coin || !isPrivacyCoin(coin)) return false

  const recoveryWasPending = privacyBirthService.isRecoveryPending(coinId)
  const canUpdateVisibleData = privacySnapshotCanUpdateVisibleData(coin, snapshot)
  const recoveryComplete = privacySnapshotCompletesRecovery(coin, snapshot)
  const emptySnapshotWouldClearVisibleData = privacySnapshotIsEmptyZero(snapshot) && privacyCoinHasVisibleBalance(coin)
  const useSnapshotVisibleData = canUpdateVisibleData && !emptySnapshotWouldClearVisibleData
  privacyDebugLog(coinId, 'privacy.snapshot.apply.start', {
    reason,
    current: summarizeCoinState(coin),
    snapshot: summarizePrivacySnapshot(snapshot),
    canUpdateVisibleData,
    recoveryComplete,
    emptySnapshotWouldClearVisibleData,
    useSnapshotVisibleData,
    nativeReadiness: privacyWalletService.getNativeReadiness(coinId),
    recoveryPending: recoveryWasPending,
  })

  if (!snapshot.ok || !canUpdateVisibleData) return false
  if (recoveryComplete) {
    privacyBirthService.markRecoveryComplete(coinId)
    if (privacySnapshotHasSpendReady(coin, snapshot)) privacyMarkDisplayReady(coinId)
  }
  if (snapshot.address) {
    const addresses = walletService.getWalletAddresses()
    if (addresses[coinId] !== snapshot.address) {
      storageService.set('wallet-addresses', { ...addresses, [coinId]: snapshot.address })
    }
  }
  await mergePrivacySnapshotTransactions(coin, snapshot.transactions, {
    expectedScope,
    expectedMnemonic: mnemonic,
    primeNotifications: recoveryWasPending,
    tipHeight: snapshot.lastScannedHeight,
  })
  if (!stillSameWallet(expectedScope, mnemonic)) return false

  const latest = useCoinStore.getState().coins.length > 0
    ? useCoinStore.getState().coins
    : await coinService.getCoins()
  if (!stillSameWallet(expectedScope, mnemonic)) return false
  const network = await coinApiService.tryGetNetwork(coinId).catch(() => null)
  if (!stillSameWallet(expectedScope, mnemonic)) return false
  const next = latest.map((item) => {
    if (item.id !== coinId) return item
    const localBalance = useSnapshotVisibleData
      ? bestPrivacySnapshotBalance(snapshot, item.satsPerCoin) ?? item.balance
      : item.balance
    const localSpendable = useSnapshotVisibleData
      ? bestPrivacySnapshotSpendable(snapshot, item.satsPerCoin) ?? item.spendableBalance ?? localBalance
      : item.spendableBalance
    const capped = capPrivacyBalanceByPendingOutgoing(item, localBalance, localSpendable)
    const balance = capped.balance
    const spendableBalance = capped.spendableBalance ?? capped.balance
    const baseNetworkStatus = network ? networkToStatus(network) : item.status
    const canBecomeActive = baseNetworkStatus !== 'maintenance'
      && baseNetworkStatus !== 'offline'
      && privacySnapshotAllowsImmediateActive(item, snapshot, canUpdateVisibleData, recoveryComplete)
    const status: Coin['status'] = baseNetworkStatus === 'maintenance' || baseNetworkStatus === 'offline'
      ? baseNetworkStatus
      : recoveryComplete
        ? (canBecomeActive ? 'active' : privacyPendingStatusForSnapshot(item, snapshot))
        : privacyPendingStatusForSnapshot(item, snapshot)
    const hideDecision = privacyHideBalanceDecision(item, status, { balance, spendableBalance })
    const visibleBalance = hideDecision.hide ? '0' : balance
    const visibleSpendable = hideDecision.hide ? '0' : spendableBalance
    const recoveryProgress = item.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(coinId)
    privacyDebugLog(coinId, 'privacy.snapshot.apply.decision', {
      reason,
      current: summarizeCoinState(item),
      network: baseNetworkStatus,
      canBecomeActive,
      status,
      capped,
      hideDecision,
      visibleBalance,
      visibleSpendable,
      nativeReadiness: privacyWalletService.getNativeReadiness(coinId),
      recoveryPending: privacyBirthService.isRecoveryPending(coinId),
    })
    const balanceNum = parseFloat(visibleBalance) || 0
    return {
      ...item,
      address: snapshot.address ?? item.address,
      status,
      recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
      balance: visibleBalance,
      spendableBalance: visibleSpendable,
      fiatValue: typeof item.priceUsd === 'number' ? item.priceUsd * balanceNum : item.fiatValue,
    }
  })
  const saved = await coinService.saveRuntimeCoins(next)
  if (!stillSameWallet(expectedScope, mnemonic)) return false
  useCoinStore.setState({ coins: saved })
  privacyLastRefreshAt[coinId] = Date.now()
  privacyDebugLog(coinId, 'privacy.snapshot.apply.done', {
    reason,
    saved: summarizeCoinState(saved.find((item) => item.id === coinId)),
  })
  return true
}

const maybeWarmPrivacyNativeFromCache = (coin: Coin, mnemonic: string, expectedScope: string) => {
  if (!isPrivacyCoin(coin)) return
  const privacyCoin = coin.id as PrivacyCoin
  if (privacyWalletService.getNativeReadiness(privacyCoin) === 'ready') return
  const now = Date.now()
  if (now - (privacyCacheWarmStartedAt[privacyCoin] ?? 0) < PRIVACY_CACHE_BACKGROUND_WARM_MS) return
  privacyCacheWarmStartedAt[privacyCoin] = now
  const startedAt = Date.now()
  privacyDebugLog(coin.id, 'privacy.cache.backgroundWarm.start', {
    current: summarizeCoinState(coin),
    nativeReadiness: privacyWalletService.getNativeReadiness(privacyCoin),
  })
  void privacyWalletService.warmWallet(privacyCoin, mnemonic).then((response) => {
    privacyDebugLog(coin.id, 'privacy.cache.backgroundWarm.done', {
      current: summarizeCoinState(coin),
      durationMs: Date.now() - startedAt,
      response: summarizePrivacySnapshot(response),
      nativeReadiness: privacyWalletService.getNativeReadiness(privacyCoin),
    })
    if (!stillSameWallet(expectedScope, mnemonic)) return
    if (response.ok && privacySnapshotCanUpdateVisibleData(coin, response)) {
      privacyLastRefreshAt[privacyCoin] = 0
      privacyDebugLog(coin.id, 'privacy.cache.backgroundWarm.applySnapshot', {
        current: summarizeCoinState(coin),
        response: summarizePrivacySnapshot(response),
        nativeReadiness: privacyWalletService.getNativeReadiness(privacyCoin),
      })
      void applyPrivacyNativeSnapshotToCoins(privacyCoin, response, mnemonic, expectedScope, 'background-warm')
    }
  }).catch((error) => {
    privacyDebugLog(coin.id, 'privacy.cache.backgroundWarm.error', {
      current: summarizeCoinState(coin),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      nativeReadiness: privacyWalletService.getNativeReadiness(privacyCoin),
    })
  }).finally(() => {
    if (!stillSameWallet(expectedScope, mnemonic)) return
    privacyDebugLog(coin.id, 'privacy.cache.backgroundWarm.finally', {
      current: summarizeCoinState(coin),
      durationMs: Date.now() - startedAt,
      nativeReadiness: privacyWalletService.getNativeReadiness(privacyCoin),
    })
    privacyLastRefreshAt[privacyCoin] = 0
  })
}

const mergePrivacySnapshotTransactions = async (
  coin: Pick<Coin, 'id' | 'satsPerCoin'>,
  transactions: unknown[] | undefined,
  options: { expectedScope?: string; expectedMnemonic?: string; primeNotifications?: boolean; tipHeight?: number } = {},
) => {
  if (!Array.isArray(transactions)) return
  if (!stillSameWallet(options.expectedScope, options.expectedMnemonic)) return
  const { useTransactionStore } = await import('./transactionStore')
  if (!stillSameWallet(options.expectedScope, options.expectedMnemonic)) return
  await useTransactionStore.getState().mergePrivacyTransactions(
    coin.id,
    transactions,
    coin.satsPerCoin ?? 100_000_000,
    {
      silent: true,
      primeNotifications: options.primeNotifications,
      tipHeight: options.tipHeight,
      expectedScope: options.expectedScope,
      expectedMnemonic: options.expectedMnemonic,
      deferNotification: true,
    },
  )
}

type IncomingBalanceIncrease = {
  coinId: string
  deltaUnits: bigint
  decimals: number
  syntheticTransactions?: Transaction[]
  allowWithoutHistory?: boolean
  allowExistingHistoryCoverage?: boolean
  allowAnyVerifiedHistoryCoverage?: boolean
}

const snapshotUtxoUnits = (coinSnapshot: WalletSnapshotCoin | undefined, addresses: string[] = []) => {
  if (!coinSnapshot) return 0n
  const seen = new Set<string>()
  const balances = snapshotBalancesForAddresses(coinSnapshot, addresses)
  const utxos = coinSnapshot.walletBalance?.utxos?.length
    ? coinSnapshot.walletBalance.utxos
    : balances.flatMap((balance) => balance?.utxos ?? [])
  let total = 0n
  for (const utxo of utxos) {
    if (!utxo?.txid) continue
    const key = `${utxo.txid}:${utxo.outputIndex ?? 0}`
    if (seen.has(key)) continue
    seen.add(key)
    const numericSats = Number(utxo.satoshis ?? 0)
    if (!Number.isFinite(numericSats)) continue
    const sats = BigInt(Math.trunc(numericSats))
    if (sats > 0n) total += sats
  }
  return total
}

const dedupeUtxos = (utxos: Utxo[]) => {
  const byOutpoint = new Map<string, Utxo>()
  for (const utxo of utxos) {
    if (!utxo?.txid) continue
    const key = `${utxo.txid}:${utxo.outputIndex ?? 0}`
    if (!byOutpoint.has(key)) byOutpoint.set(key, utxo)
  }
  return Array.from(byOutpoint.values())
}

const utxoUnits = (utxos: Utxo[]) => dedupeUtxos(utxos).reduce((sum, utxo) => {
  const numericSats = Number(utxo.satoshis ?? 0)
  if (!Number.isFinite(numericSats)) return sum
  const sats = BigInt(Math.trunc(numericSats))
  return sats > 0n ? sum + sats : sum
}, 0n)

const confirmedUtxoUnits = (utxos: Utxo[]) => dedupeUtxos(utxos).reduce((sum, utxo) => {
  const numericSats = Number(utxo.satoshis ?? 0)
  const height = Number(utxo.height ?? 0)
  if (!Number.isFinite(numericSats) || !Number.isFinite(height) || height <= 0) return sum
  const sats = BigInt(Math.trunc(numericSats))
  return sats > 0n ? sum + sats : sum
}, 0n)

const coinBalanceFromUtxos = (utxos: Utxo[]): CoinBalance | null => {
  const unique = dedupeUtxos(utxos)
  const units = utxoUnits(unique)
  if (units <= 0n) return null
  const spendableUnits = confirmedUtxoUnits(unique)
  const sats = Number(units)
  const spendableSats = Number(spendableUnits)
  if (!Number.isSafeInteger(sats) || !Number.isSafeInteger(spendableSats)) return null
  return {
    balance: sats,
    balance_spendable: spendableSats,
    received: sats,
    immature: 0,
    pendingIncoming: sats - spendableSats,
    pendingOutgoing: 0,
    mempoolNet: 0,
    pendingTxids: [],
    pendingOutgoingTxids: [],
    pendingTransactions: [],
    utxos: unique,
  }
}

const withUtxoFallbackBalance = (
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[],
  balance: CoinBalance,
): WalletSnapshotCoin => {
  const primaryAddress = addresses[0] ?? coinSnapshot?.coin ?? 'wallet'
  const balances = { ...(coinSnapshot?.balances ?? {}) }
  const previous = balances[primaryAddress] ?? {}
  balances[primaryAddress] = {
    ...previous,
    ...balance,
    utxos: balance.utxos,
  }
  return {
    coin: coinSnapshot?.coin ?? '',
    network: coinSnapshot?.network ?? null,
    histories: coinSnapshot?.histories ?? {},
    errors: coinSnapshot?.errors,
    balances,
    walletBalance: balance,
  }
}

const visibleBalanceUnitsFromSnapshot = (coin: Coin, coinSnapshot: WalletSnapshotCoin | undefined, addresses: string[] = []) => {
  const balance = balanceStringFromSnapshot(coin, coinSnapshot, addresses)
  if (balance === null) return null
  return toBaseUnits(balance, decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000))
}

const resolveUtxoSnapshotBalance = async (
  coin: Coin,
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[],
) => {
  if (!isUtxoCoin(coin) || addresses.length === 0) return null
  const snapshotBalances = snapshotBalancesForAddresses(coinSnapshot, addresses)
  const hasServerPending = snapshotBalances.some((item) =>
    Number(item.pendingIncoming ?? 0) > 0 || Number(item.pendingOutgoing ?? 0) > 0
  )
  const snapshotUnits = visibleBalanceUnitsFromSnapshot(coin, coinSnapshot, addresses)
  const snapshotUnitsFromUtxos = snapshotUtxoUnits(coinSnapshot, addresses)
  if (snapshotUnitsFromUtxos > 0n && (snapshotUnits === null || snapshotUnitsFromUtxos !== snapshotUnits)) {
    const balance = coinBalanceFromUtxos(snapshotBalances.flatMap((item) => item.utxos ?? []))
    if (balance) return { balance, coinSnapshot: withUtxoFallbackBalance(coinSnapshot, addresses, balance) }
  }
  if (hasServerPending && snapshotUnits !== null && snapshotUnits > 0n) return null
  try {
    const utxos = await withTimeout(
      coinApiService.getUtxosForAddresses(coin.id, addresses, { fast: true }),
      UTXO_BALANCE_FALLBACK_TIMEOUT_MS,
    )
    const balance = coinBalanceFromUtxos(utxos)
    if (!balance) return null
    const utxoBalanceUnits = BigInt(balance.balance)
    if (snapshotUnits !== null && snapshotUnits > 0n && snapshotUnits === utxoBalanceUnits) return null
    return { balance, coinSnapshot: withUtxoFallbackBalance(coinSnapshot, addresses, balance) }
  } catch {
    return null
  }
}

const syntheticIncomingTransactionsFromSnapshot = (
  coin: Coin,
  coinSnapshot: WalletSnapshotCoin | undefined,
  addresses: string[],
  increaseUnits: bigint,
  decimals: number,
) => {
  if (!coinSnapshot || increaseUnits <= 0n) return []
  const addressSet = new Set(addresses.filter(Boolean))
  const fallbackAddress = addresses[0] ?? coin.address
  const balanceEntries = snapshotBalancesForAddresses(coinSnapshot, addresses)
  const pendingCandidates = balanceEntries
    .flatMap((balance) => balance?.pendingTransactions ?? [])
    .filter((tx) => tx?.txid && tx.type === 'incoming' && Number(tx.amount ?? 0) > 0)
    .sort((a, b) => Number(b.firstSeen ?? 0) - Number(a.firstSeen ?? 0))
  const candidates = balanceEntries
    .flatMap((balance) => balance?.utxos ?? [])
    .filter((utxo) => utxo?.txid && Number(utxo.satoshis ?? 0) > 0)
    .sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0))

  const transactions: Transaction[] = []
  const seen = new Set<string>()
  let covered = 0n
  for (const pending of pendingCandidates) {
    if (seen.has(pending.txid)) continue
    seen.add(pending.txid)
    const units = toBaseUnits(pending.amount || '0', decimals)
    if (units <= 0n) continue
    covered += units
    transactions.push({
      id: `${coin.id}-${pending.txid}`,
      coinId: coin.id,
      type: 'incoming',
      amount: pending.amount,
      status: 'pending',
      txHash: pending.txid,
      from: pending.from,
      to: pending.to ?? Array.from(addressSet)[0] ?? fallbackAddress,
      createdAt: new Date((pending.firstSeen ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      confirmations: 0,
    })
    if (covered >= increaseUnits) return transactions
  }
  for (const utxo of candidates) {
    if (seen.has(utxo.txid)) continue
    seen.add(utxo.txid)
    const txUtxos = candidates.filter((item) => item.txid === utxo.txid)
    const sats = txUtxos.reduce((sum, item) => sum + BigInt(Math.trunc(Number(item.satoshis ?? 0))), 0n)
    if (sats <= 0n) continue
    covered += sats
    const utxoHeight = Number(utxo.height ?? 0)
    const tipHeight = Number(coinSnapshot.network?.blocks ?? coinSnapshot.network?.headers ?? 0)
    const confirmations = utxoHeight > 0
      ? Math.max(1, tipHeight >= utxoHeight ? Math.floor(tipHeight - utxoHeight + 1) : 1)
      : 0
    transactions.push({
      id: `${coin.id}-${utxo.txid}`,
      coinId: coin.id,
      type: 'incoming',
      amount: fromBaseUnits(sats, decimals),
      status: utxoHeight > 0 ? 'confirmed' : 'pending',
      txHash: utxo.txid,
      to: Array.from(addressSet)[0] ?? fallbackAddress,
      createdAt: new Date().toISOString(),
      confirmations,
      // Carry the real block height so a confirmed synthetic row isn't mistaken
      // for an unverified optimistic row and pruned before the paged history
      // catches up (which made deposits briefly disappear).
      blockHeight: utxoHeight > 0 ? utxoHeight : undefined,
    })
    if (covered >= increaseUnits) break
  }
  return transactions
}

const incomingUnitsFromTransactions = (
  transactions: Transaction[],
  increase: IncomingBalanceIncrease,
  options: { beforeKeys?: Set<string>; recentOnly?: boolean } = {},
) => {
  const now = Date.now()
  let total = 0n
  for (const tx of transactions) {
    if (tx.coinId !== increase.coinId || tx.type !== 'incoming' || tx.spent) continue
    if (options.beforeKeys?.has(txKey(tx))) continue
    if (options.recentOnly) {
      const createdAtMs = Date.parse(tx.createdAt)
      if (!Number.isFinite(createdAtMs) || now - createdAtMs > INCOMING_BALANCE_GATE_MS) continue
    }
    const units = toBaseUnits(tx.amount || '0', increase.decimals)
    if (units > 0n) total += units
  }
  return total
}

const consumeFreshIncomingBalanceGateUnits = (
  transactions: Transaction[],
  increase: IncomingBalanceIncrease,
) => {
  pruneFreshIncomingBalanceGateTxs()
  const byKey = new Map(transactions.map((tx) => [txKey(tx), tx]))
  for (const [key, entry] of freshIncomingBalanceGateTxs.entries()) {
    if (!byKey.has(key)) byKey.set(key, entry.transaction)
  }
  let total = 0n
  const consumed: string[] = []
  for (const tx of byKey.values()) {
    if (tx.coinId !== increase.coinId || tx.type !== 'incoming' || tx.spent) continue
    const key = txKey(tx)
    if (!freshIncomingBalanceGateTxs.has(key)) continue
    const units = toBaseUnits(tx.amount || '0', increase.decimals)
    if (units <= 0n) continue
    total += units
    consumed.push(key)
    if (total >= increase.deltaUnits) {
      for (const consumedKey of consumed) freshIncomingBalanceGateTxs.delete(consumedKey)
      break
    }
  }
  return total
}

const hasFreshIncomingBalanceGateForCoin = (transactions: Transaction[], coinId: string) => {
  pruneFreshIncomingBalanceGateTxs()
  if ([...freshIncomingBalanceGateTxs.values()].some((entry) => entry.transaction.coinId === coinId)) return true
  return transactions.some((tx) =>
    tx.coinId === coinId
    && tx.type === 'incoming'
    && !tx.spent
    && freshIncomingBalanceGateTxs.has(txKey(tx))
  )
}

const preloadIncomingHistory = async (
  expectedScope?: string,
  expectedMnemonic?: string,
  increases: IncomingBalanceIncrease[] = [],
  options: { skipHistoryFetch?: boolean } = {},
) => {
  try {
    const { useTransactionStore } = await import('./transactionStore')
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return new Set<string>()
    const before = useTransactionStore.getState().transactions
    const beforeKeysByCoin = new Map<string, Set<string>>()
    const covered = new Set<string>()
    for (const increase of increases) {
      beforeKeysByCoin.set(
        increase.coinId,
        new Set(before.filter((tx) => tx.coinId === increase.coinId).map(txKey)),
      )
      const freshIncomingUnits = consumeFreshIncomingBalanceGateUnits(before, increase)
      const existingIncomingUnits = increase.allowExistingHistoryCoverage
        ? incomingUnitsFromTransactions(before, increase, { recentOnly: true })
        : 0n
      if (freshIncomingUnits + existingIncomingUnits >= increase.deltaUnits) covered.add(increase.coinId)
      if (increase.allowWithoutHistory) covered.add(increase.coinId)
    }
    const pendingIncreases = increases.filter((increase) => !covered.has(increase.coinId))
    if (pendingIncreases.length === 0) return covered
    if (options.skipHistoryFetch) return covered
    const historyResult = await useTransactionStore.getState().loadTransactions({
      page: 1,
      force: true,
      silent: false,
      skipBalanceRefresh: true,
      utxoOverlay: true,
      skipPrivacy: true,
      onlyCoinIds: pendingIncreases.map((increase) => increase.coinId),
    })
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return new Set<string>()
    let after = useTransactionStore.getState().transactions
    for (const increase of pendingIncreases) {
      const beforeKeys = beforeKeysByCoin.get(increase.coinId)
      const newIncomingUnits = incomingUnitsFromTransactions(after, increase, { beforeKeys })
      const verifiedHistoryRows = historyResult.pageCoinItemCounts[increase.coinId] ?? 0
      if (
        newIncomingUnits >= increase.deltaUnits
        || (increase.allowAnyVerifiedHistoryCoverage && verifiedHistoryRows > 0)
      ) {
        covered.add(increase.coinId)
      }
    }
    const synthetic = pendingIncreases
      .filter((increase) => !covered.has(increase.coinId))
      .flatMap((increase) => increase.syntheticTransactions ?? [])
    if (synthetic.length > 0) {
      await useTransactionStore.getState().mergeSyntheticTransactions(synthetic, {
        silent: false,
        expectedScope,
        expectedMnemonic,
      })
      if (!stillSameWallet(expectedScope, expectedMnemonic)) return covered
      after = useTransactionStore.getState().transactions
      for (const increase of increases) {
        if (covered.has(increase.coinId)) continue
        const beforeKeys = beforeKeysByCoin.get(increase.coinId)
        const newIncomingUnits = incomingUnitsFromTransactions(after, increase, { beforeKeys })
        if (newIncomingUnits >= increase.deltaUnits) {
          covered.add(increase.coinId)
        }
      }
    }
    for (const increase of pendingIncreases) {
      if (increase.allowWithoutHistory) covered.add(increase.coinId)
    }
    return covered
  } catch {
    // Balance refresh should still complete if history is temporarily unavailable.
  }
  return new Set<string>()
}

const privacyRecoveryIsPending = (coin: Coin) => {
  if (!isPrivacyCoin(coin)) return false
  const privacyCoin = coin.id as PrivacyCoin
  if (!privacyBirthService.isRecoveryPending(privacyCoin)) return false
  if (privacyWalletService.getNativeReadiness(privacyCoin) !== 'ready') return true
  return true
}

const privacyCoinNeedsNativeReadiness = (coin: Coin) => {
  if (!isPrivacyCoin(coin)) return false
  return Boolean(walletService.getSessionMnemonic())
}

const privacyCoinHasVisibleBalance = (coin: Pick<Coin, 'balance' | 'spendableBalance'>) => {
  const balance = Number.parseFloat(coin.balance || '0')
  const spendable = Number.parseFloat(coin.spendableBalance || '0')
  return (Number.isFinite(balance) && balance > 0)
    || (Number.isFinite(spendable) && spendable > 0)
}

const privacyCoinShouldShowNativePending = (coin: Coin) =>
  isPrivacyCoin(coin)
  && (
    privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
    || privacyRecoveryIsPending(coin)
  )

const shouldReportPrivacyProgress = (coin: Coin) =>
  isPrivacyCoin(coin)
  && walletService.getSessionMnemonic()
  && (
    privacyRecoveryIsPending(coin)
    || (
      privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
      && privacyCoinNeedsNativeReadiness(coin)
    )
  )

const statusWithPrivacyRecovery = (coin: Coin, status: Coin['status']) =>
  status === 'active'
    && privacyRecoveryIsPending(coin)
    ? privacyPendingStatus(coin)
    : status

const statusWithPrivacyRuntime = (coin: Coin, status: Coin['status']) => {
  const recoveredStatus = statusWithPrivacyRecovery(coin, status)
  if (
    recoveredStatus === 'active'
    && (coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light')
    && walletService.getSessionMnemonic()
    && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
  ) {
    return privacyPendingStatus(coin)
  }
  return recoveredStatus
}

const normalizeCachedPrivacyStatus = (coins: Coin[]) =>
  coins.map((coin) => {
    if (!isPrivacyCoin(coin)) return coin
    const status = statusWithPrivacyRuntime(coin, coin.status)
    const recoveryProgress = coin.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(coin.id as PrivacyCoin)
    return {
      ...coin,
      status,
      recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
    }
  })

const mergePreferenceUpdate = (current: Coin[], preferenceCoins: Coin[]) => {
  const preferencesById = new Map(preferenceCoins.map((coin) => [coin.id, {
    enabled: coin.enabled,
    favorite: coin.favorite,
  }]))
  const source = current.length > 0 ? current : preferenceCoins
  return source.map((coin) => {
    const preference = preferencesById.get(coin.id)
    if (!preference) return coin
    return {
      ...coin,
      enabled: preference.enabled,
      favorite: preference.favorite,
    }
  })
}

export const useCoinStore = create<CoinStore>((set, get) => ({
  coins: [],
  loading: false,
  refreshing: false,
  selectedCoinId: storageService.get<string | null>(SELECTED_COIN_KEY, null),
  lastActiveAt: {},
  consecutiveFailures: {},
  zeroBalanceReads: {},
  reservedOutgoing: readReservedOutgoing(),
  sendReadyLoadedAt: 0,

  loadNetworkStatuses: async () => {
    const loadSeq = ++coinLoadSeq
    const cached = await coinService.getCoins()
    const hadCache = get().coins.length > 0
    const visibleCached = normalizeCachedPrivacyStatus(cached)
    set({
      coins: hadCache ? normalizeCachedPrivacyStatus(get().coins) : visibleCached,
      loading: !hadCache && visibleCached.length === 0,
      refreshing: true,
    })

    const snapshot = await walletSnapshotService.fetchNetwork(cached)
    if (loadSeq !== coinLoadSeq) return

    const now = Date.now()
    const lastActiveAt = { ...get().lastActiveAt }
    const consecutiveFailures = { ...get().consecutiveFailures }
    const prices = snapshot.prices ?? {}
    const next = (get().coins.length > 0 ? get().coins : cached).map((coin) => {
      const network = snapshot.coins[coin.id]?.network
      const status = statusWithPrivacyRuntime(coin, network ? networkToStatus(network) : coin.status)
      if (status === 'active') {
        lastActiveAt[coin.id] = now
        consecutiveFailures[coin.id] = 0
      }
      const priceUsd = prices[coin.id] ?? coin.priceUsd
      const balanceNum = parseFloat(coin.balance) || 0
      return {
        ...coin,
        status,
        priceUsd,
        fiatValue: typeof priceUsd === 'number' ? priceUsd * balanceNum : coin.fiatValue,
      }
    })

    const savedCoins = await coinService.saveRuntimeCoins(next)
    set({
      coins: savedCoins,
      loading: false,
      refreshing: false,
      lastActiveAt,
      consecutiveFailures,
    })
  },

  loadSendReadyState: async (onProgress) => {
    const loadSeq = ++coinLoadSeq
    const expectedScope = walletService.getWalletStorageScope()
    const expectedMnemonic = walletService.getSessionMnemonic() ?? undefined
    const cached = await coinService.getCoins()
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return
    const hadCache = get().coins.length > 0
    const visibleCached = normalizeCachedPrivacyStatus(cached)
    set({
      coins: hadCache ? normalizeCachedPrivacyStatus(get().coins) : visibleCached,
      loading: !hadCache && visibleCached.length === 0,
      refreshing: true,
    })

    const enabled = cached.filter((coin) => coin.enabled)
    const sendReadyCoins = enabled.filter((coin) => !coin.deferStartupBalance && !isPrivacyCoin(coin))
    const nonAccountSendReadyCoins = sendReadyCoins.filter((coin) => !isAccountCoin(coin))
    const accountSendReadyCoins = sendReadyCoins.filter((coin) => isAccountCoin(coin))

    if (
      hadCache
      && accountSendReadyCoins.length === 0
      && get().sendReadyLoadedAt > 0
      && Date.now() - get().sendReadyLoadedAt < SEND_READY_FRESH_MS
    ) {
      onProgress?.(buildWalletLoadProgress('ready'))
      set({ loading: false, refreshing: false })
      return
    }

    onProgress?.(buildWalletLoadProgress('statuses'))
    const networkPromise = walletSnapshotService.fetchNetwork(enabled)
    const sendReadyPromise = withTimeout(
      walletSnapshotService.fetchSendReadyBalancesChunked(nonAccountSendReadyCoins, {
        timeoutMs: SEND_READY_BALANCE_TIMEOUT_MS,
      }),
      Math.max(SEND_READY_BALANCE_TIMEOUT_MS * 2, SEND_READY_BALANCE_TIMEOUT_MS + 5_000),
    ).catch(() => null)
    const networkSnapshot = await withTimeout(networkPromise, SEND_READY_NETWORK_TIMEOUT_MS).catch(() => emptyWalletSnapshot())
    if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) return

    const statusNow = Date.now()
    const statusLastActiveAt = { ...get().lastActiveAt }
    const statusFailures = { ...get().consecutiveFailures }
    const statusPrices = networkSnapshot.prices ?? {}
    const statusCoins = (get().coins.length > 0 ? get().coins : cached).map((coin) => {
      const network = networkSnapshot.coins[coin.id]?.network
      const status = statusWithPrivacyRuntime(coin, network ? networkToStatus(network) : coin.status)
      if (status === 'active') {
        statusLastActiveAt[coin.id] = statusNow
        statusFailures[coin.id] = 0
      }
      const priceUsd = statusPrices[coin.id] ?? coin.priceUsd
      const balanceNum = parseFloat(coin.balance) || 0
      return {
        ...coin,
        status,
        priceUsd,
        fiatValue: typeof priceUsd === 'number' ? priceUsd * balanceNum : coin.fiatValue,
      }
    })
    set({ coins: statusCoins, loading: false, refreshing: true, lastActiveAt: statusLastActiveAt, consecutiveFailures: statusFailures })

    onProgress?.(buildWalletLoadProgress('balances'))
    const baseSendReadyResult = await sendReadyPromise
    const accountSendReadyResult = accountSendReadyCoins.length === 0
      ? null
      : await withTimeout(
        walletSnapshotService.fetchSendReadyBalancesChunked(accountSendReadyCoins, {
          forceBalances: true,
          timeoutMs: SEND_READY_BALANCE_TIMEOUT_MS,
        }),
        SEND_READY_BALANCE_TIMEOUT_MS + 5_000,
      ).catch(() => null)
    const sendReadyResult = mergeWalletSnapshotResults([baseSendReadyResult, accountSendReadyResult])
    if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) return
    if (sendReadyResult.items.length === 0) {
      await get().loadCoins({ forceBalances: true, bootstrapBalances: true })
      return
    }
    const { items, snapshot: balanceSnapshot } = sendReadyResult
    const snapshot = {
      prices: { ...networkSnapshot.prices, ...balanceSnapshot.prices },
      pricesUpdatedAt: balanceSnapshot.pricesUpdatedAt ?? networkSnapshot.pricesUpdatedAt,
      coins: Object.fromEntries(enabled.map((coin) => [
        coin.id,
        {
          ...networkSnapshot.coins[coin.id],
          ...balanceSnapshot.coins[coin.id],
          network: networkSnapshot.coins[coin.id]?.network ?? balanceSnapshot.coins[coin.id]?.network ?? null,
        },
      ])),
    }
    const now = Date.now()
    const lastActiveAt = { ...get().lastActiveAt }
    const consecutiveFailures = { ...get().consecutiveFailures }
    const prices = snapshot.prices ?? {}
    const coinById = new Map(cached.map((coin) => [coin.id, coin]))
    const itemsByCoin = new Map(items.map((item) => [item.coin, item.addresses]))
    const next = await Promise.all((get().coins.length > 0 ? get().coins : cached).map(async (coin) => {
      const coinSnapshot = snapshot.coins[coin.id]
      const networkStatus = coinSnapshot?.network ? networkToStatus(coinSnapshot.network) : coin.status
      let status = statusWithPrivacyRuntime(coin, networkStatus)
      if (status === 'active') {
        lastActiveAt[coin.id] = now
        consecutiveFailures[coin.id] = 0
      }

      let balance = coin.balance
      let spendableBalance = coin.spendableBalance
      let balanceFromServer = false
      if (isPrivacyCoin(coin)) {
        if (networkStatus !== 'maintenance' && networkStatus !== 'offline') {
          status = statusWithPrivacyRuntime(coin, privacyPendingStatus(coin))
        }
      } else {
        const addresses = itemsByCoin.get(coin.id) ?? []
        const utxoFallback = await resolveUtxoSnapshotBalance(coin, coinSnapshot, addresses)
        const balanceSnapshotSource = utxoFallback?.coinSnapshot ?? coinSnapshot
        const nextBalance = balanceStringFromSnapshot(coin, balanceSnapshotSource, addresses)
        if (nextBalance !== null) {
          balance = nextBalance
          spendableBalance = spendableStringFromSnapshot(coin, balanceSnapshotSource, addresses) ?? nextBalance
          balanceFromServer = true
        }
      }

      const hideDecision = privacyHideBalanceDecision(coin, status)
      if (isPrivacyCoin(coin)) {
        privacyDebugLog(coin.id, 'coins.privacy.initialVisibleDecision', {
          loadSeq,
          current: summarizeCoinState(coin),
          status,
          balance,
          spendableBalance,
          balanceFromServer,
          hideDecision,
          networkStatus,
        })
      }
      const visibleBalance = hideDecision.hide
        ? '0'
        : (balanceFromServer ? balance : coin.balance)
      const visibleSpendable = hideDecision.hide
        ? '0'
        : (balanceFromServer ? (spendableBalance ?? visibleBalance) : coin.spendableBalance)
      const priceUsd = prices[coin.id] ?? coin.priceUsd
      const balanceNum = parseFloat(visibleBalance) || 0
      const recoveryProgress = isPrivacyCoin(coin)
        ? coin.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(coin.id as PrivacyCoin)
        : coin.recoveryProgress
      return {
        ...coin,
        status,
        recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
        balance: visibleBalance,
        spendableBalance: visibleSpendable,
        priceUsd,
        fiatValue: typeof priceUsd === 'number' ? priceUsd * balanceNum : coin.fiatValue,
      }
    }))

    if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) return
    const savedCoins = await coinService.saveRuntimeCoins(next)
    if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) return
    set({
      coins: savedCoins,
      loading: false,
      refreshing: false,
      lastActiveAt,
      consecutiveFailures,
      sendReadyLoadedAt: Date.now(),
    })

    onProgress?.(buildWalletLoadProgress('utxos'))
    const utxoItems = items.filter((item) => coinById.get(item.coin)?.cryptoParams && item.addresses.length > 0)
    const sendReadyWarmup = Promise.all([
      coinApiService.prefetchUtxos(utxoItems),
      ...utxoItems.map((item) => coinApiService.getFeeRate(item.coin, 6, 2_500).catch(() => null)),
    ]).catch(() => undefined)
    await withTimeout(sendReadyWarmup, SEND_READY_PREFETCH_TIMEOUT_MS).catch(() => undefined)
    void sendReadyWarmup
  },

  loadCoins: async (options = {}) => {
    const loadSeq = ++coinLoadSeq
    const expectedScope = walletService.getWalletStorageScope()
    const expectedMnemonic = walletService.getSessionMnemonic() ?? undefined
    const onlyCoinIds = new Set(options.onlyCoinIds ?? [])
    const targetedRefresh = onlyCoinIds.size > 0
    // 1. Render cached coins INSTANTLY (synchronous local read)
    const cached = await coinService.getCoins()
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return
    const currentCoins = get().coins
    const hadCache = currentCoins.length > 0
    const visibleCached = normalizeCachedPrivacyStatus(cached)
    quaiDebugLog('coins.load.start', {
      loadSeq,
      forceBalances: options.forceBalances === true,
      bootstrapBalances: options.bootstrapBalances === true,
      onlyCoinIds: [...onlyCoinIds],
      skipHistoryRefresh: options.skipHistoryRefresh === true,
      skipIncomingHistoryFetch: options.skipIncomingHistoryFetch === true,
      targetedRefresh,
      cachedQuai: summarizeQuaiCoin(cached.find((coin) => coin.id === 'quai')),
      currentQuai: summarizeQuaiCoin(currentCoins.find((coin) => coin.id === 'quai')),
    })
    if (!targetedRefresh || onlyCoinIds.has('pearl')) {
      coinDebugLog('pearl', 'coins.load.start', {
        loadSeq,
        forceBalances: options.forceBalances === true,
        bootstrapBalances: options.bootstrapBalances === true,
        onlyCoinIds: [...onlyCoinIds],
        skipHistoryRefresh: options.skipHistoryRefresh === true,
        skipIncomingHistoryFetch: options.skipIncomingHistoryFetch === true,
        targetedRefresh,
        cachedPearl: summarizePearlCoin(cached.find((coin) => coin.id === 'pearl')),
        currentPearl: summarizePearlCoin(currentCoins.find((coin) => coin.id === 'pearl')),
      })
    }
    set({
      coins: hadCache ? normalizeCachedPrivacyStatus(currentCoins) : visibleCached,
      loading: !hadCache && visibleCached.length === 0,
      refreshing: true,
    })
    if (!targetedRefresh) void get().refreshPrivacyBalances()

    // 2. Refresh status + balances + prices through one batched gateway call.
    const enabled = cached.filter((c) => c.enabled)
    const refreshEnabled = targetedRefresh
      ? enabled.filter((coin) => onlyCoinIds.has(coin.id))
      : enabled
    const startupCoins = refreshEnabled.filter((c) => !c.deferStartupBalance && !isPrivacyCoin(c))
    const deferredStartupCoins = refreshEnabled.filter((c) => c.deferStartupBalance)
    const itemsByCoin = new Map<string, string[]>()
    let prices: Record<string, number> = {}
    let snapshotUnavailable = false
    let probed: Array<{
      id: string
      rawStatus: Coin['status']
      balance: string
      spendableBalance?: string
      balanceFromServer: boolean
      coinSnapshot?: WalletSnapshotCoin
      addresses?: string[]
    }>
    const serverPendingIncomingTxidsByCoin = new Map<string, Set<string>>()
    const serverPendingIncomingWithoutTxids = new Set<string>()
    const serverRepresentedTxidsByCoin = new Map<string, Set<string>>()
    try {
      const { items, snapshot } = await walletSnapshotService.fetchBalancesChunked(startupCoins, {
        forceBalances: options.forceBalances === true,
        timeoutMs: options.forceBalances === true ? 20_000 : SEND_READY_BALANCE_TIMEOUT_MS,
      })
      quaiDebugLog('coins.snapshot.response', {
        loadSeq,
        startupCoins: startupCoins.map((coin) => coin.id),
        items: items.filter((item) => item.coin === 'quai'),
        quai: summarizeQuaiSnapshotCoin(snapshot.coins.quai),
      })
      if (startupCoins.some((coin) => coin.id === 'pearl')) {
        coinDebugLog('pearl', 'coins.snapshot.response', {
          loadSeq,
          startupCoins: startupCoins.map((coin) => coin.id),
          items: items.filter((item) => item.coin === 'pearl'),
          pearl: summarizeQuaiSnapshotCoin(snapshot.coins.pearl),
        })
      }
      if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) {
        quaiDebugLog('coins.abort.afterSnapshot', { loadSeq, activeSeq: coinLoadSeq })
        return
      }
      prices = snapshot.prices ?? {}
      for (const item of items) itemsByCoin.set(item.coin, item.addresses)
      const quickStatuses = new Map<string, Coin['status']>()
      for (const c of startupCoins) {
        const network = snapshot.coins[c.id]?.network
        if (network) quickStatuses.set(c.id, statusWithPrivacyRuntime(c, networkToStatus(network)))
      }
      if (quickStatuses.size > 0 && loadSeq === coinLoadSeq) {
        const quickNow = Date.now()
        const quickLastActiveAt = { ...get().lastActiveAt }
        const quickFailures = { ...get().consecutiveFailures }
        const currentCoins = get().coins.length > 0 ? get().coins : cached
        set({
          coins: currentCoins.map((coin) => {
            const status = quickStatuses.get(coin.id)
            if (!status) return coin
            if (status === 'active') {
              quickLastActiveAt[coin.id] = quickNow
              quickFailures[coin.id] = 0
            }
            const priceUsd = prices[coin.id] ?? coin.priceUsd
            const balanceNum = parseFloat(coin.balance) || 0
            return {
              ...coin,
              status,
              priceUsd,
              fiatValue: typeof priceUsd === 'number' ? priceUsd * balanceNum : coin.fiatValue,
            }
          }),
          loading: false,
          refreshing: true,
          lastActiveAt: quickLastActiveAt,
          consecutiveFailures: quickFailures,
        })
      }
      probed = await Promise.all(startupCoins.map(async (c) => {
        let coinSnapshot = snapshot.coins[c.id]
        const addresses = itemsByCoin.get(c.id) ?? []
        const baseStatus = coinSnapshot?.network ? networkToStatus(coinSnapshot.network) : 'offline'
        let rawStatus = statusWithPrivacyRuntime(c, baseStatus)
        let balance = c.balance
        let spendableBalance = c.spendableBalance
        let balanceFromServer = false
        if (isPrivacyCoin(c)) {
          const savedAddress = walletService.getWalletAddresses()[c.id]
          const reportRecoveryProgress = shouldReportPrivacyProgress(c)
          try {
            const cachedSnapshotForDecision = expectedMnemonic
              ? await privacyWalletService.getCachedSnapshot(c.id as PrivacyCoin, expectedMnemonic).catch(() => null)
              : null
            if (expectedMnemonic && privacyWalletService.getNativeReadiness(c.id as PrivacyCoin) !== 'ready') {
              const cached = cachedSnapshotForDecision
              if (cached && privacySnapshotHasRecoveredData(cached)) {
                const progress = await cachedPrivacyProgress(c, cached)
                const cacheDisplayReady = privacyCachedSnapshotCanRestoreDisplay(c, cached, progress)
                const cacheCanCompleteRecovery = cacheDisplayReady
                  || c.id !== 'zano'
                  || privacyWalletService.getNativeReadiness(c.id as PrivacyCoin) === 'ready'
                if (cacheCanCompleteRecovery) {
                  privacyBirthService.markRecoveryComplete(c.id as PrivacyCoin)
                  if (cacheDisplayReady) privacyMarkDisplayReady(c.id as PrivacyCoin)
                }
                balance = bestPrivacySnapshotBalance(cached, c.satsPerCoin) ?? balance
                spendableBalance = bestPrivacySnapshotSpendable(cached, c.satsPerCoin) ?? spendableBalance ?? balance
                balanceFromServer = true
                if (progress && stillSameWallet(expectedScope, expectedMnemonic)) {
                  set({ coins: withRecoveryProgress(get().coins, c.id, {
                    type: 'privacyRecovery',
                    progressToken: 'cache-estimate',
                    coin: c.id as PrivacyCoin,
                    ...progress,
                  }) })
                }
                if (rawStatus !== 'maintenance' && rawStatus !== 'offline') {
                  rawStatus = cacheDisplayReady
                    ? 'active'
                    : privacyPendingStatus(c, progress)
                }
                maybeWarmPrivacyNativeFromCache(c, expectedMnemonic, expectedScope)
                privacyDebugLog(c.id, 'coins.privacy.load.localSnapshot.deferred', {
                  loadSeq,
                  current: summarizeCoinState(c),
                  cached: summarizePrivacySnapshot(cached),
                  progress,
                  cacheDisplayReady,
                  cacheCanCompleteRecovery,
                  rawStatus,
                  baseStatus,
                  nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
                  recoveryPending: privacyBirthService.isRecoveryPending(c.id as PrivacyCoin),
                })
                return { id: c.id, rawStatus, balance, spendableBalance, balanceFromServer }
              }
            }
            const local = await withTimeout(
              privacyWalletService.getSnapshot(
                c.id as PrivacyCoin,
                expectedMnemonic,
                reportRecoveryProgress
                  ? (progress) => {
                      if (stillSameWallet(expectedScope, expectedMnemonic)) set({ coins: withRecoveryProgress(get().coins, c.id, progress) })
                    }
                  : undefined,
              ),
              privacyStartupSnapshotTimeout(),
            )
            if (!local.ok) {
              privacyDebugLog(c.id, 'coins.privacy.load.localSnapshot.notOk', {
                loadSeq,
                current: summarizeCoinState(c),
                snapshot: summarizePrivacySnapshot(local),
                rawStatus,
                baseStatus,
                nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
                recoveryPending: privacyBirthService.isRecoveryPending(c.id as PrivacyCoin),
              })
              return { id: c.id, rawStatus, balance, spendableBalance, balanceFromServer }
            }
            const localRegressesCachedHistory = c.id === 'zano'
              && (local.cacheHistoryRegression === true || zanoSnapshotRegressesCachedHistory(cachedSnapshotForDecision, local))
            if (localRegressesCachedHistory) {
              privacyNativeVerificationRequired.add(c.id as PrivacyCoin)
              privacyDebugLog(c.id, 'coins.privacy.load.localSnapshot.historyRegression', {
                loadSeq,
                current: summarizeCoinState(c),
                cached: summarizePrivacySnapshot(cachedSnapshotForDecision),
                snapshot: summarizePrivacySnapshot(local),
                rawStatus,
                baseStatus,
                nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
              })
            } else {
              updatePrivacyNativeVerification(c, local)
            }
            const canUpdateVisibleData = privacySnapshotCanUpdateVisibleData(c, local) && !localRegressesCachedHistory
            privacyDebugLog(c.id, 'coins.privacy.load.localSnapshot', {
              loadSeq,
              current: summarizeCoinState(c),
              snapshot: summarizePrivacySnapshot(local),
              rawStatusBefore: rawStatus,
              baseStatus,
              canUpdateVisibleData,
              localRegressesCachedHistory,
              nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
              recoveryPending: privacyBirthService.isRecoveryPending(c.id as PrivacyCoin),
              requiresNativeVerification: privacyNativeVerificationRequired.has(c.id as PrivacyCoin),
            })
            if (!canUpdateVisibleData && !local.code?.endsWith('snapshot-needs-unlock')) {
              if (rawStatus !== 'maintenance' && rawStatus !== 'offline') rawStatus = privacyPendingStatusForSnapshot(c, local)
            }
            const recoveryWasPending = privacyBirthService.isRecoveryPending(c.id as PrivacyCoin)
            const recoveryComplete = !localRegressesCachedHistory
              && !local.code?.endsWith('snapshot-needs-unlock')
              && privacySnapshotCompletesRecovery(c, local)
            if (recoveryComplete) {
              privacyBirthService.markRecoveryComplete(c.id as PrivacyCoin)
              if (rawStatus !== 'maintenance' && rawStatus !== 'offline') {
                rawStatus = privacySnapshotAllowsImmediateActive(c, local, canUpdateVisibleData, recoveryComplete)
                  ? 'active'
                  : (canUpdateVisibleData ? privacyPendingStatusForSnapshot(c, local) : statusWithPrivacyRuntime(c, baseStatus))
              }
            }
            if (local.address && local.address !== c.address) {
              const addresses = walletService.getWalletAddresses()
              if (stillSameWallet(expectedScope, expectedMnemonic)) {
                storageService.set('wallet-addresses', { ...addresses, [c.id]: local.address })
              }
            }
            const localBalance = bestPrivacySnapshotBalance(local, c.satsPerCoin)
            const emptySnapshotWouldClearVisibleData = privacySnapshotIsEmptyZero(local) && privacyCoinHasVisibleBalance(c)
            if (localBalance && canUpdateVisibleData && !emptySnapshotWouldClearVisibleData) {
              balance = localBalance
              spendableBalance = bestPrivacySnapshotSpendable(local, c.satsPerCoin) ?? localBalance
              balanceFromServer = true
            }
            if (canUpdateVisibleData) {
              privacyLastRefreshAt[c.id as PrivacyCoin] = Date.now()
              await mergePrivacySnapshotTransactions(c, local.transactions, {
                expectedScope,
                expectedMnemonic,
                primeNotifications: recoveryWasPending,
                tipHeight: local.lastScannedHeight,
              })
            }
            privacyDebugLog(c.id, 'coins.privacy.load.decision', {
              loadSeq,
              rawStatusAfter: rawStatus,
              balance,
              spendableBalance,
              balanceFromServer,
              canUpdateVisibleData,
              recoveryComplete,
              recoveryWasPending,
              emptySnapshotWouldClearVisibleData,
              nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
            })
          } catch (error) {
          privacyDebugLog(c.id, 'coins.privacy.load.error', {
            loadSeq,
            current: summarizeCoinState(c),
            rawStatus,
            error: error instanceof Error ? error.message : String(error),
            nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
            recoveryPending: privacyBirthService.isRecoveryPending(c.id as PrivacyCoin),
          })
          // Do not keep a stale positive privacy balance visible while restore is still unverified.
          if ((c.id === 'zano' || c.id === 'epic')
            && privacyBirthService.isRecoveryPending(c.id as PrivacyCoin)
            && Number.parseFloat(c.balance || '0') > 0) {
            if (rawStatus !== 'maintenance' && rawStatus !== 'offline') rawStatus = privacyPendingStatus(c)
            balance = '0'
            spendableBalance = '0'
            balanceFromServer = true
          }
          }
          void savedAddress
          return { id: c.id, rawStatus, balance, spendableBalance, balanceFromServer }
        }
        const utxoFallback = await resolveUtxoSnapshotBalance(c, coinSnapshot, addresses)
        if (utxoFallback) {
          coinSnapshot = utxoFallback.coinSnapshot
          noteServerPendingIncoming(
            serverPendingIncomingTxidsByCoin,
            serverPendingIncomingWithoutTxids,
            serverRepresentedTxidsByCoin,
            c.id,
            utxoFallback.balance,
          )
          const nextBalance = balanceStringFromSnapshot(c, coinSnapshot, addresses)
          balance = nextBalance ?? '0'
          spendableBalance = spendableStringFromSnapshot(c, coinSnapshot, addresses) ?? balance
          balanceFromServer = true
        }
        const balances = snapshotBalancesForAddresses(coinSnapshot, addresses)
        if (balances.length > 0) {
          for (const item of balances) {
            noteServerPendingIncoming(
              serverPendingIncomingTxidsByCoin,
              serverPendingIncomingWithoutTxids,
              serverRepresentedTxidsByCoin,
              c.id,
              item,
            )
          }
          const nextBalance = balanceStringFromSnapshot(c, coinSnapshot, addresses)
          balance = nextBalance ?? '0'
          spendableBalance = spendableStringFromSnapshot(c, coinSnapshot, addresses) ?? balance
          balanceFromServer = true
        }
        return { id: c.id, rawStatus, balance, spendableBalance, balanceFromServer, coinSnapshot, addresses }
      }))
    } catch (error) {
      quaiDebugLogError('coins.snapshot.error', error, {
        loadSeq,
        startupCoins: startupCoins.map((coin) => coin.id),
        forceBalances: options.forceBalances === true,
      })
      snapshotUnavailable = true
      const fallbackById = new Map((get().coins.length > 0 ? get().coins : cached).map((coin) => [coin.id, coin]))
      probed = await Promise.all(startupCoins.map(async (c) => {
        const current = fallbackById.get(c.id)
        const network = await coinApiService.tryGetNetwork(c.id)
        const rawStatus = statusWithPrivacyRuntime(c, network ? networkToStatus(network) : (c.status === 'maintenance' ? 'syncing' : c.status))
        return {
          id: c.id,
          rawStatus,
          balance: current?.balance ?? c.balance,
          spendableBalance: current?.spendableBalance ?? c.spendableBalance,
          balanceFromServer: false,
        }
      }))
    }

    // 3. Apply stickiness вЂ” a single bad read doesn't drop the badge.
    const now = Date.now()
    const lastActiveAt = { ...get().lastActiveAt }
    const consecutiveFailures = { ...get().consecutiveFailures }
    const zeroBalanceReads = { ...get().zeroBalanceReads }
    const cachedById = new Map(cached.map((coin) => [coin.id, coin]))

    const finalById = new Map<string, {
      status: Coin['status']
      balance: string
      spendableBalance?: string
      balanceFromServer: boolean
      coinSnapshot?: WalletSnapshotCoin
      addresses?: string[]
    }>()
    for (const { id, rawStatus, balance, spendableBalance, balanceFromServer, coinSnapshot, addresses } of probed) {
      if (snapshotUnavailable) {
        if (rawStatus === 'active') {
          lastActiveAt[id] = now
          consecutiveFailures[id] = 0
        }
        finalById.set(id, { status: rawStatus, balance, spendableBalance, balanceFromServer, coinSnapshot, addresses })
        continue
      }
      if (rawStatus === 'active') {
        lastActiveAt[id] = now
        consecutiveFailures[id] = 0
        finalById.set(id, { status: 'active', balance, spendableBalance, balanceFromServer, coinSnapshot, addresses })
        continue
      }
      if (rawStatus === 'recovering') {
        consecutiveFailures[id] = 0
        finalById.set(id, { status: 'recovering', balance, spendableBalance, balanceFromServer, coinSnapshot, addresses })
        continue
      }
      if (isPrivacyCoin(cachedById.get(id)) && (rawStatus === 'syncing' || rawStatus === 'preparing')) {
        consecutiveFailures[id] = 0
        finalById.set(id, { status: rawStatus, balance, spendableBalance, balanceFromServer, coinSnapshot, addresses })
        continue
      }
      // Non-active raw status вЂ” increment failures, decide based on stickiness
      consecutiveFailures[id] = (consecutiveFailures[id] ?? 0) + 1
      const lastOk = lastActiveAt[id] ?? 0
      const recentlyActive = cachedById.get(id)?.status === 'active' || now - lastOk < STICKY_ACTIVE_MS
      const tooManyFailures = consecutiveFailures[id] >= FAILURE_THRESHOLD

      if (recentlyActive && !tooManyFailures) {
        finalById.set(id, { status: 'active', balance, spendableBalance, balanceFromServer, coinSnapshot, addresses })
      } else {
        finalById.set(id, { status: 'maintenance', balance, spendableBalance, balanceFromServer, coinSnapshot, addresses })
      }
    }
    const finalQuai = finalById.get('quai')
    quaiDebugLog('coins.finalProbe', {
      loadSeq,
      snapshotUnavailable,
      quai: finalQuai
        ? {
            status: finalQuai.status,
            balance: finalQuai.balance,
            spendableBalance: finalQuai.spendableBalance,
            balanceFromServer: finalQuai.balanceFromServer,
            addresses: finalQuai.addresses,
            snapshot: summarizeQuaiSnapshotCoin(finalQuai.coinSnapshot),
          }
        : null,
    })
    const finalPearl = finalById.get('pearl')
    if (finalPearl) {
      coinDebugLog('pearl', 'coins.finalProbe', {
        loadSeq,
        snapshotUnavailable,
        pearl: {
          status: finalPearl.status,
          balance: finalPearl.balance,
          spendableBalance: finalPearl.spendableBalance,
          balanceFromServer: finalPearl.balanceFromServer,
          addresses: finalPearl.addresses,
          snapshot: summarizeQuaiSnapshotCoin(finalPearl.coinSnapshot),
        },
      })
    }
    const finalRaptoreum = finalById.get('raptoreum')
    if (finalRaptoreum) {
      coinDebugLog('raptoreum', 'coins.finalProbe', {
        loadSeq,
        snapshotUnavailable,
        raptoreum: {
          status: finalRaptoreum.status,
          balance: finalRaptoreum.balance,
          spendableBalance: finalRaptoreum.spendableBalance,
          balanceFromServer: finalRaptoreum.balanceFromServer,
          addresses: finalRaptoreum.addresses,
          snapshot: summarizeQuaiSnapshotCoin(finalRaptoreum.coinSnapshot),
        },
      })
    }

    const storedTransactions = readStoredTransactions()
    const recentOutgoingByCoin = new Set(
      storedTransactions
        .filter((tx) => tx.type === 'outgoing' && tx.status !== 'failed')
        .filter((tx) => {
          const createdAtMs = Date.parse(tx.createdAt)
          return Number.isFinite(createdAtMs) && now - createdAtMs < ORPHAN_RESERVATION_TTL_MS
        })
        .map((tx) => tx.coinId),
    )
    const recentOutgoingUnitsByCoin = new Map<string, bigint[]>()
    for (const tx of storedTransactions) {
      if (tx.type !== 'outgoing' || tx.status === 'failed') continue
      const createdAtMs = Date.parse(tx.createdAt)
      if (!Number.isFinite(createdAtMs) || now - createdAtMs >= ORPHAN_RESERVATION_TTL_MS) continue
      const coin = cachedById.get(tx.coinId)
      const decimals = decimalsForSatsPerCoin(coin?.satsPerCoin ?? 100_000_000)
      const units = toBaseUnits(tx.amount || '0', decimals) + toBaseUnits(tx.fee ?? '0', decimals)
      if (units <= 0n) continue
      const bucket = recentOutgoingUnitsByCoin.get(tx.coinId) ?? []
      bucket.push(units)
      recentOutgoingUnitsByCoin.set(tx.coinId, bucket)
    }
    const recentIncomingByCoin = new Set(
      storedTransactions
        .filter((tx) => tx.type === 'incoming' && !tx.spent)
        .filter((tx) => {
          const createdAtMs = Date.parse(tx.createdAt)
          return Number.isFinite(createdAtMs) && now - createdAtMs < FRESH_INCOMING_BALANCE_GATE_MS
        })
        .map((tx) => tx.coinId),
    )
    const recentIncomingUnitsByCoin = new Map<string, bigint[]>()
    for (const tx of storedTransactions) {
      if (tx.type !== 'incoming' || tx.spent) continue
      const createdAtMs = Date.parse(tx.createdAt)
      if (!Number.isFinite(createdAtMs) || now - createdAtMs >= FRESH_INCOMING_BALANCE_GATE_MS) continue
      const coin = cachedById.get(tx.coinId)
      const decimals = decimalsForSatsPerCoin(coin?.satsPerCoin ?? 100_000_000)
      const units = toBaseUnits(tx.amount || '0', decimals)
      if (units <= 0n) continue
      const bucket = recentIncomingUnitsByCoin.get(tx.coinId) ?? []
      bucket.push(units)
      recentIncomingUnitsByCoin.set(tx.coinId, bucket)
    }
    const storedPending = pendingReservationsFromTransactions(storedTransactions)
    const completedOutgoingHashes = new Set(
      storedTransactions
        .filter((tx) => tx.type === 'outgoing' && tx.status !== 'pending')
        .map((tx) => normalizedTxHash(tx.txHash)),
    )
    const existingReservations = Object.fromEntries(
      Object.entries(get().reservedOutgoing)
        .filter(([hash]) => !completedOutgoingHashes.has(normalizedTxHash(hash))),
    )
    const activePendingHashes = new Set(
      Object.entries(storedPending)
        .filter(([, reservation]) => reservation.status === 'pending')
        .map(([hash]) => hash),
    )
    const mergedReservations = { ...existingReservations }
    for (const [hash, reservation] of Object.entries(storedPending)) {
      const previous = mergedReservations[hash]
      mergedReservations[hash] = {
        ...previous,
        ...reservation,
        spentOutpoints: reservation.spentOutpoints ?? previous?.spentOutpoints,
        balanceBefore: reservation.balanceBefore ?? previous?.balanceBefore,
        expectedBalanceAfter: reservation.expectedBalanceAfter ?? previous?.expectedBalanceAfter,
      }
    }
    const reservedOutgoing = normalizeReservedOutgoingFast(pruneReservedOutgoing(
      mergedReservations,
      activePendingHashes,
      cached,
    ), cached)
    if (JSON.stringify(reservedOutgoing) !== JSON.stringify(get().reservedOutgoing)) {
      writeReservedOutgoing(reservedOutgoing)
    }

    const pendingIncomingByCoin = pendingIncomingFromTransactions(
      storedTransactions,
      serverPendingIncomingTxidsByCoin,
      serverPendingIncomingWithoutTxids,
      serverRepresentedTxidsByCoin,
      cachedById,
    )

    const reservationsByCoin = new Map<string, ReservedOutgoing[]>()
    for (const reservation of Object.values(reservedOutgoing)) {
      const bucket = reservationsByCoin.get(reservation.coinId) ?? []
      bucket.push(reservation)
      reservationsByCoin.set(reservation.coinId, bucket)
    }

    // A refresh can run while the user toggles visibility/favorites. Re-read
    // the latest local preferences before saving so an older network response
    // never brings a hidden coin back or drops a newly starred coin.
    const recoveryProgressById = new Map(get().coins.map((coin) => [coin.id, coin.recoveryProgress]))
    const beforeFinalById = new Map((get().coins.length > 0 ? get().coins : cached).map((coin) => [coin.id, coin]))
    const coinsWithBalanceChange = new Set<string>()
    const incomingBalanceIncreases = new Map<string, IncomingBalanceIncrease>()
    const latest = await coinService.getCoins()
    if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) {
      quaiDebugLog('coins.abort.beforeCompute', { loadSeq, activeSeq: coinLoadSeq })
      return
    }
    const nextCoins = latest.map((c) => {
      const current = beforeFinalById.get(c.id) ?? c
      const f = finalById.get(c.id)
      const status = f?.status ?? current.status
      const rememberedRecoveryProgress = isPrivacyCoin(c)
        ? getRememberedPrivacyRecoveryProgress(c.id as PrivacyCoin)
        : undefined
      const recoveryProgress = recoveryProgressById.get(c.id) ?? rememberedRecoveryProgress
      const nextBalance = f?.balance ?? current.balance
      const decimals = decimalsForSatsPerCoin(c.satsPerCoin ?? 100_000_000)
      const previousUnits = toBaseUnits(current.balance || '0', decimals)
      const baseServerUnits = toBaseUnits(nextBalance || '0', decimals)
      const pendingIncoming = f?.balanceFromServer ? pendingIncomingByCoin.get(c.id) : undefined
      const pendingIncomingUnits = pendingIncoming?.units ?? 0n
      const pendingIncomingKeys = pendingIncoming?.keys ?? []
      const accountCoin = isAccountCoin(c)
      const utxoCoin = isUtxoCoin(c)
      const privacyCoin = isPrivacyCoin(c)
      const epicCoin = c.id === 'epic'
      const quaiAccountCoin = isQuaiAccountCoin(c)
      // UTXO forks do not all expose mempool credits through the same balance
      // RPC. If history has a fresh incoming row that the server snapshot does
      // not yet represent by txid/utxo, show that credit in the same poll only.
      const serverCoveredPendingIncomingUnits = baseServerUnits > previousUnits ? baseServerUnits - previousUnits : 0n
      const uncoveredPendingIncomingUnits = pendingIncomingUnits > serverCoveredPendingIncomingUnits
        ? pendingIncomingUnits - serverCoveredPendingIncomingUnits
        : 0n
      const localPendingIncomingUnits = shouldUseFreshIncomingUtxoOverlay(c) ? uncoveredPendingIncomingUnits : 0n
      const serverUnits = baseServerUnits + localPendingIncomingUnits
      let reservedUnits = 0n
      let expectedAfterFloor = 0n
      let quaiExpectedAfterCeiling: bigint | null = null
      let quaiExpectedAfterCeilingAt = -Infinity
      let zeroExpectedAfter = false
      const coinReservations = (reservationsByCoin.get(c.id) ?? []).filter((reservation) =>
        utxoCoin || epicCoin || (accountCoin && (reservation.status === 'pending' || quaiAccountCoin))
      )
      const snapshotCanTrackOutgoing = accountCoin || utxoCoin
      const snapshotOutgoingTxids = snapshotCanTrackOutgoing ? snapshotPendingOutgoingTxids(f?.coinSnapshot) : new Set<string>()
      const initialSnapshotOutgoingUnits = snapshotCanTrackOutgoing ? snapshotPendingOutgoingUnits(f?.coinSnapshot) : 0n
      const snapshotHasPendingOutgoing = snapshotOutgoingTxids.size > 0 || initialSnapshotOutgoingUnits > 0n
      let snapshotOutgoingUnits = initialSnapshotOutgoingUnits
      const hasPendingReservation = coinReservations.some((reservation) => reservation.status === 'pending')
      const shouldApplyExpectedAfterFloor = utxoCoin && hasPendingReservation
      if (f?.balanceFromServer) {
        for (const reservation of coinReservations) {
          let expectedAfter = reservation.expectedBalanceAfter ? toBaseUnits(reservation.expectedBalanceAfter, decimals) : null
          const delta = (reservation.internal ? 0n : toBaseUnits(reservation.amount, decimals)) + toBaseUnits(reservation.fee ?? '0', decimals)
          const before = reservation.balanceBefore ? toBaseUnits(reservation.balanceBefore, decimals) : null
          const computedExpectedAfter = before !== null ? before - delta : null
          if (
            computedExpectedAfter !== null
            && computedExpectedAfter >= 0n
            && (expectedAfter === null || computedExpectedAfter > expectedAfter)
          ) {
            expectedAfter = computedExpectedAfter
          }
          const expectedAfterWithLaterIncoming = expectedAfter === null
            ? null
            : expectedAfter + incomingUnitsAfterReservation(storedTransactions, reservation, decimals, {
              clockSkewGraceMs: utxoCoin ? 60_000 : 5_000,
            })
          const quaiSnapshotStillStale = quaiAccountCoin
            && expectedAfterWithLaterIncoming !== null
            && serverUnits > expectedAfterWithLaterIncoming
          if (quaiSnapshotStillStale) {
            const reservationCreatedAtMs = Date.parse(reservation.createdAt)
            const order = Number.isFinite(reservationCreatedAtMs) ? reservationCreatedAtMs : quaiExpectedAfterCeilingAt
            if (quaiExpectedAfterCeiling === null || order >= quaiExpectedAfterCeilingAt) {
              quaiExpectedAfterCeiling = expectedAfterWithLaterIncoming
              quaiExpectedAfterCeilingAt = order
            }
          }
          if (
            snapshotCanTrackOutgoing
            && reservation.status === 'pending'
            && reservationTrackedBySnapshot(reservation, snapshotOutgoingTxids, snapshotOutgoingUnits, delta)
            && !quaiSnapshotStillStale
          ) {
            if (
              shouldApplyExpectedAfterFloor
              && expectedAfterWithLaterIncoming !== null
              && expectedAfterWithLaterIncoming > expectedAfterFloor
            ) {
              expectedAfterFloor = expectedAfterWithLaterIncoming
            }
            if (snapshotOutgoingUnits >= delta) snapshotOutgoingUnits -= delta
            continue
          }
          if (
            accountCoin
            && !quaiAccountCoin
            && reservation.status === 'pending'
            && !snapshotHasPendingOutgoing
            && expectedAfterWithLaterIncoming !== null
            && serverUnits > expectedAfterWithLaterIncoming
          ) {
            continue
          }
          if (
            reservation.status === 'pending'
            && shouldApplyExpectedAfterFloor
            && expectedAfterWithLaterIncoming !== null
            && expectedAfterWithLaterIncoming > expectedAfterFloor
          ) {
            expectedAfterFloor = expectedAfterWithLaterIncoming
          }
          if (expectedAfter === 0n) zeroExpectedAfter = true
          // Subtract only the part of an outgoing reservation the node has not
          // reflected yet. If this wallet also received funds after that send,
          // keep those later incoming units in the expected balance so a
          // send-back does not get subtracted a second time on the receiver.
          if (expectedAfterWithLaterIncoming !== null) {
            const unreflected = serverUnits - expectedAfterWithLaterIncoming
            if (unreflected > 0n) reservedUnits += unreflected > delta ? delta : unreflected
            continue
          }
          if (reservation.status === 'pending') reservedUnits += delta
        }
      }
      let nextUnits = serverUnits - reservedUnits
      if (
        quaiExpectedAfterCeiling !== null
        && serverUnits > quaiExpectedAfterCeiling
        && nextUnits !== quaiExpectedAfterCeiling
      ) {
        nextUnits = quaiExpectedAfterCeiling
      }
      // Floor at the post-send expected balance so a node that has counted the
      // spent inputs but not yet credited our change can't briefly under-report.
      if (shouldApplyExpectedAfterFloor && expectedAfterFloor > nextUnits) nextUnits = expectedAfterFloor
      if (nextUnits < 0n) nextUnits = 0n
      const hiddenAccountIncomingCandidateUnits = accountCoin
        && hasPendingReservation
        && f?.balanceFromServer
        && reservedUnits > 0n
        && serverUnits > nextUnits
          ? serverUnits - nextUnits
          : 0n
      const visibleUnits = nextUnits
      let balance = fromBaseUnits(visibleUnits, decimals)
      let preserveCurrentSpendableBalance = false
      // Authoritative: accept every server read вЂ” up OR down вЂ” immediately. The
      // ONLY thing we guard is a transient drop to *exactly* zero (an indexer
      // miss or an address-variant balance timeout) while we still had a balance
      // and have no wallet-known spend, so the coin doesn't flash 0 for a tick.
      const serverProvenZero = Boolean(
        f?.balanceFromServer
        && snapshotBalancesForAddresses(f.coinSnapshot, f.addresses ?? []).length > 0
        && snapshotUtxoUnits(f.coinSnapshot, f.addresses ?? []) === 0n
      )
      const transientZeroRead = (isUtxoCoin(c) || isAccountCoin(c))
        && f?.balanceFromServer
        && reservedUnits === 0n
        && nextUnits === 0n
        && previousUnits > 0n
        && !zeroExpectedAfter
        && !recentOutgoingByCoin.has(c.id)
        && !serverProvenZero
      const hasFreshIncomingGate = hasFreshIncomingBalanceGateForCoin(storedTransactions, c.id)
      const hasRecentIncoming = hasFreshIncomingGate || recentIncomingByCoin.has(c.id)
      const dropUnits = previousUnits > nextUnits ? previousUnits - nextUnits : 0n
      const recentOutgoingSpendMatchesDrop = accountCoin
        && (recentOutgoingUnitsByCoin.get(c.id) ?? []).some((units) => {
          const diff = units > dropUnits ? units - dropUnits : dropUnits - units
          return diff <= ACCOUNT_BALANCE_DROP_MATCH_TOLERANCE_UNITS
        })
      const utxoRecentOutgoingSpendMatchesDrop = utxoCoin
        && (recentOutgoingUnitsByCoin.get(c.id) ?? []).some((units) => {
          const diff = units > dropUnits ? units - dropUnits : dropUnits - units
          return diff <= ACCOUNT_BALANCE_DROP_MATCH_TOLERANCE_UNITS
        })
      const utxoRecentIncomingDropMatches = utxoCoin
        && (recentIncomingUnitsByCoin.get(c.id) ?? []).some((units) => {
          const diff = units > dropUnits ? units - dropUnits : dropUnits - units
          return diff <= ACCOUNT_BALANCE_DROP_MATCH_TOLERANCE_UNITS
        })
      const freshIncomingServerLag = (isUtxoCoin(c) || isAccountCoin(c))
        && f?.balanceFromServer
        && reservedUnits === 0n
        && nextUnits < previousUnits
        && hasRecentIncoming
        && (
          !recentOutgoingByCoin.has(c.id)
          || (accountCoin && !recentOutgoingSpendMatchesDrop)
          || (utxoCoin && (utxoRecentIncomingDropMatches || !utxoRecentOutgoingSpendMatchesDrop))
        )
      if (freshIncomingServerLag) {
        balance = current.balance
        preserveCurrentSpendableBalance = true
        coinsWithBalanceChange.add(c.id)
      } else if (transientZeroRead && (zeroBalanceReads[c.id] ?? 0) < ZERO_BALANCE_THRESHOLD) {
        zeroBalanceReads[c.id] = (zeroBalanceReads[c.id] ?? 0) + 1
        balance = current.balance
        preserveCurrentSpendableBalance = true
        coinsWithBalanceChange.add(c.id)
      } else {
        zeroBalanceReads[c.id] = 0
      }
      const privacyVisibleCandidate = privacyCoin
        ? { balance, spendableBalance: f?.spendableBalance ?? current.spendableBalance ?? balance }
        : undefined
      const privacyHideDecision = privacyCoin
        ? privacyHideBalanceDecision(c, status, privacyVisibleCandidate)
        : null
      const hidePrivacyBalance = privacyHideDecision?.hide ?? false
      if (hidePrivacyBalance) balance = '0'
      let spendableBalance = preserveCurrentSpendableBalance
        ? (current.spendableBalance ?? balance)
        : privacyCoin
        ? (hidePrivacyBalance ? '0' : (f?.spendableBalance ?? current.spendableBalance ?? balance))
        : (f?.balanceFromServer ? (reservedUnits > 0n ? balance : (f.spendableBalance ?? balance)) : current.spendableBalance)
      if (privacyCoin) {
        const capped = capPrivacyBalanceByPendingOutgoing(c, balance, spendableBalance, storedTransactions)
        balance = capped.balance
        spendableBalance = capped.spendableBalance ?? spendableBalance
        const balanceUnits = toBaseUnits(balance || '0', decimals)
        const spendableUnits = toBaseUnits(spendableBalance ?? balance ?? '0', decimals)
        if (spendableUnits > balanceUnits) spendableBalance = balance
      }
      const priceUsd = prices[c.id] ?? current.priceUsd
      const balanceNum = parseFloat(balance) || 0
      const fiatValue = typeof priceUsd === 'number' ? priceUsd * balanceNum : current.fiatValue
      const previous = current
      if (
        f?.balanceFromServer
        && (isUtxoCoin(c) || isAccountCoin(c))
        && previous
        && previous.balance !== balance
      ) {
        coinsWithBalanceChange.add(c.id)
        const nextVisibleUnits = toBaseUnits(balance || '0', decimals)
        if (nextVisibleUnits > previousUnits) {
          const deltaUnits = nextVisibleUnits - previousUnits
          const localPendingIncomingCoversDelta = pendingIncomingUnits >= deltaUnits
          const largeHistoricalJump = !accountCoin
            && snapshotHasSettledAddressBalance(f.coinSnapshot, f.addresses ?? [])
            && previousUnits > 0n
            && deltaUnits > previousUnits * 10n
          const bootstrapHistoricalBalance = options.bootstrapBalances === true
            && previousUnits === 0n
            && snapshotHasSettledAddressBalance(f.coinSnapshot, f.addresses ?? [])
          const existingHistoryCanCoverIncrease = accountCoin || utxoCoin || previousUnits === 0n || largeHistoricalJump
          incomingBalanceIncreases.set(c.id, {
            coinId: c.id,
            deltaUnits,
            decimals,
            allowWithoutHistory: Boolean(
              (!accountCoin && localPendingIncomingCoversDelta)
              || largeHistoricalJump
              || bootstrapHistoricalBalance
            ),
            allowExistingHistoryCoverage: existingHistoryCanCoverIncrease,
            allowAnyVerifiedHistoryCoverage: previousUnits === 0n || largeHistoricalJump,
            syntheticTransactions: syntheticIncomingTransactionsFromSnapshot(
              c,
              f.coinSnapshot,
              f.addresses ?? [],
              deltaUnits,
              decimals,
            ),
          })
        }
      }
      if (c.id === 'quai') {
        quaiDebugLog('coins.compute.quai', {
          loadSeq,
          current: summarizeQuaiCoin(current),
          status,
          f: f
            ? {
                balance: f.balance,
                spendableBalance: f.spendableBalance,
                balanceFromServer: f.balanceFromServer,
                addresses: f.addresses,
                snapshot: summarizeQuaiSnapshotCoin(f.coinSnapshot),
              }
            : null,
          previousUnits: previousUnits.toString(),
          baseServerUnits: baseServerUnits.toString(),
          serverUnits: serverUnits.toString(),
          pendingIncomingUnits: pendingIncomingUnits.toString(),
          pendingIncomingKeys,
          serverCoveredPendingIncomingUnits: serverCoveredPendingIncomingUnits.toString(),
          uncoveredPendingIncomingUnits: uncoveredPendingIncomingUnits.toString(),
          localPendingIncomingUnits: localPendingIncomingUnits.toString(),
          reservedUnits: reservedUnits.toString(),
          reservations: coinReservations.map((reservation) => ({
            txHash: reservation.txHash,
            status: reservation.status,
            amount: reservation.amount,
            fee: reservation.fee,
            internal: reservation.internal,
            balanceBefore: reservation.balanceBefore,
            expectedBalanceAfter: reservation.expectedBalanceAfter,
            createdAt: reservation.createdAt,
          })),
          quaiExpectedAfterCeiling: quaiExpectedAfterCeiling?.toString() ?? null,
          expectedAfterFloor: expectedAfterFloor.toString(),
          hiddenAccountIncomingCandidateUnits: hiddenAccountIncomingCandidateUnits.toString(),
          zeroExpectedAfter,
          nextUnits: visibleUnits.toString(),
          balance,
          spendableBalance,
          privacyHideDecision,
          preserveCurrentSpendableBalance,
          transientZeroRead,
          freshIncomingServerLag,
          hasFreshIncomingGate,
          hasRecentIncoming,
          dropUnits: dropUnits.toString(),
          recentOutgoing: recentOutgoingByCoin.has(c.id),
          recentOutgoingSpendMatchesDrop,
          recentOutgoingUnits: (recentOutgoingUnitsByCoin.get(c.id) ?? []).map((units) => units.toString()),
          incomingBalanceIncrease: incomingBalanceIncreases.get(c.id)
            ? {
                deltaUnits: incomingBalanceIncreases.get(c.id)?.deltaUnits.toString(),
                allowWithoutHistory: incomingBalanceIncreases.get(c.id)?.allowWithoutHistory,
                allowExistingHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowExistingHistoryCoverage,
                allowAnyVerifiedHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowAnyVerifiedHistoryCoverage,
                syntheticCount: incomingBalanceIncreases.get(c.id)?.syntheticTransactions?.length ?? 0,
              }
            : null,
        })
      }
      if (privacyCoin) {
        privacyDebugLog(c.id, 'coins.privacy.compute', {
          loadSeq,
          current: summarizeCoinState(current),
          status,
          f: f
            ? {
                balance: f.balance,
                spendableBalance: f.spendableBalance,
                balanceFromServer: f.balanceFromServer,
              }
            : null,
          previousUnits: previousUnits.toString(),
          baseServerUnits: baseServerUnits.toString(),
          serverUnits: serverUnits.toString(),
          reservedUnits: reservedUnits.toString(),
          reservations: coinReservations.map((reservation) => ({
            txHash: reservation.txHash,
            status: reservation.status,
            amount: reservation.amount,
            fee: reservation.fee,
            internal: reservation.internal,
            balanceBefore: reservation.balanceBefore,
            expectedBalanceAfter: reservation.expectedBalanceAfter,
            createdAt: reservation.createdAt,
          })),
          nextUnits: visibleUnits.toString(),
          balance,
          spendableBalance,
          preserveCurrentSpendableBalance,
          transientZeroRead,
          freshIncomingServerLag,
          nativeReadiness: privacyWalletService.getNativeReadiness(c.id as PrivacyCoin),
          recoveryPending: privacyBirthService.isRecoveryPending(c.id as PrivacyCoin),
        })
      }
      if (c.id === 'pearl') {
        coinDebugLog('pearl', 'coins.compute.pearl', {
          loadSeq,
          current: summarizePearlCoin(current),
          status,
          f: f
            ? {
                balance: f.balance,
                spendableBalance: f.spendableBalance,
                balanceFromServer: f.balanceFromServer,
                addresses: f.addresses,
                snapshot: summarizeQuaiSnapshotCoin(f.coinSnapshot),
              }
            : null,
          previousUnits: previousUnits.toString(),
          baseServerUnits: baseServerUnits.toString(),
          serverUnits: serverUnits.toString(),
          pendingIncomingUnits: pendingIncomingUnits.toString(),
          pendingIncomingKeys,
          serverCoveredPendingIncomingUnits: serverCoveredPendingIncomingUnits.toString(),
          uncoveredPendingIncomingUnits: uncoveredPendingIncomingUnits.toString(),
          localPendingIncomingUnits: localPendingIncomingUnits.toString(),
          reservedUnits: reservedUnits.toString(),
          reservations: coinReservations.map((reservation) => ({
            txHash: reservation.txHash,
            status: reservation.status,
            amount: reservation.amount,
            fee: reservation.fee,
            internal: reservation.internal,
            balanceBefore: reservation.balanceBefore,
            expectedBalanceAfter: reservation.expectedBalanceAfter,
            createdAt: reservation.createdAt,
          })),
          expectedAfterFloor: expectedAfterFloor.toString(),
          zeroExpectedAfter,
          nextUnits: visibleUnits.toString(),
          balance,
          spendableBalance,
          preserveCurrentSpendableBalance,
          transientZeroRead,
          freshIncomingServerLag,
          hasFreshIncomingGate,
          hasRecentIncoming,
          dropUnits: dropUnits.toString(),
          recentOutgoing: recentOutgoingByCoin.has(c.id),
          recentOutgoingSpendMatchesDrop,
          recentOutgoingUnits: (recentOutgoingUnitsByCoin.get(c.id) ?? []).map((units) => units.toString()),
          incomingBalanceIncrease: incomingBalanceIncreases.get(c.id)
            ? {
                deltaUnits: incomingBalanceIncreases.get(c.id)?.deltaUnits.toString(),
                allowWithoutHistory: incomingBalanceIncreases.get(c.id)?.allowWithoutHistory,
                allowExistingHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowExistingHistoryCoverage,
                allowAnyVerifiedHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowAnyVerifiedHistoryCoverage,
                syntheticCount: incomingBalanceIncreases.get(c.id)?.syntheticTransactions?.length ?? 0,
              }
            : null,
        })
      }
      if (c.id === 'raptoreum') {
        coinDebugLog('raptoreum', 'coins.compute.raptoreum', {
          loadSeq,
          current: summarizeCoinState(current),
          status,
          f: f
            ? {
                balance: f.balance,
                spendableBalance: f.spendableBalance,
                balanceFromServer: f.balanceFromServer,
                addresses: f.addresses,
                snapshot: summarizeQuaiSnapshotCoin(f.coinSnapshot),
              }
            : null,
          previousUnits: previousUnits.toString(),
          baseServerUnits: baseServerUnits.toString(),
          serverUnits: serverUnits.toString(),
          pendingIncomingUnits: pendingIncomingUnits.toString(),
          pendingIncomingKeys,
          serverCoveredPendingIncomingUnits: serverCoveredPendingIncomingUnits.toString(),
          uncoveredPendingIncomingUnits: uncoveredPendingIncomingUnits.toString(),
          localPendingIncomingUnits: localPendingIncomingUnits.toString(),
          reservedUnits: reservedUnits.toString(),
          snapshotOutgoingTxids: [...snapshotOutgoingTxids],
          snapshotOutgoingUnits: initialSnapshotOutgoingUnits.toString(),
          snapshotRemainingOutgoingUnits: snapshotOutgoingUnits.toString(),
          reservations: coinReservations.map((reservation) => ({
            txHash: reservation.txHash,
            status: reservation.status,
            amount: reservation.amount,
            fee: reservation.fee,
            internal: reservation.internal,
            balanceBefore: reservation.balanceBefore,
            expectedBalanceAfter: reservation.expectedBalanceAfter,
            createdAt: reservation.createdAt,
          })),
          nextUnits: visibleUnits.toString(),
          balance,
          spendableBalance,
          preserveCurrentSpendableBalance,
          transientZeroRead,
          freshIncomingServerLag,
          hasFreshIncomingGate,
          hasRecentIncoming,
          utxoRecentIncomingDropMatches,
          utxoRecentOutgoingSpendMatchesDrop,
          recentIncomingUnits: (recentIncomingUnitsByCoin.get(c.id) ?? []).map((units) => units.toString()),
          recentOutgoingUnits: (recentOutgoingUnitsByCoin.get(c.id) ?? []).map((units) => units.toString()),
          incomingBalanceIncrease: incomingBalanceIncreases.get(c.id)
            ? {
                deltaUnits: incomingBalanceIncreases.get(c.id)?.deltaUnits.toString(),
                allowWithoutHistory: incomingBalanceIncreases.get(c.id)?.allowWithoutHistory,
                allowExistingHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowExistingHistoryCoverage,
                allowAnyVerifiedHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowAnyVerifiedHistoryCoverage,
                syntheticCount: incomingBalanceIncreases.get(c.id)?.syntheticTransactions?.length ?? 0,
              }
            : null,
        })
      }
      if (shouldDebugUtxoIncomingCoin(c.id)) {
        coinDebugLog(c.id, 'coins.compute.utxo', {
          loadSeq,
          current: summarizeCoinState(current),
          status,
          f: f
            ? {
                balance: f.balance,
                spendableBalance: f.spendableBalance,
                balanceFromServer: f.balanceFromServer,
                addresses: f.addresses,
                snapshot: summarizeQuaiSnapshotCoin(f.coinSnapshot),
              }
            : null,
          previousUnits: previousUnits.toString(),
          baseServerUnits: baseServerUnits.toString(),
          serverUnits: serverUnits.toString(),
          pendingIncomingUnits: pendingIncomingUnits.toString(),
          pendingIncomingKeys,
          serverCoveredPendingIncomingUnits: serverCoveredPendingIncomingUnits.toString(),
          uncoveredPendingIncomingUnits: uncoveredPendingIncomingUnits.toString(),
          localPendingIncomingUnits: localPendingIncomingUnits.toString(),
          reservedUnits: reservedUnits.toString(),
          snapshotOutgoingTxids: [...snapshotOutgoingTxids],
          snapshotOutgoingUnits: initialSnapshotOutgoingUnits.toString(),
          snapshotRemainingOutgoingUnits: snapshotOutgoingUnits.toString(),
          nextUnits: visibleUnits.toString(),
          balance,
          spendableBalance,
          preserveCurrentSpendableBalance,
          transientZeroRead,
          freshIncomingServerLag,
          hasFreshIncomingGate,
          hasRecentIncoming,
          incomingBalanceIncrease: incomingBalanceIncreases.get(c.id)
            ? {
                deltaUnits: incomingBalanceIncreases.get(c.id)?.deltaUnits.toString(),
                allowWithoutHistory: incomingBalanceIncreases.get(c.id)?.allowWithoutHistory,
                allowExistingHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowExistingHistoryCoverage,
                allowAnyVerifiedHistoryCoverage: incomingBalanceIncreases.get(c.id)?.allowAnyVerifiedHistoryCoverage,
                syntheticCount: incomingBalanceIncreases.get(c.id)?.syntheticTransactions?.length ?? 0,
              }
            : null,
        })
      }
      return {
        ...c,
        enabled: current.enabled,
        favorite: current.favorite,
        status,
        recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
        balance,
        spendableBalance,
        priceUsd,
        fiatValue,
      }
    })

    if (loadSeq !== coinLoadSeq) {
      quaiDebugLog('coins.abort.afterCompute', { loadSeq, activeSeq: coinLoadSeq })
      return
    }
    // The gateway balance is authoritative and ALREADY includes unconfirmed.
    // For increases, require a matching history row or synthetic UTXO row
    // before saving, so deposits do not show as "balance first, tx later".
    let incomingHistoryCovered = new Set<string>()
    if (incomingBalanceIncreases.size > 0 && stillSameWallet(expectedScope, expectedMnemonic)) {
      quaiDebugLog('coins.incomingHistory.start', {
        loadSeq,
        increases: [...incomingBalanceIncreases.values()].map((increase) => ({
          coinId: increase.coinId,
          deltaUnits: increase.deltaUnits.toString(),
          allowWithoutHistory: increase.allowWithoutHistory,
          allowExistingHistoryCoverage: increase.allowExistingHistoryCoverage,
          allowAnyVerifiedHistoryCoverage: increase.allowAnyVerifiedHistoryCoverage,
          syntheticCount: increase.syntheticTransactions?.length ?? 0,
        })),
        skipHistoryFetch: options.skipIncomingHistoryFetch === true,
      })
      if (incomingBalanceIncreases.has('pearl')) {
        coinDebugLog('pearl', 'coins.incomingHistory.start', {
          loadSeq,
          increases: [...incomingBalanceIncreases.values()]
            .filter((increase) => increase.coinId === 'pearl')
            .map((increase) => ({
              coinId: increase.coinId,
              deltaUnits: increase.deltaUnits.toString(),
              allowWithoutHistory: increase.allowWithoutHistory,
              allowExistingHistoryCoverage: increase.allowExistingHistoryCoverage,
              allowAnyVerifiedHistoryCoverage: increase.allowAnyVerifiedHistoryCoverage,
              syntheticCount: increase.syntheticTransactions?.length ?? 0,
            })),
          skipHistoryFetch: options.skipIncomingHistoryFetch === true,
        })
      }
      if (incomingBalanceIncreases.has('raptoreum')) {
        coinDebugLog('raptoreum', 'coins.incomingHistory.start', {
          loadSeq,
          increases: [...incomingBalanceIncreases.values()]
            .filter((increase) => increase.coinId === 'raptoreum')
            .map((increase) => ({
              coinId: increase.coinId,
              deltaUnits: increase.deltaUnits.toString(),
              allowWithoutHistory: increase.allowWithoutHistory,
              allowExistingHistoryCoverage: increase.allowExistingHistoryCoverage,
              allowAnyVerifiedHistoryCoverage: increase.allowAnyVerifiedHistoryCoverage,
              syntheticCount: increase.syntheticTransactions?.length ?? 0,
            })),
          skipHistoryFetch: options.skipIncomingHistoryFetch === true,
        })
      }
      for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
        if (!incomingBalanceIncreases.has(coinId)) continue
        coinDebugLog(coinId, 'coins.incomingHistory.start', {
          loadSeq,
          increases: [...incomingBalanceIncreases.values()]
            .filter((increase) => increase.coinId === coinId)
            .map((increase) => ({
              coinId: increase.coinId,
              deltaUnits: increase.deltaUnits.toString(),
              allowWithoutHistory: increase.allowWithoutHistory,
              allowExistingHistoryCoverage: increase.allowExistingHistoryCoverage,
              allowAnyVerifiedHistoryCoverage: increase.allowAnyVerifiedHistoryCoverage,
              syntheticCount: increase.syntheticTransactions?.length ?? 0,
            })),
          skipHistoryFetch: options.skipIncomingHistoryFetch === true,
        })
      }
      incomingHistoryCovered = await withTimeout(
        preloadIncomingHistory(expectedScope, expectedMnemonic, [...incomingBalanceIncreases.values()], {
          skipHistoryFetch: options.skipIncomingHistoryFetch === true,
        }),
        INCOMING_HISTORY_SYNC_TIMEOUT_MS,
      ).catch(() => new Set<string>())
      quaiDebugLog('coins.incomingHistory.done', {
        loadSeq,
        covered: [...incomingHistoryCovered],
      })
      if (incomingBalanceIncreases.has('pearl')) {
        coinDebugLog('pearl', 'coins.incomingHistory.done', {
          loadSeq,
          covered: [...incomingHistoryCovered],
        })
      }
      if (incomingBalanceIncreases.has('raptoreum')) {
        coinDebugLog('raptoreum', 'coins.incomingHistory.done', {
          loadSeq,
          covered: [...incomingHistoryCovered],
        })
      }
      for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
        if (!incomingBalanceIncreases.has(coinId)) continue
        coinDebugLog(coinId, 'coins.incomingHistory.done', {
          loadSeq,
          covered: [...incomingHistoryCovered],
        })
      }
      if (incomingHistoryCovered.size > 0) {
        quaiDebugLog('coins.incomingHistory.renderYield', {
          loadSeq,
          covered: [...incomingHistoryCovered],
        })
        await waitForRendererTick()
      }
    }
    const staleAfterIncomingHistory = loadSeq !== coinLoadSeq
    if (!stillSameWallet(expectedScope, expectedMnemonic)) {
      quaiDebugLog('coins.abort.afterIncomingHistory', { loadSeq, activeSeq: coinLoadSeq })
      return
    }
    if (staleAfterIncomingHistory && incomingHistoryCovered.size === 0) {
      quaiDebugLog('coins.abort.afterIncomingHistory', { loadSeq, activeSeq: coinLoadSeq })
      return
    }
    if (staleAfterIncomingHistory) {
      quaiDebugLog('coins.continue.afterIncomingHistory', {
        loadSeq,
        activeSeq: coinLoadSeq,
        covered: [...incomingHistoryCovered],
      })
    }
    const uncoveredIncomingBalanceCoins = new Set(
      [...incomingBalanceIncreases.keys()].filter((coinId) => !incomingHistoryCovered.has(coinId)),
    )
    for (const coinId of uncoveredIncomingBalanceCoins) coinsWithBalanceChange.delete(coinId)
    const computedCoinsToSave = uncoveredIncomingBalanceCoins.size === 0
      ? nextCoins
      : nextCoins.map((coin) => uncoveredIncomingBalanceCoins.has(coin.id)
        ? beforeFinalById.get(coin.id) ?? coin
        : coin)
    const coinsToSave = staleAfterIncomingHistory
      ? (get().coins.length > 0 ? get().coins : await coinService.getCoins()).map((coin) => {
          if (!incomingHistoryCovered.has(coin.id)) return coin
          const updated = computedCoinsToSave.find((item) => item.id === coin.id)
          return updated
            ? {
                ...updated,
                enabled: coin.enabled,
                favorite: coin.favorite,
                recoveryProgress: coin.recoveryProgress,
              }
            : coin
        })
      : computedCoinsToSave
    quaiDebugLog('coins.save.before', {
      loadSeq,
      uncoveredIncomingBalanceCoins: [...uncoveredIncomingBalanceCoins],
      coinsWithBalanceChange: [...coinsWithBalanceChange],
      nextQuai: summarizeQuaiCoin(nextCoins.find((coin) => coin.id === 'quai')),
      savedCandidateQuai: summarizeQuaiCoin(coinsToSave.find((coin) => coin.id === 'quai')),
    })
    if (nextCoins.some((coin) => coin.id === 'pearl') || coinsToSave.some((coin) => coin.id === 'pearl')) {
      coinDebugLog('pearl', 'coins.save.before', {
        loadSeq,
        uncoveredIncomingBalanceCoins: [...uncoveredIncomingBalanceCoins],
        coinsWithBalanceChange: [...coinsWithBalanceChange],
        nextPearl: summarizePearlCoin(nextCoins.find((coin) => coin.id === 'pearl')),
        savedCandidatePearl: summarizePearlCoin(coinsToSave.find((coin) => coin.id === 'pearl')),
      })
    }
    if (nextCoins.some((coin) => coin.id === 'raptoreum') || coinsToSave.some((coin) => coin.id === 'raptoreum')) {
      coinDebugLog('raptoreum', 'coins.save.before', {
        loadSeq,
        uncoveredIncomingBalanceCoins: [...uncoveredIncomingBalanceCoins],
        coinsWithBalanceChange: [...coinsWithBalanceChange],
        nextRaptoreum: summarizeCoinState(nextCoins.find((coin) => coin.id === 'raptoreum')),
        savedCandidateRaptoreum: summarizeCoinState(coinsToSave.find((coin) => coin.id === 'raptoreum')),
      })
    }
    for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
      if (!nextCoins.some((coin) => coin.id === coinId) && !coinsToSave.some((coin) => coin.id === coinId)) continue
      coinDebugLog(coinId, 'coins.save.before', {
        loadSeq,
        uncoveredIncomingBalanceCoins: [...uncoveredIncomingBalanceCoins],
        coinsWithBalanceChange: [...coinsWithBalanceChange],
        nextCoin: summarizeCoinState(nextCoins.find((coin) => coin.id === coinId)),
        savedCandidateCoin: summarizeCoinState(coinsToSave.find((coin) => coin.id === coinId)),
      })
    }
    const savedCoins = await coinService.saveRuntimeCoins(coinsToSave)
    if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) {
      quaiDebugLog('coins.abort.afterSave', { loadSeq, activeSeq: coinLoadSeq })
      return
    }
    set({
      coins: savedCoins,
      loading: false,
      refreshing: false,
      lastActiveAt,
      consecutiveFailures,
      zeroBalanceReads,
      reservedOutgoing: readReservedOutgoing(),
      sendReadyLoadedAt: Date.now(),
    })
    quaiDebugLog('coins.save.after', {
      loadSeq,
      savedQuai: summarizeQuaiCoin(savedCoins.find((coin) => coin.id === 'quai')),
      skipHistoryRefresh: options.skipHistoryRefresh === true,
      willRefreshHistory: coinsWithBalanceChange.size > 0 && options.skipHistoryRefresh !== true,
    })
    if (savedCoins.some((coin) => coin.id === 'pearl')) {
      coinDebugLog('pearl', 'coins.save.after', {
        loadSeq,
        savedPearl: summarizePearlCoin(savedCoins.find((coin) => coin.id === 'pearl')),
        skipHistoryRefresh: options.skipHistoryRefresh === true,
        willRefreshHistory: coinsWithBalanceChange.size > 0 && options.skipHistoryRefresh !== true,
      })
    }
    if (savedCoins.some((coin) => coin.id === 'raptoreum')) {
      coinDebugLog('raptoreum', 'coins.save.after', {
        loadSeq,
        savedRaptoreum: summarizeCoinState(savedCoins.find((coin) => coin.id === 'raptoreum')),
        skipHistoryRefresh: options.skipHistoryRefresh === true,
        willRefreshHistory: coinsWithBalanceChange.size > 0 && options.skipHistoryRefresh !== true,
      })
    }
    for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
      if (!savedCoins.some((coin) => coin.id === coinId)) continue
      coinDebugLog(coinId, 'coins.save.after', {
        loadSeq,
        savedCoin: summarizeCoinState(savedCoins.find((coin) => coin.id === coinId)),
        skipHistoryRefresh: options.skipHistoryRefresh === true,
        willRefreshHistory: coinsWithBalanceChange.size > 0 && options.skipHistoryRefresh !== true,
      })
    }

    if (coinsWithBalanceChange.size > 0 && options.skipHistoryRefresh !== true && stillSameWallet(expectedScope, expectedMnemonic)) {
      const changedCoinIds = [...coinsWithBalanceChange]
      void import('./transactionStore').then(({ useTransactionStore }) => {
        if (!stillSameWallet(expectedScope, expectedMnemonic)) return
        void useTransactionStore.getState().loadTransactions({
          page: 1,
          force: true,
          silent: false,
          skipIncomingBalanceDelta: true,
          onlyCoinIds: changedCoinIds,
        })
      })
    }

    if (deferredStartupCoins.length > 0) {
      void (async () => {
        const deferredIds = new Set(deferredStartupCoins.map((coin) => coin.id))
        const applyDeferredSnapshot = async (
          snapshot: WalletSnapshotResponse,
          items: Array<{ coin: string; addresses: string[] }> = [],
          includeBalances = false,
        ) => {
          if (loadSeq !== coinLoadSeq) return
          if (!stillSameWallet(expectedScope, expectedMnemonic)) return
          const deferredItemsByCoin = new Map(items.map((item) => [item.coin, item.addresses]))
          const deferredPrices = snapshot.prices ?? {}
          const nextLastActiveAt = { ...get().lastActiveAt }
          const nextFailures = { ...get().consecutiveFailures }
          const now = Date.now()
          const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
          const deferredBalanceChanged = new Set<string>()
          const deferredIncomingBalanceIncreases = new Map<string, IncomingBalanceIncrease>()
          const currentReservations = readReservedOutgoing()
          const deferredStoredTransactions = readStoredTransactions()
          const deferredRecentOutgoingByCoin = new Set(
            deferredStoredTransactions
              .filter((tx) => tx.type === 'outgoing' && tx.status !== 'failed')
              .filter((tx) => {
                const createdAtMs = Date.parse(tx.createdAt)
                return Number.isFinite(createdAtMs) && now - createdAtMs < ORPHAN_RESERVATION_TTL_MS
              })
              .map((tx) => tx.coinId),
          )
          let touched = false
          const next = current.map((coin) => {
            if (!deferredIds.has(coin.id)) return coin
            const coinSnapshot = snapshot.coins[coin.id]
            if (!coinSnapshot) return coin
            touched = true
            const status = coinSnapshot.network
              ? statusWithPrivacyRuntime(coin, networkToStatus(coinSnapshot.network))
              : coin.status
            if (status === 'active') {
              nextLastActiveAt[coin.id] = now
              nextFailures[coin.id] = 0
            }
            let balance = includeBalances
              ? balanceStringFromSnapshot(coin, coinSnapshot, deferredItemsByCoin.get(coin.id) ?? []) ?? coin.balance
              : coin.balance
            let spendableBalance = includeBalances
              ? spendableStringFromSnapshot(coin, coinSnapshot, deferredItemsByCoin.get(coin.id) ?? []) ?? balance
              : coin.spendableBalance
            if (includeBalances && isUtxoCoin(coin)) {
              const decimals = decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000)
              const previousUnits = toBaseUnits(coin.balance || '0', decimals)
              let nextUnits = toBaseUnits(balance || '0', decimals)
              let reservedUnits = 0n
              let expectedAfterFloor = 0n
              let zeroExpectedAfter = false
              for (const reservation of Object.values(currentReservations).filter((item) => item.coinId === coin.id)) {
                let expectedAfter = reservation.expectedBalanceAfter ? toBaseUnits(reservation.expectedBalanceAfter, decimals) : null
                const delta = (reservation.internal ? 0n : toBaseUnits(reservation.amount, decimals)) + toBaseUnits(reservation.fee ?? '0', decimals)
                const before = reservation.balanceBefore ? toBaseUnits(reservation.balanceBefore, decimals) : null
                const computedExpectedAfter = before !== null ? before - delta : null
                if (
                  computedExpectedAfter !== null
                  && computedExpectedAfter >= 0n
                  && (expectedAfter === null || computedExpectedAfter > expectedAfter)
                ) {
                  expectedAfter = computedExpectedAfter
                }
                const expectedAfterWithLaterIncoming = expectedAfter === null
                  ? null
                  : expectedAfter + incomingUnitsAfterReservation(deferredStoredTransactions, reservation, decimals, {
                    clockSkewGraceMs: 60_000,
                  })
                if (
                  reservation.status === 'pending'
                  && expectedAfterWithLaterIncoming !== null
                  && expectedAfterWithLaterIncoming > expectedAfterFloor
                ) {
                  expectedAfterFloor = expectedAfterWithLaterIncoming
                }
                if (expectedAfter === 0n) zeroExpectedAfter = true
                if (expectedAfterWithLaterIncoming !== null) {
                  const unreflected = nextUnits - expectedAfterWithLaterIncoming
                  if (unreflected > 0n) reservedUnits += unreflected > delta ? delta : unreflected
                  continue
                }
                if (reservation.status === 'pending') {
                  reservedUnits += delta
                }
              }
              nextUnits -= reservedUnits
              balance = fromBaseUnits(nextUnits < 0n ? 0n : nextUnits, decimals)
              if (expectedAfterFloor > nextUnits) {
                nextUnits = expectedAfterFloor
                balance = fromBaseUnits(nextUnits, decimals)
              } else if (
                previousUnits > 0n
                && nextUnits < previousUnits
                && reservedUnits === 0n
                && !deferredRecentOutgoingByCoin.has(coin.id)
                && hasFreshIncomingBalanceGateForCoin(deferredStoredTransactions, coin.id)
              ) {
                balance = coin.balance
                spendableBalance = coin.spendableBalance
              } else if (previousUnits > 0n && nextUnits === 0n && !zeroExpectedAfter) {
                balance = coin.balance
                spendableBalance = coin.spendableBalance
              }
            }
            const priceUsd = deferredPrices[coin.id] ?? coin.priceUsd
            const balanceNum = parseFloat(balance) || 0
            if (
              includeBalances
              && isUtxoCoin(coin)
              && coin.balance !== balance
            ) {
              deferredBalanceChanged.add(coin.id)
              const decimals = decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000)
              const previousUnits = toBaseUnits(coin.balance || '0', decimals)
              const nextVisibleUnits = toBaseUnits(balance || '0', decimals)
              if (nextVisibleUnits > previousUnits) {
                const deltaUnits = nextVisibleUnits - previousUnits
                const deferredLargeHistoricalJump = snapshotHasSettledAddressBalance(
                  coinSnapshot,
                  deferredItemsByCoin.get(coin.id) ?? [],
                )
                  && previousUnits > 0n
                  && deltaUnits > previousUnits * 10n
                deferredIncomingBalanceIncreases.set(coin.id, {
                  coinId: coin.id,
                  deltaUnits,
                  decimals,
                  allowWithoutHistory: Boolean(
                    deferredLargeHistoricalJump
                  ),
                  allowExistingHistoryCoverage: previousUnits === 0n || deferredLargeHistoricalJump,
                  allowAnyVerifiedHistoryCoverage: previousUnits === 0n || deferredLargeHistoricalJump,
                  syntheticTransactions: syntheticIncomingTransactionsFromSnapshot(
                    coin,
                    coinSnapshot,
                    deferredItemsByCoin.get(coin.id) ?? [],
                    deltaUnits,
                    decimals,
                  ),
                })
              }
            }
            return {
              ...coin,
              status,
              balance,
              spendableBalance,
              priceUsd,
              fiatValue: typeof priceUsd === 'number' ? priceUsd * balanceNum : coin.fiatValue,
            }
          })
          if (!touched || loadSeq !== coinLoadSeq) return
          // Same rule as the main path: surface the matching tx row before
          // saving an increased balance.
          let deferredHistoryCovered = new Set<string>()
          if (deferredIncomingBalanceIncreases.size > 0 && stillSameWallet(expectedScope, expectedMnemonic)) {
            deferredHistoryCovered = await withTimeout(
              preloadIncomingHistory(expectedScope, expectedMnemonic, [...deferredIncomingBalanceIncreases.values()], {
                skipHistoryFetch: options.skipIncomingHistoryFetch === true,
              }),
              INCOMING_HISTORY_SYNC_TIMEOUT_MS,
            ).catch(() => new Set<string>())
          }
          if (!stillSameWallet(expectedScope, expectedMnemonic)) return
          const uncoveredDeferredIncomingCoins = new Set(
            [...deferredIncomingBalanceIncreases.keys()].filter((coinId) => !deferredHistoryCovered.has(coinId)),
          )
          for (const coinId of uncoveredDeferredIncomingCoins) deferredBalanceChanged.delete(coinId)
          const coinsToSave = uncoveredDeferredIncomingCoins.size === 0
            ? next
            : next.map((coin) => uncoveredDeferredIncomingCoins.has(coin.id)
              ? current.find((item) => item.id === coin.id) ?? coin
              : coin)
          const saved = await coinService.saveRuntimeCoins(coinsToSave)
          if (loadSeq !== coinLoadSeq || !stillSameWallet(expectedScope, expectedMnemonic)) return
          set({ coins: saved, lastActiveAt: nextLastActiveAt, consecutiveFailures: nextFailures })
          if (deferredBalanceChanged.size > 0) {
            const changedCoinIds = [...deferredBalanceChanged]
            void import('./transactionStore').then(({ useTransactionStore }) => {
              if (!stillSameWallet(expectedScope, expectedMnemonic)) return
              void useTransactionStore.getState().loadTransactions({
                page: 1,
                force: true,
                silent: false,
                skipIncomingBalanceDelta: true,
                onlyCoinIds: changedCoinIds,
              })
            })
          }
        }

        try {
          await applyDeferredSnapshot(await walletSnapshotService.fetchNetwork(deferredStartupCoins))
        } catch {
          // Network status is refreshed again with the balance request below.
        }

        try {
          const { items, snapshot } = await walletSnapshotService.fetchBalances(deferredStartupCoins, {
            forceBalances: options.forceBalances === true,
          })
          await applyDeferredSnapshot(snapshot, items, true)
        } catch {
          // Slow scan-only coins should never hold up wallet startup.
        }
      })()
    }

    void get().refreshPrivacyBalances()
  },

  refreshPrivacyBalances: async () => {
    if (privacyBalanceRefreshInFlight) return
    const mnemonic = walletService.getSessionMnemonic()
    if (!mnemonic) return
    const expectedScope = walletService.getWalletStorageScope()

    const now = Date.now()
    const privacyCoins = (get().coins.length > 0 ? get().coins : await coinService.getCoins())
      .filter((coin) => coin.enabled && isPrivacyCoin(coin))
      .filter((coin) =>
        privacyRecoveryIsPending(coin)
        || privacyNativeVerificationRequired.has(coin.id as PrivacyCoin)
        || (
          privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
          && privacyCoinNeedsNativeReadiness(coin)
        )
        || now - (privacyLastRefreshAt[coin.id as PrivacyCoin] ?? 0) >= privacyBackgroundRefreshMs(coin),
      )
    if (!stillSameWallet(expectedScope, mnemonic)) return
    if (privacyCoins.length === 0) return
    for (const coin of privacyCoins) {
      privacyDebugLog(coin.id, 'privacy.refresh.start', {
        current: summarizeCoinState(coin),
        nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
        recoveryPending: privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin),
        needsNativeReadiness: privacyCoinNeedsNativeReadiness(coin),
        shouldShowNativePending: privacyCoinShouldShowNativePending(coin),
        lastRefreshAt: privacyLastRefreshAt[coin.id as PrivacyCoin] ?? null,
      })
    }

    privacyBalanceRefreshInFlight = true
    try {
      const pendingPrivacyIds = new Set(
        privacyCoins
          .filter((coin) =>
            privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
            && privacyCoinNeedsNativeReadiness(coin)
            && privacyCoinShouldShowNativePending(coin),
          )
          .map((coin) => coin.id),
      )
      const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
      if (!stillSameWallet(expectedScope, mnemonic)) return
      const pending = current.map((coin) =>
        pendingPrivacyIds.has(coin.id) && coin.status === 'active'
          ? { ...coin, status: privacyPendingStatus(coin) }
          : coin,
      )
      set({ coins: pending })

      await Promise.all(privacyCoins.map(async (coin) => {
        try {
          let cachedSnapshotForDecision: PrivacyWalletResponse | null = null
          const reportRecoveryProgress = shouldReportPrivacyProgress(coin)
          const shouldSeedFromCachedSnapshot = reportRecoveryProgress
            || !privacyCoinHasVisibleBalance(coin)
            || privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
          let deferLocalSnapshotAfterCache = false
          if (shouldSeedFromCachedSnapshot) {
            const cached = await privacyWalletService.getCachedSnapshot(coin.id as PrivacyCoin, mnemonic).catch(() => null)
            if (cached) {
              cachedSnapshotForDecision = cached
              privacyDebugLog(coin.id, 'privacy.refresh.cachedSnapshot', {
                current: summarizeCoinState(coin),
                cached: summarizePrivacySnapshot(cached),
                nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
                recoveryPending: privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin),
                reportRecoveryProgress,
                shouldSeedFromCachedSnapshot,
              })
              const cacheRecoveryWasPending = privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin)
              const progress = await cachedPrivacyProgress(coin, cached)
              const cacheSeedsRecovery = privacySnapshotHasRecoveredData(cached)
                || Number(cached.lastScannedHeight ?? 0) > 0
              const cacheDisplayReady = cacheSeedsRecovery
                && privacyCachedSnapshotCanRestoreDisplay(coin, cached, progress)
              if (cached.transactions?.length) {
                await mergePrivacySnapshotTransactions(coin, cached.transactions, {
                  expectedScope,
                  expectedMnemonic: mnemonic,
                  primeNotifications: cacheRecoveryWasPending,
                  tipHeight: cached.lastScannedHeight,
                })
              }
              if (cacheSeedsRecovery) {
                const cacheCanCompleteRecovery = cacheDisplayReady
                  || coin.id !== 'zano'
                  || privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) === 'ready'
                if (cacheCanCompleteRecovery) {
                  privacyBirthService.markRecoveryComplete(coin.id as PrivacyCoin)
                  if (cacheDisplayReady) privacyMarkDisplayReady(coin.id as PrivacyCoin)
                }
                maybeWarmPrivacyNativeFromCache(coin, mnemonic, expectedScope)
              }
              deferLocalSnapshotAfterCache = coin.id !== 'zano'
                && cacheSeedsRecovery
                && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready'
              if (!stillSameWallet(expectedScope, mnemonic)) return
              const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
              if (!stillSameWallet(expectedScope, mnemonic)) return
              const seeded = current.map((item) => {
                if (item.id !== coin.id) return item
                const nativeReady = privacyWalletService.getNativeReadiness(item.id as PrivacyCoin) === 'ready'
                const effectiveProgress = !nativeReady
                  && item.recoveryProgress
                  && item.recoveryProgress.blocksRemaining > 0
                  && (!progress || progress.blocksRemaining === 0)
                  ? item.recoveryProgress
                  : progress
                const showCachedProgress = Boolean(effectiveProgress && effectiveProgress.blocksRemaining > 0 && !nativeReady && !cacheDisplayReady)
                const status = (nativeReady || cacheDisplayReady) && cacheSeedsRecovery && !showCachedProgress
                  ? 'active'
                  : cacheSeedsRecovery && item.status !== 'maintenance' && item.status !== 'offline'
                    ? privacyPendingStatus(item, effectiveProgress)
                    : (showCachedProgress ? 'syncing' : privacyPendingStatus(item, effectiveProgress))
                const cachedBalance = bestPrivacySnapshotBalance(cached, item.satsPerCoin) ?? item.balance
                const cachedSpendable = bestPrivacySnapshotSpendable(cached, item.satsPerCoin) ?? item.spendableBalance ?? cachedBalance
                const capped = capPrivacyBalanceByPendingOutgoing(item, cachedBalance, cachedSpendable)
                const hideDecision = privacyHideBalanceDecision(item, status, {
                  balance: capped.balance,
                  spendableBalance: capped.spendableBalance ?? capped.balance,
                })
                const hideBalance = hideDecision.hide
                const finalVisibleBalance = hideBalance ? '0' : capped.balance
                const finalVisibleSpendable = hideBalance
                  ? '0'
                  : (capped.spendableBalance ?? capped.balance)
                privacyDebugLog(item.id, 'privacy.refresh.cachedDecision', {
                  current: summarizeCoinState(item),
                  status,
                  showCachedProgress,
                  progress: effectiveProgress,
                  cacheSeedsRecovery,
                  cacheDisplayReady,
                  cachedBalance,
                  cachedSpendable,
                  capped,
                  hideDecision,
                  finalVisibleBalance,
                  finalVisibleSpendable,
                  nativeReadiness: privacyWalletService.getNativeReadiness(item.id as PrivacyCoin),
                  recoveryPending: privacyBirthService.isRecoveryPending(item.id as PrivacyCoin),
                })
                return {
                  ...item,
                  address: cached.address ?? item.address,
                  status,
                  recoveryProgress: statusKeepsRecoveryProgress(status)
                    ? effectiveProgress ?? item.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(item.id as PrivacyCoin)
                    : undefined,
                  balance: finalVisibleBalance,
                  spendableBalance: finalVisibleSpendable,
                  fiatValue: typeof item.priceUsd === 'number' ? item.priceUsd * (parseFloat(finalVisibleBalance) || 0) : item.fiatValue,
                }
              })
              const saved = await coinService.saveRuntimeCoins(seeded)
              if (!stillSameWallet(expectedScope, mnemonic)) return
              set({ coins: saved })
            } else {
              const progress = await cachedPrivacyProgress(coin, null)
              if (progress && stillSameWallet(expectedScope, mnemonic)) {
                set({ coins: withRecoveryProgress(get().coins, coin.id, {
                  type: 'privacyRecovery',
                  progressToken: 'network-estimate',
                  coin: coin.id as PrivacyCoin,
                  ...progress,
                }) })
              }
            }
          }
          if (deferLocalSnapshotAfterCache) {
            privacyDebugLog(coin.id, 'privacy.refresh.localSnapshot.deferred', {
              current: summarizeCoinState(get().coins.find((item) => item.id === coin.id) ?? coin),
              reason: 'privacy-cache-visible-native-warming',
              nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
              recoveryPending: privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin),
              requiresNativeVerification: privacyNativeVerificationRequired.has(coin.id as PrivacyCoin),
            })
            return
          }
          const local = await withTimeout(
            privacyWalletService.getSnapshot(
              coin.id as PrivacyCoin,
              mnemonic,
              reportRecoveryProgress
                ? (progress) => {
                    if (stillSameWallet(expectedScope, mnemonic)) set({ coins: withRecoveryProgress(get().coins, coin.id, progress) })
                  }
                : undefined,
            ),
            PRIVACY_BACKGROUND_SNAPSHOT_TIMEOUT_MS,
          )
          if (!stillSameWallet(expectedScope, mnemonic)) return
          if (!local.ok || local.code?.endsWith('snapshot-needs-unlock')) {
            privacyDebugLog(coin.id, 'privacy.refresh.localSnapshot.skipped', {
              current: summarizeCoinState(coin),
              snapshot: summarizePrivacySnapshot(local),
              nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
              recoveryPending: privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin),
            })
            return
          }
          const localRegressesCachedHistory = coin.id === 'zano'
            && (local.cacheHistoryRegression === true || zanoSnapshotRegressesCachedHistory(cachedSnapshotForDecision, local))
          if (localRegressesCachedHistory) {
            privacyNativeVerificationRequired.add(coin.id as PrivacyCoin)
            privacyDebugLog(coin.id, 'privacy.refresh.localSnapshot.historyRegression', {
              current: summarizeCoinState(coin),
              cached: summarizePrivacySnapshot(cachedSnapshotForDecision),
              snapshot: summarizePrivacySnapshot(local),
              nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
            })
          } else {
            updatePrivacyNativeVerification(coin, local)
          }
          const canUpdateVisibleData = privacySnapshotCanUpdateVisibleData(coin, local) && !localRegressesCachedHistory
          const recoveryWasPending = privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin)
          const recoveryComplete = !localRegressesCachedHistory && privacySnapshotCompletesRecovery(coin, local)
          privacyDebugLog(coin.id, 'privacy.refresh.localSnapshot', {
            current: summarizeCoinState(coin),
            snapshot: summarizePrivacySnapshot(local),
            canUpdateVisibleData,
            localRegressesCachedHistory,
            recoveryWasPending,
            recoveryComplete,
            nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
            requiresNativeVerification: privacyNativeVerificationRequired.has(coin.id as PrivacyCoin),
          })
          if (recoveryComplete) {
            privacyBirthService.markRecoveryComplete(coin.id as PrivacyCoin)
            if (canUpdateVisibleData && privacySnapshotHasSpendReady(coin, local)) {
              privacyMarkDisplayReady(coin.id as PrivacyCoin)
            }
          }

          if (local.address) {
            const addresses = walletService.getWalletAddresses()
            if (addresses[coin.id] !== local.address) {
              if (!stillSameWallet(expectedScope, mnemonic)) return
              storageService.set('wallet-addresses', { ...addresses, [coin.id]: local.address })
            }
          }

          if (canUpdateVisibleData) {
            privacyLastRefreshAt[coin.id as PrivacyCoin] = Date.now()
            await mergePrivacySnapshotTransactions(coin, local.transactions, {
              expectedScope,
              expectedMnemonic: mnemonic,
              primeNotifications: recoveryWasPending,
              tipHeight: local.lastScannedHeight,
            })
          }

          const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
          if (!stillSameWallet(expectedScope, mnemonic)) return
          const network = await coinApiService.tryGetNetwork(coin.id)
          if (!stillSameWallet(expectedScope, mnemonic)) return
          const baseNetworkStatus = network ? networkToStatus(network) : coin.status
          const networkStatus = statusWithPrivacyRuntime(coin, baseNetworkStatus)
          const next = current.map((item) => {
            if (item.id !== coin.id) return item
            const emptySnapshotWouldClearVisibleData = privacySnapshotIsEmptyZero(local) && privacyCoinHasVisibleBalance(item)
            const useLocalVisibleData = canUpdateVisibleData && !emptySnapshotWouldClearVisibleData
            const snapshotBalance = useLocalVisibleData
              ? bestPrivacySnapshotBalance(local, item.satsPerCoin) ?? item.balance
              : item.balance
            const snapshotSpendableBalance = useLocalVisibleData
              ? bestPrivacySnapshotSpendable(local, item.satsPerCoin) ?? item.spendableBalance ?? snapshotBalance
              : item.spendableBalance
            const capped = capPrivacyBalanceByPendingOutgoing(item, snapshotBalance, snapshotSpendableBalance)
            const balance = capped.balance
            const spendableBalance = capped.spendableBalance ?? capped.balance
            const priceUsd = item.priceUsd
            const canBecomeActive = baseNetworkStatus !== 'maintenance'
              && baseNetworkStatus !== 'offline'
              && privacySnapshotAllowsImmediateActive(item, local, canUpdateVisibleData, recoveryComplete)
            const status: Coin['status'] = !canUpdateVisibleData && baseNetworkStatus !== 'maintenance' && baseNetworkStatus !== 'offline'
              ? privacyPendingStatusForSnapshot(item, local)
              : recoveryComplete
                ? (baseNetworkStatus !== 'maintenance' && baseNetworkStatus !== 'offline'
                  ? (canBecomeActive ? 'active' : privacyPendingStatusForSnapshot(item, local))
                  : networkStatus)
                : privacyPendingStatusForSnapshot(item, local)
            const hideDecision = privacyHideBalanceDecision(item, status, { balance, spendableBalance })
            const hideBalance = hideDecision.hide
            const visibleBalance = hideBalance ? '0' : balance
            const visibleSpendable = hideBalance ? '0' : spendableBalance
            const recoveryProgress = item.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(coin.id as PrivacyCoin)
            privacyDebugLog(item.id, 'privacy.refresh.finalDecision', {
              current: summarizeCoinState(item),
              network: {
                baseNetworkStatus,
                networkStatus,
              },
              canUpdateVisibleData,
              useLocalVisibleData,
              emptySnapshotWouldClearVisibleData,
              recoveryComplete,
              canBecomeActive,
              snapshotBalance,
              snapshotSpendableBalance,
              capped,
              hideDecision,
              status,
              visibleBalance,
              visibleSpendable,
              nativeReadiness: privacyWalletService.getNativeReadiness(item.id as PrivacyCoin),
              recoveryPending: privacyBirthService.isRecoveryPending(item.id as PrivacyCoin),
            })
            return {
              ...item,
              address: local.address ?? item.address,
              status,
              recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
              balance: visibleBalance,
              spendableBalance: visibleSpendable,
              fiatValue: typeof priceUsd === 'number' ? priceUsd * (parseFloat(visibleBalance) || 0) : item.fiatValue,
            }
          })
          if (!stillSameWallet(expectedScope, mnemonic)) return
          const saved = await coinService.saveRuntimeCoins(next)
          if (!stillSameWallet(expectedScope, mnemonic)) return
          set({ coins: saved })
        } catch (error) {
          privacyDebugLog(coin.id, 'privacy.refresh.error', {
            current: summarizeCoinState(coin),
            error: error instanceof Error ? error.message : String(error),
            nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
            recoveryPending: privacyBirthService.isRecoveryPending(coin.id as PrivacyCoin),
          })
          // Privacy engines can need extra sync time; keep the last known value.
        }
      }))
    } finally {
      privacyBalanceRefreshInFlight = false
    }
  },

  rescanPrivacyCoin: async (coinId, fromHeight) => {
    const mnemonic = walletService.getSessionMnemonic()
    if (!mnemonic) throw new Error('Session expired, re-open the wallet')
    const normalizedHeight = privacyBirthService.setManualRestoreStartHeight(coinId, fromHeight)
    const expectedScope = walletService.getWalletStorageScope()
    const expectedMnemonic = mnemonic
    privacyLastRefreshAt[coinId] = 0
    privacyCacheWarmStartedAt[coinId] = 0
    privacyNativeVerificationRequired.delete(coinId)
    privacyClearDisplayReady(coinId)
    clearPrivacyRecoveryProgress(coinId)

    const coins = get().coins.length > 0 ? get().coins : await coinService.getCoins()
    const coin = coins.find((item) => item.id === coinId)
    if (!coin || !isPrivacyCoin(coin)) throw new Error('Privacy coin not found')
    set({
      coins: coins.map((item) => item.id === coinId
        ? {
          ...item,
          status: 'syncing',
          recoveryProgress: {
            fromHeight: normalizedHeight,
            currentHeight: normalizedHeight,
            tipHeight: normalizedHeight,
            totalBlocks: 0,
            scannedBlocks: 0,
            blocksRemaining: 0,
            percent: 0,
          },
        }
        : item),
    })

    const snapshot = await privacyWalletService.rescan(coinId, mnemonic, normalizedHeight, (progress) => {
      if (!stillSameWallet(expectedScope, expectedMnemonic)) return
      set({ coins: withRecoveryProgress(get().coins, coinId, progress) })
    })
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return

    const recoveryComplete = privacySnapshotCompletesRecovery(coin, snapshot)
    const canUpdateVisibleData = privacySnapshotCanUpdateVisibleData(coin, snapshot)
    if (recoveryComplete) {
      privacyBirthService.markRecoveryComplete(coinId)
      if (canUpdateVisibleData && privacySnapshotHasSpendReady(coin, snapshot)) privacyMarkDisplayReady(coinId)
    }
    if (canUpdateVisibleData) {
      privacyLastRefreshAt[coinId] = Date.now()
      await mergePrivacySnapshotTransactions(coin, snapshot.transactions, {
        expectedScope,
        expectedMnemonic,
        primeNotifications: false,
        tipHeight: snapshot.lastScannedHeight,
      })
    }
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return

    const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
    const network = await coinApiService.tryGetNetwork(coinId)
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return
    const baseNetworkStatus = network ? networkToStatus(network) : coin.status
    const next = current.map((item) => {
      if (item.id !== coinId) return item
      const localBalance = canUpdateVisibleData
        ? bestPrivacySnapshotBalance(snapshot, item.satsPerCoin) ?? item.balance
        : item.balance
      const localSpendable = canUpdateVisibleData
        ? bestPrivacySnapshotSpendable(snapshot, item.satsPerCoin) ?? item.spendableBalance ?? localBalance
        : item.spendableBalance
      const capped = capPrivacyBalanceByPendingOutgoing(item, localBalance, localSpendable)
      const balance = capped.balance
      const spendableBalance = capped.spendableBalance ?? capped.balance
      const canBecomeActive = baseNetworkStatus !== 'maintenance'
        && baseNetworkStatus !== 'offline'
        && privacySnapshotAllowsImmediateActive(item, snapshot, canUpdateVisibleData, recoveryComplete)
      const status: Coin['status'] = baseNetworkStatus === 'maintenance' || baseNetworkStatus === 'offline'
        ? baseNetworkStatus
        : canUpdateVisibleData && recoveryComplete
          ? (canBecomeActive ? 'active' : privacyPendingStatusForSnapshot(item, snapshot))
          : privacyPendingStatusForSnapshot(item, snapshot)
      const hideDecision = privacyHideBalanceDecision(item, status, { balance, spendableBalance })
      const visibleBalance = hideDecision.hide ? '0' : balance
      const visibleSpendable = hideDecision.hide ? '0' : spendableBalance
      const recoveryProgress = item.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(coinId)
      privacyDebugLog(item.id, 'privacy.manualRescan.finalDecision', {
        current: summarizeCoinState(item),
        fromHeight: normalizedHeight,
        snapshot: summarizePrivacySnapshot(snapshot),
        canUpdateVisibleData,
        recoveryComplete,
        canBecomeActive,
        baseNetworkStatus,
        status,
        visibleBalance,
        visibleSpendable,
        nativeReadiness: privacyWalletService.getNativeReadiness(coinId),
      })
      return {
        ...item,
        address: snapshot.address ?? item.address,
        status,
        recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
        balance: visibleBalance,
        spendableBalance: visibleSpendable,
        fiatValue: typeof item.priceUsd === 'number' ? item.priceUsd * (parseFloat(visibleBalance) || 0) : item.fiatValue,
      }
    })
    const saved = await coinService.saveRuntimeCoins(next)
    if (!stillSameWallet(expectedScope, expectedMnemonic)) return
    set({ coins: saved })
  },

  recordFreshIncomingTransactions: (transactions) => {
    if (transactions.length === 0) return
    const expiresAt = Date.now() + FRESH_INCOMING_BALANCE_GATE_MS
    pruneFreshIncomingBalanceGateTxs()
    for (const tx of transactions) {
      if (tx.type !== 'incoming' || tx.spent) continue
      freshIncomingBalanceGateTxs.set(txKey(tx), { expiresAt, transaction: tx })
    }
  },

  syncPendingOutgoingReservations: (transactions) => {
    const now = Date.now()
    const next = pruneReservedOutgoing(get().reservedOutgoing, new Set<string>(), get().coins)
    for (const tx of transactions) {
      if (tx.type !== 'outgoing' || tx.status === 'failed') continue
      const createdAtMs = Date.parse(tx.createdAt)
      if (tx.status !== 'pending' && Number.isFinite(createdAtMs) && now - createdAtMs >= CONFIRMED_RESERVATION_TTL_MS) continue
      const previous = next[tx.txHash]
      next[tx.txHash] = {
        coinId: tx.coinId,
        amount: tx.amount,
        fee: tx.fee,
        txHash: tx.txHash,
        from: tx.from,
        to: tx.to,
        internal: tx.internal ?? previous?.internal,
        status: tx.status,
        spentOutpoints: tx.spentOutpoints ?? previous?.spentOutpoints,
        balanceBefore: tx.balanceBefore ?? previous?.balanceBefore,
        expectedBalanceAfter: tx.expectedBalanceAfter ?? previous?.expectedBalanceAfter,
        createdAt: previous?.createdAt ?? tx.createdAt,
      }
    }
    writeReservedOutgoing(next)
    set({ reservedOutgoing: next })
  },

  selectCoin: (coinId) => {
    storageService.set(SELECTED_COIN_KEY, coinId)
    set({ selectedCoinId: coinId })
  },

  toggleFavorite: async (id) => {
    const preferenceCoins = await coinService.toggleFavorite(id)
    const coins = mergePreferenceUpdate(get().coins, preferenceCoins)
    set({ coins })
    await coinService.saveRuntimeCoins(coins)
  },

  toggleEnabled: async (id) => {
    const preferenceCoins = await coinService.toggleEnabled(id)
    const coins = mergePreferenceUpdate(get().coins, preferenceCoins)
    set({ coins })
    await coinService.saveRuntimeCoins(coins)
  },

  resetVisibility: async () => {
    const preferenceCoins = await coinService.resetVisibility()
    const coins = mergePreferenceUpdate(get().coins, preferenceCoins)
    set({ coins })
    await coinService.saveRuntimeCoins(coins)
  },

  resetFavorites: async () => {
    const preferenceCoins = await coinService.resetFavorites()
    const coins = mergePreferenceUpdate(get().coins, preferenceCoins)
    set({ coins })
    await coinService.saveRuntimeCoins(coins)
  },

  resetCoinsForCurrentWallet: async () => {
    coinLoadSeq += 1
    privacyLastRefreshAt.zano = 0
    privacyLastRefreshAt.epic = 0
    privacyCacheWarmStartedAt.zano = 0
    privacyCacheWarmStartedAt.epic = 0
    privacyNativeVerificationRequired.clear()
    privacyClearDisplayReady()
    clearPrivacyRecoveryProgress()
    appliedIncomingBalanceDeltas.clear()
    storageService.remove(scopedKey(RESERVED_OUTGOING_KEY))
    coinApiService.invalidateCoinCache()
    const coins = await coinService.resetForCurrentWallet()
    storageService.remove(SELECTED_COIN_KEY)
    set({
      coins,
      loading: false,
      refreshing: false,
      selectedCoinId: null,
      lastActiveAt: {},
      consecutiveFailures: {},
      zeroBalanceReads: {},
      reservedOutgoing: readReservedOutgoing(),
      sendReadyLoadedAt: 0,
    })
  },

  applyTransactionBalanceDelta: async (tx, options = {}) => {
    const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
    const reservedOutgoing = { ...get().reservedOutgoing }
    const existingOutgoingReservation = tx.type === 'outgoing' && tx.status === 'pending'
      ? reservedOutgoing[tx.txHash]
      : undefined
    const txCoin = current.find((coin) => coin.id === tx.coinId)
    if (tx.type === 'incoming' && !options.allowIncomingLedgerDelta) return false
    if (tx.type === 'incoming' && tx.status === 'confirmed' && !options.allowConfirmedIncomingLedgerDelta) return false
    if (
      tx.type === 'incoming'
      && txCoin
      && isAccountCoin(txCoin)
      && !options.incomingExpectedBalance
    ) {
      return false
    }
    if (tx.type === 'incoming') {
      const key = txKey(tx)
      if (appliedIncomingBalanceDeltas.has(key)) return false
      appliedIncomingBalanceDeltas.add(key)
    }
    const internal = tx.internal === true || (
      tx.type === 'outgoing' && txCoin
        ? sameKnownAddress(tx.from, tx.to) || await isWalletAddressVariant(tx.coinId, tx.to, tx.from ?? txCoin.address, txCoin.cryptoParams)
        : false
    )
    if (tx.type === 'outgoing' && tx.status === 'pending') {
      reservedOutgoing[tx.txHash] = {
        ...existingOutgoingReservation,
        coinId: tx.coinId,
        amount: tx.amount,
        fee: tx.fee,
        txHash: tx.txHash,
        from: tx.from,
        to: tx.to,
        internal,
        status: tx.status,
        spentOutpoints: tx.spentOutpoints ?? existingOutgoingReservation?.spentOutpoints,
        createdAt: tx.createdAt,
      }
    }
    let changed = false
    const next = current.map((coin) => {
      if (coin.id !== tx.coinId) return coin
      const decimals = decimalsForSatsPerCoin(coin.satsPerCoin ?? 100_000_000)
      const delta = (tx.type === 'outgoing' && internal ? 0n : toBaseUnits(tx.amount, decimals)) + (tx.type === 'outgoing' ? toBaseUnits(tx.fee ?? '0', decimals) : 0n)
      const currentBalance = toBaseUnits(coin.balance || '0', decimals)
      const suppliedBefore = tx.balanceBefore ? toBaseUnits(tx.balanceBefore, decimals) : null
      const baseline = tx.type === 'outgoing'
        ? suppliedBefore ?? currentBalance
        : currentBalance
      const suppliedExpectedAfter = tx.expectedBalanceAfter && !(tx.type === 'outgoing' && internal)
        ? toBaseUnits(tx.expectedBalanceAfter, decimals)
        : null
      const computedExpectedAfter = baseline - delta
      const expectedAfter = suppliedExpectedAfter ?? computedExpectedAfter
      const incomingExpected = tx.type === 'incoming' && options.incomingExpectedBalance
        ? toBaseUnits(options.incomingExpectedBalance, decimals)
        : null
      const incomingDelta = tx.type === 'incoming' && incomingExpected !== null
        ? (incomingExpected > currentBalance ? incomingExpected - currentBalance : 0n)
        : delta
      if (tx.type === 'incoming' && incomingDelta <= 0n) return coin
      const forceOutgoingExpectedBalance = tx.type === 'outgoing'
        && options.forceOutgoingExpectedBalance === true
        && suppliedBefore !== null
      const currentSpendable = toBaseUnits(coin.spendableBalance ?? coin.balance ?? '0', decimals)
      const outgoingForcedBalance = expectedAfter <= currentBalance
        ? expectedAfter
        : currentBalance - delta
      const outgoingForcedSpendable = expectedAfter <= currentSpendable
        ? expectedAfter
        : currentSpendable - delta
      const signed = tx.type === 'incoming'
        ? currentBalance + incomingDelta
        : forceOutgoingExpectedBalance
        ? outgoingForcedBalance
        : (
          currentBalance === 0n && expectedAfter > 0n && baseline > 0n
            ? expectedAfter
            : (currentBalance <= expectedAfter ? currentBalance : expectedAfter)
        )
      const balance = fromBaseUnits(signed < 0n ? 0n : signed, decimals)
      const signedSpendable = tx.type === 'incoming'
        ? currentSpendable + incomingDelta
        : forceOutgoingExpectedBalance
        ? outgoingForcedSpendable
        : (
          currentSpendable === 0n && expectedAfter > 0n && baseline > 0n
            ? expectedAfter
            : (currentSpendable <= expectedAfter ? currentSpendable : expectedAfter)
        )
      const spendableBalance = (coin.spendableBalance !== undefined || isPrivacyCoin(coin))
        ? fromBaseUnits(signedSpendable < 0n ? 0n : signedSpendable, decimals)
        : coin.spendableBalance
      if (tx.type === 'outgoing' && tx.status === 'pending') {
        reservedOutgoing[tx.txHash] = {
          ...reservedOutgoing[tx.txHash],
          balanceBefore: fromBaseUnits(baseline, decimals),
          expectedBalanceAfter: fromBaseUnits(expectedAfter < 0n ? 0n : expectedAfter, decimals),
        }
      }
      changed = balance !== coin.balance || spendableBalance !== coin.spendableBalance
      const balanceNum = parseFloat(balance) || 0
      return {
        ...coin,
        balance,
        spendableBalance,
        fiatValue: typeof coin.priceUsd === 'number' ? coin.priceUsd * balanceNum : coin.fiatValue,
      }
    })
    if (tx.coinId === 'quai') {
      quaiDebugLog('coins.applyDelta.quai', {
        tx: {
          txHash: tx.txHash,
          type: tx.type,
          amount: tx.amount,
          fee: tx.fee,
          status: tx.status,
          internal: tx.internal,
          balanceBefore: tx.balanceBefore,
          expectedBalanceAfter: tx.expectedBalanceAfter,
        },
        changed,
        beforeQuai: summarizeQuaiCoin(current.find((coin) => coin.id === 'quai')),
        nextQuai: summarizeQuaiCoin(next.find((coin) => coin.id === 'quai')),
        reservation: reservedOutgoing[tx.txHash]
          ? {
              status: reservedOutgoing[tx.txHash].status,
              amount: reservedOutgoing[tx.txHash].amount,
              fee: reservedOutgoing[tx.txHash].fee,
              internal: reservedOutgoing[tx.txHash].internal,
              balanceBefore: reservedOutgoing[tx.txHash].balanceBefore,
              expectedBalanceAfter: reservedOutgoing[tx.txHash].expectedBalanceAfter,
            }
          : null,
      })
    }
    if (tx.type === 'outgoing' && tx.status === 'pending') writeReservedOutgoing(reservedOutgoing)
    if (!changed && tx.type === 'incoming') return false
    const savedCoins = await coinService.saveRuntimeCoins(next)
    set({ coins: savedCoins, reservedOutgoing })
    return changed
  },

  releaseOutgoingReservation: (txHash) => {
    const key = txHash.trim()
    if (!key) return
    const reservedOutgoing = { ...get().reservedOutgoing }
    if (!reservedOutgoing[key]) return
    delete reservedOutgoing[key]
    writeReservedOutgoing(reservedOutgoing)
    set({ reservedOutgoing })
  },

  restoreCoinBalance: async (coinId, balance, spendableBalance) => {
    const current = get().coins.length > 0 ? get().coins : await coinService.getCoins()
    let changed = false
    const next = current.map((coin) => {
      if (coin.id !== coinId) return coin
      const restoredSpendable = spendableBalance ?? coin.spendableBalance ?? balance
      changed = coin.balance !== balance || coin.spendableBalance !== restoredSpendable
      const balanceNum = parseFloat(balance) || 0
      return {
        ...coin,
        balance,
        spendableBalance: restoredSpendable,
        fiatValue: typeof coin.priceUsd === 'number' ? coin.priceUsd * balanceNum : coin.fiatValue,
      }
    })
    if (!changed) return
    const savedCoins = await coinService.saveRuntimeCoins(next)
    set({ coins: savedCoins })
  },
}))

privacyWalletService.onNativeReadinessChange((coinId, readiness) => {
  if (!walletService.getSessionMnemonic()) return

  void (async () => {
    if (readiness === 'ready') {
      privacyNativeVerificationRequired.delete(coinId)
      privacyLastRefreshAt[coinId] = 0
      privacyMarkDisplayReady(coinId)
      clearPrivacyRecoveryProgress(coinId)
    }
    const current = useCoinStore.getState().coins.length > 0
      ? useCoinStore.getState().coins
      : await coinService.getCoins()
    const next = current.map((coin) => {
      if (coin.id !== coinId) return coin
      if (coin.status === 'maintenance' || coin.status === 'offline') return coin
      const nextStatus: Coin['status'] = readiness === 'ready'
        ? 'active'
        : privacyPendingStatus(coin)
      const status: Coin['status'] = privacyRecoveryIsPending(coin)
        ? privacyPendingStatus(coin)
        : nextStatus
      const recoveryProgress = coin.recoveryProgress ?? getRememberedPrivacyRecoveryProgress(coinId)
      const hideDecision = privacyHideBalanceDecision(coin, status)
      const balance = hideDecision.hide ? '0' : coin.balance
      const spendableBalance = hideDecision.hide ? '0' : coin.spendableBalance
      privacyDebugLog(coin.id, 'privacy.readiness.visibleDecision', {
        readiness,
        current: summarizeCoinState(coin),
        status,
        hideDecision,
        balance,
        spendableBalance,
      })
      const balanceNum = parseFloat(balance) || 0
      return {
        ...coin,
        status,
        recoveryProgress: statusKeepsRecoveryProgress(status) ? recoveryProgress : undefined,
        balance,
        spendableBalance,
        fiatValue: typeof coin.priceUsd === 'number' ? coin.priceUsd * balanceNum : coin.fiatValue,
      }
    })
    if (JSON.stringify(next) === JSON.stringify(current)) return
    const saved = await coinService.saveRuntimeCoins(next)
    useCoinStore.setState({ coins: saved })
    if (readiness === 'ready') void useCoinStore.getState().refreshPrivacyBalances()
  })()
})
