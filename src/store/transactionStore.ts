import { create } from 'zustand'
import { coinApiService, mapHistoryResponseToTransactions } from '../services/coinApiService'
import { coinService, cryptoParamsFor } from '../services/coinService'
import { coinTxService } from '../services/coinTxService'
import { privacyCacheService } from '../services/privacyCacheService'
import { privacyWalletService, type PrivacyCoin } from '../services/privacyWalletService'
import { quaiWalletService } from '../services/quaiWalletService'
import { storageService } from '../services/storageService'
import { walletSnapshotService } from '../services/walletSnapshotService'
import { walletService } from '../services/walletService'
import { useCoinStore } from './coinStore'
import type { Coin } from '../types/coin'
import type { SendPayload, Transaction } from '../types/transaction'
import { coinDebugLog, quaiDebugLog, quaiDebugLogError } from '../utils/quaiDebugLog'
import { isWalletAddressVariant } from '../utils/walletAddressOwnership'
import { walletEngineRegistry } from '../wallet-engines/registry'
import { fromBaseUnits, toBaseUnits } from '../utils/decimalAmount'
import { shouldRefreshUtxoBalanceBeforeHistoryCommit } from '../utils/utxoBalanceSyncProfile'

type SendWithMnemonic = SendPayload & { mnemonic: string }

type LoadTransactionsResult = {
  pageLoaded: boolean
  pageKey: string
  pageItemCount: number
  pageCoinItemCounts: Record<string, number>
}

type LoadTransactionsOptions = {
  page?: number
  pageSize?: number
  force?: boolean
  silent?: boolean
  startup?: boolean
  skipBalanceRefresh?: boolean
  utxoOverlay?: boolean
  skipPrivacy?: boolean
  backfill?: boolean
  skipAllHistorySideload?: boolean
  skipIncomingBalanceDelta?: boolean
  deferNotification?: boolean
  onlyCoinIds?: string[]
}

/** Toast notification triggered by transaction events. Consumed by GlobalToast. */
export type TxNotification = {
  /** Unique id so the toast component can deduplicate */
  id: string
  /** What just happened — used by translations to pick the right phrasing */
  kind: 'received' | 'received-confirmed'
  /** Ticker + amount for the user-visible message */
  coinTicker: string
  amount: string
}

type TransactionStore = {
  transactions: Transaction[]
  loading: boolean
  allHistoryLoaded: boolean
  allHistoryLoading: boolean
  loadedPages: Record<string, boolean>
  pageItemCounts: Record<string, number>
  pageCoinItemCounts: Record<string, Record<string, number>>
  pageSize: number
  /** True while a broadcast is in progress — prevents concurrent calls */
  sending: boolean
  /** Last successful broadcast timestamp; used for short cooldown window */
  lastSentAt: number | null
  /** TX hashes we've already shown an incoming notification for */
  notifiedTxHashes: Set<string>
  /** Latest unread tx notification — GlobalToast watches this */
  pendingNotification: TxNotification | null
  historyPrimed: boolean
  loadTransactions: (options?: LoadTransactionsOptions) => Promise<LoadTransactionsResult>
  loadAllTransactions: (options?: { pageSize?: number; force?: boolean; silent?: boolean; expectedMnemonic?: string; expectedScope?: string }) => Promise<void>
  mergePrivacyTransactions: (
    coinId: string,
    rawTransactions: unknown[],
    satsPerCoin: number,
    options?: { silent?: boolean; startup?: boolean; primeNotifications?: boolean; expectedMnemonic?: string; expectedScope?: string; tipHeight?: number; deferNotification?: boolean },
  ) => Promise<void>
  mergeSyntheticTransactions: (
    transactions: Transaction[],
    options?: { silent?: boolean; startup?: boolean; expectedMnemonic?: string; expectedScope?: string },
  ) => Promise<void>
  sendTransaction: (payload: SendWithMnemonic) => Promise<Transaction>
  resetTransactions: () => void
  clearNotification: () => void
}

// Module-level lock — guarantees that even if two callers race the store getter,
// only one broadcast can be in flight at a time across the whole app.
let sendInFlight = false

// Cool-down after a successful send (mempool propagation window).
const SEND_COOLDOWN_MS = 5_000
const TRANSACTIONS_KEY = 'transactions'
const NOTIFIED_TX_KEY = 'notified-incoming-transactions'
const RESERVED_OUTGOING_KEY = 'pending-outgoing-reservations'
const DEFAULT_PAGE_SIZE = 8
const HISTORY_SIDELOAD_PAGE_SIZE = 50
const MAX_HISTORY_SIDELOAD_PAGES = 200
const scopedKey = (key: string) => `${key}:${walletService.getWalletStorageScope()}`
const STARTUP_SIDELOAD_DELAY_MS = 250
const PRIVACY_HISTORY_TIMEOUT_MS = 20_000
const ZANO_PRIVACY_HISTORY_TIMEOUT_MS = 45_000
const PRIVACY_HISTORY_SIDELOAD_TIMEOUT_MS = 10 * 60_000
const LOCAL_PENDING_GRACE_MS = 10 * 60_000
const LONG_LOCAL_PENDING_GRACE_MS = 7 * 24 * 60 * 60_000
const CONFIRMED_RESERVATION_TTL_MS = 90_000
const SPENT_OUTPOINT_LOCK_MS = 24 * 60 * 60_000
const INCOMING_NOTIFICATION_WINDOW_MS = 60 * 60_000
const PRIVACY_CONFIRMED_MIN_CONFIRMATIONS: Record<string, number> = {
  zano: 10,
}
let privacyHistorySideloadInFlight = false
let allHistorySideloadInFlight: Promise<void> | null = null

const decimalsForSatsPerCoin = (satsPerCoin = 100_000_000) => {
  let scale = Math.max(1, Math.trunc(satsPerCoin))
  let decimals = 0
  while (scale > 1 && scale % 10 === 0) {
    decimals += 1
    scale /= 10
  }
  return decimals
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

const readRawStoredTransactions = () =>
  storageService.get<Transaction[]>(scopedKey(TRANSACTIONS_KEY), [])

const saveStoredTransactions = (transactions: Transaction[]) =>
  storageService.set(scopedKey(TRANSACTIONS_KEY), transactions)

const readReservedOutgoing = () => {
  const raw = storageService.get<Record<string, ReservedOutgoing>>(scopedKey(RESERVED_OUTGOING_KEY), {})
  const now = Date.now()
  const pruned = Object.fromEntries(Object.entries(raw).filter(([, reservation]) => {
    if ((reservation.status ?? 'pending') === 'pending') return true
    const createdAtMs = Date.parse(reservation.createdAt)
    return Number.isFinite(createdAtMs) && now - createdAtMs < CONFIRMED_RESERVATION_TTL_MS
  }))
  if (Object.keys(pruned).length !== Object.keys(raw).length) {
    storageService.set(scopedKey(RESERVED_OUTGOING_KEY), pruned)
  }
  return pruned
}

const reservedOutgoingTransactions = () =>
  Object.entries(readReservedOutgoing()).map(([hash, reservation]) => ({
    id: `${reservation.coinId}-${reservation.txHash ?? hash}`,
    coinId: reservation.coinId,
    type: 'outgoing' as const,
    amount: reservation.amount,
    fee: reservation.fee,
    status: reservation.status ?? 'pending' as const,
    txHash: reservation.txHash ?? hash,
    from: reservation.from,
    to: reservation.to,
    internal: reservation.internal,
    spentOutpoints: reservation.spentOutpoints,
    balanceBefore: reservation.balanceBefore,
    expectedBalanceAfter: reservation.expectedBalanceAfter,
    createdAt: reservation.createdAt,
    confirmations: 0,
  }))

const mempoolPendingToTransaction = (
  coinId: string,
  pending: { txid: string; type?: 'incoming' | 'outgoing'; amount: string; fee?: string; from?: string; to?: string; firstSeen?: number },
): Transaction => ({
  id: `${coinId}-${pending.txid}`,
  coinId,
  type: pending.type === 'incoming' ? 'incoming' : 'outgoing',
  amount: pending.amount,
  fee: pending.fee,
  status: 'pending',
  txHash: pending.txid,
  from: pending.from,
  to: pending.to,
  createdAt: new Date((pending.firstSeen ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  confirmations: 0,
})

const privacyAmount = (raw: unknown, satsPerCoin: number) => {
  const tx = raw as { subtransfers?: Array<{ asset_id?: string; amount?: number | string; is_income?: boolean }> }
  const native = tx.subtransfers?.find((item) => item && item.amount !== undefined)
  const amount = Number(native?.amount ?? 0)
  return {
    amount: (amount / satsPerCoin).toFixed(12).replace(/\.?0+$/, '') || '0',
    incoming: native?.is_income === true,
  }
}

const privacyNumeric = (...values: unknown[]) => {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return 0
}

const privacyDateIso = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' || typeof value === 'bigint') {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) continue
      return new Date(number > 9_999_999_999 ? number : number * 1000).toISOString()
    }
    if (typeof value !== 'string' || value.trim() === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric > 9_999_999_999 ? numeric : numeric * 1000).toISOString()
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

const EPIC_SYNTHETIC_TX_HASH = /^epic-\d+$/i

const isEpicSyntheticTxHash = (coinId: string, hash: unknown) =>
  coinId === 'epic' && typeof hash === 'string' && EPIC_SYNTHETIC_TX_HASH.test(hash.trim())

const stableHashPart = (value: string) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

const privacyTxHash = (
  coinId: string,
  rawHash: unknown,
  identityParts: unknown[],
) => {
  const normalized = String(rawHash ?? '').trim()
  if (!normalized) return ''
  if (!isEpicSyntheticTxHash(coinId, normalized)) return normalized
  const identity = identityParts
    .map((part) => String(part ?? '').trim())
    .join('|')
  const height = Number(identityParts[0])
  const heightPart = Number.isFinite(height) && height > 0 ? Math.floor(height) : 'pending'
  return `epic-height-${heightPart}-${stableHashPart(identity)}`
}

const privacyConfirmations = (
  status: Transaction['status'],
  height: number,
  rawConfirmations: unknown,
  tipHeight?: number,
) => {
  if (status !== 'confirmed') return 0
  const tip = Number(tipHeight ?? 0)
  if (height > 0 && Number.isFinite(tip) && tip >= height) return Math.max(1, Math.floor(tip - height + 1))
  const explicit = Number(rawConfirmations)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  return 1
}

const privacyStatusWithMinConfirmations = (
  coinId: string,
  status: Transaction['status'],
  confirmations: number,
): Transaction['status'] => {
  const minConfirmations = PRIVACY_CONFIRMED_MIN_CONFIRMATIONS[coinId]
  if (status !== 'confirmed' || !minConfirmations) return status
  return confirmations >= minConfirmations ? 'confirmed' : 'pending'
}

const privacyTipHeightFrom = (snapshot: { lastScannedHeight?: number; transactions?: unknown[] } | null | undefined) => {
  let best = Number(snapshot?.lastScannedHeight ?? 0)
  for (const raw of snapshot?.transactions ?? []) {
    const tx = raw as { height?: unknown; tipHeight?: unknown; tip_height?: unknown }
    best = Math.max(best, privacyNumeric(tx.tipHeight, tx.tip_height, tx.height))
  }
  return Number.isFinite(best) && best > 0 ? Math.floor(best) : undefined
}

const privacyNetworkTipHeight = async (
  coinId: string,
  snapshot?: { lastScannedHeight?: number; transactions?: unknown[] } | null,
) => {
  const localTip = privacyTipHeightFrom(snapshot)
  const network = await coinApiService.tryGetNetwork(coinId).catch(() => null)
  const networkTip = Math.max(Number(network?.headers ?? 0), Number(network?.blocks ?? 0))
  const tip = Math.max(localTip ?? 0, Number.isFinite(networkTip) ? networkTip : 0)
  return tip > 0 ? Math.floor(tip) : localTip
}

const privacyTransferToTransaction = (
  coinId: string,
  raw: unknown,
  satsPerCoin: number,
  options: { tipHeight?: number } = {},
): Transaction | null => {
  const tx = raw as {
    id?: string
    txid?: string
    tx_hash?: string
    type?: 'incoming' | 'outgoing'
    direction?: 'incoming' | 'outgoing'
    status?: 'pending' | 'confirmed' | 'mempool' | 'cancelled'
    amount?: string | number
    height?: number
    blockHeight?: number
    block_height?: number
    tipHeight?: number
    tip_height?: number
    timestamp?: number
    time?: number
    blocktime?: number
    date?: string
    creation_ts?: string
    creationTs?: string
    confirmation_ts?: string
    confirmationTs?: string
    confirmed_at?: string
    firstSeen?: number
    confirmations?: number
    from?: string
    to?: string
    fee?: number | string
    spent?: boolean
    remote_addresses?: string[]
    subtransfers?: Array<{ amount?: number | string; is_income?: boolean }>
  }
  const normalizedHash = tx?.txid ?? tx?.tx_hash ?? tx?.id
  if (normalizedHash && tx.amount !== undefined && (tx.type || tx.direction)) {
    const direction = tx.direction ?? tx.type
    const baseStatus = tx.status === 'confirmed' ? 'confirmed' : 'pending'
    const height = Math.floor(privacyNumeric(tx.height, tx.blockHeight, tx.block_height))
    const tipHeight = Math.floor(privacyNumeric(options.tipHeight, tx.tipHeight, tx.tip_height))
    const confirmations = privacyConfirmations(baseStatus, height, tx.confirmations, tipHeight)
    const status = privacyStatusWithMinConfirmations(coinId, baseStatus, confirmations)
    const txHash = privacyTxHash(coinId, normalizedHash, [
      height,
      tx.amount,
      direction,
      tx.spent === true ? 'spent' : 'unspent',
      tx.fee ?? '',
      tx.from ?? '',
      tx.to ?? '',
    ])
    const createdAt = privacyDateIso(
      tx.date,
      baseStatus === 'confirmed' ? tx.confirmation_ts : undefined,
      baseStatus === 'confirmed' ? tx.confirmationTs : undefined,
      baseStatus === 'confirmed' ? tx.confirmed_at : undefined,
      tx.blocktime,
      tx.time,
      tx.timestamp,
      tx.creation_ts,
      tx.creationTs,
      tx.firstSeen,
    ) ?? (baseStatus === 'confirmed' ? new Date(0).toISOString() : new Date().toISOString())
    return {
      id: `${coinId}-${txHash}`,
      coinId,
      type: direction === 'incoming' ? 'incoming' : 'outgoing',
      amount: String(tx.amount),
      fee: tx.fee !== undefined && tx.fee !== null ? String(tx.fee) : undefined,
      status,
      txHash,
      from: tx.from,
      to: tx.to,
      spent: tx.spent === true,
      createdAt,
      confirmations,
      blockHeight: height > 0 ? height : undefined,
    }
  }
  if (!tx?.tx_hash) return null
  const native = privacyAmount(raw, satsPerCoin)
  const remote = Array.isArray(tx.remote_addresses) ? tx.remote_addresses[0] : undefined
  const height = Math.floor(privacyNumeric(tx.height, tx.blockHeight, tx.block_height))
  const tipHeight = Math.floor(privacyNumeric(options.tipHeight, tx.tipHeight, tx.tip_height))
  const baseStatus = height > 0 ? 'confirmed' : 'pending'
  const confirmations = privacyConfirmations(baseStatus, height, tx.confirmations, tipHeight)
  const status = privacyStatusWithMinConfirmations(coinId, baseStatus, confirmations)
  const txHash = privacyTxHash(coinId, tx.tx_hash, [
    height,
    native.amount,
    native.incoming ? 'incoming' : 'outgoing',
    tx.spent === true ? 'spent' : 'unspent',
    tx.fee ?? '',
    remote ?? '',
  ])
  const createdAt = privacyDateIso(
    tx.date,
    baseStatus === 'confirmed' ? tx.confirmation_ts : undefined,
    baseStatus === 'confirmed' ? tx.confirmationTs : undefined,
    baseStatus === 'confirmed' ? tx.confirmed_at : undefined,
    tx.blocktime,
    tx.time,
    tx.timestamp,
    tx.creation_ts,
    tx.creationTs,
    tx.firstSeen,
  ) ?? (baseStatus === 'confirmed' ? new Date(0).toISOString() : new Date().toISOString())
  return {
    id: `${coinId}-${txHash}`,
    coinId,
    type: native.incoming ? 'incoming' : 'outgoing',
    amount: native.amount,
    fee: tx.fee !== undefined ? (Number(tx.fee) / satsPerCoin).toFixed(12).replace(/\.?0+$/, '') : undefined,
    status,
    txHash,
    from: native.incoming ? remote : walletService.getWalletAddresses()[coinId],
    to: native.incoming ? walletService.getWalletAddresses()[coinId] : remote,
    spent: tx.spent === true,
    createdAt,
    confirmations,
    blockHeight: height > 0 ? height : undefined,
  }
}

const readNotifiedTxHashes = () =>
  new Set(storageService.get<string[]>(scopedKey(NOTIFIED_TX_KEY), []))

const saveNotifiedTxHashes = (hashes: Set<string>) =>
  storageService.set(scopedKey(NOTIFIED_TX_KEY), Array.from(hashes).slice(-500))

const saveMergedNotifiedTxHashes = (hashes: Set<string>) => {
  const merged = new Set([...readNotifiedTxHashes(), ...hashes])
  saveNotifiedTxHashes(merged)
  return merged
}

const txSignature = (transactions: Transaction[]) =>
  transactions
    .map((tx) => [
      normalizedTxHash(tx.txHash),
      tx.coinId,
      tx.type,
      tx.amount,
      tx.fee ?? '',
      tx.status,
      tx.confirmations ?? 0,
      tx.blockHeight ?? '',
      tx.createdAt,
      tx.spent ? 'spent' : '',
    ].join(':'))
    .sort()
    .join('|')

const normalizedTxHash = (hash: string) => hash.trim().toLowerCase()

const txKey = (tx: Pick<Transaction, 'coinId' | 'txHash'>) => `${tx.coinId}:${normalizedTxHash(tx.txHash)}`
const notificationKeysInFlight = new Set<string>()
const claimFreshIncomingNotifications = (
  candidates: Transaction[],
  seen: Set<string>,
  options: {
    coinById?: Map<string, Coin>
    includePrivacy?: boolean
    now?: number
    wasAlreadyKnown?: (tx: Transaction) => boolean
    allowAlreadyKnownFresh?: boolean
  } = {},
) => {
  const now = options.now ?? Date.now()
  const storedSeen = readNotifiedTxHashes()
  const claimed: Transaction[] = []
  for (const tx of candidates) {
    const key = txKey(tx)
    if (tx.type !== 'incoming' || tx.spent) continue
    if (seen.has(key) || storedSeen.has(key) || notificationKeysInFlight.has(key)) continue
    if (!options.allowAlreadyKnownFresh && options.wasAlreadyKnown?.(tx)) continue
    const coin = options.coinById?.get(tx.coinId)
    if (!options.includePrivacy && walletEngineRegistry.isPrivacy(coin)) continue
    if (!isFreshIncomingNotification(tx, now)) continue
    seen.add(key)
    storedSeen.add(key)
    notificationKeysInFlight.add(key)
    claimed.push(tx)
  }
  return claimed
}
const summarizeTxForDebug = (tx: Transaction) => ({
  txHash: tx.txHash,
  type: tx.type,
  amount: tx.amount,
  fee: tx.fee,
  status: tx.status,
  confirmations: tx.confirmations,
  blockHeight: tx.blockHeight,
  spent: tx.spent === true,
  createdAt: tx.createdAt,
  from: tx.from,
  to: tx.to,
})
const summarizeQuaiTxs = (transactions: Transaction[]) =>
  transactions.filter((tx) => tx.coinId === 'quai').slice(0, 25).map(summarizeTxForDebug)
const summarizePearlTxs = (transactions: Transaction[]) =>
  transactions.filter((tx) => tx.coinId === 'pearl').slice(0, 25).map(summarizeTxForDebug)
const summarizeRaptoreumTxs = (transactions: Transaction[]) =>
  transactions.filter((tx) => tx.coinId === 'raptoreum').slice(0, 25).map(summarizeTxForDebug)
const UTXO_INCOMING_DEBUG_COIN_IDS = new Set(['scash', 'pepecoin', 'neoxa', 'junkcoin'])
const summarizeDebugUtxoTxs = (transactions: Transaction[], coinId: string) =>
  transactions.filter((tx) => tx.coinId === coinId).slice(0, 25).map(summarizeTxForDebug)

const persistPrivacyOutgoingTransactionsToCache = async (
  coinId: string,
  transactions: Transaction[],
  mnemonic?: string,
  reason = 'privacy-outgoing-cache',
  address?: string,
) => {
  if ((coinId !== 'epic' && coinId !== 'zano') || !mnemonic) return
  const outgoing = transactions.filter((tx) => tx.coinId === coinId && tx.type === 'outgoing')
  if (outgoing.length === 0) return
  try {
    await privacyCacheService.mergeLocalTransactions(coinId, mnemonic, outgoing, {
      address: address ?? walletService.getWalletAddresses()[coinId],
    })
    coinDebugLog(coinId, 'tx.privacy.cacheOutgoing.saved', {
      reason,
      count: outgoing.length,
      outgoing: outgoing.slice(0, 20).map(summarizeTxForDebug),
    })
  } catch (error) {
    coinDebugLog(coinId, 'tx.privacy.cacheOutgoing.error', {
      reason,
      count: outgoing.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const txTimeMs = (tx: Pick<Transaction, 'createdAt'>) => {
  const value = Date.parse(tx.createdAt)
  return Number.isFinite(value) ? value : 0
}

const txStatusRank = (status: Transaction['status']) =>
  status === 'pending' ? 0 : status === 'confirmed' ? 1 : 2

const confirmedBlockHeight = (tx: Transaction) =>
  tx.status === 'confirmed' && Number.isFinite(Number(tx.blockHeight)) ? Number(tx.blockHeight) : null

const privacySyntheticMatchKey = (tx: Transaction) => {
  if (tx.coinId !== 'epic') return null
  const height = confirmedBlockHeight(tx)
  if (height === null) return null
  return [
    tx.coinId,
    height,
    tx.type,
    tx.amount,
    tx.fee ?? '',
    tx.spent ? 'spent' : 'unspent',
  ].join(':')
}

const compareTransactions = (a: Transaction, b: Transaction) => {
  const timeDiff = txTimeMs(b) - txTimeMs(a)
  const aHeight = confirmedBlockHeight(a)
  const bHeight = confirmedBlockHeight(b)
  if (a.coinId === b.coinId && Math.abs(timeDiff) <= 2_000 && aHeight !== null && bHeight !== null && aHeight !== bHeight) {
    return bHeight - aHeight
  }
  if (timeDiff !== 0) return timeDiff
  if (aHeight !== null && bHeight !== null && aHeight !== bHeight) return bHeight - aHeight
  const statusDiff = txStatusRank(a.status) - txStatusRank(b.status)
  if (statusDiff !== 0) return statusDiff
  const coinDiff = a.coinId.localeCompare(b.coinId)
  if (coinDiff !== 0) return coinDiff
  const hashDiff = normalizedTxHash(b.txHash).localeCompare(normalizedTxHash(a.txHash))
  if (hashDiff !== 0) return hashDiff
  return a.id.localeCompare(b.id)
}

const sortTransactions = (transactions: Transaction[]) =>
  [...transactions].sort(compareTransactions)

const historyHasRows = (history: import('../services/coinApiService').HistoryResponse | null | undefined) =>
  Boolean(history && (
    (history.txids?.length ?? 0) > 0
    || (history.deltas?.length ?? 0) > 0
    || (history.mempool?.length ?? 0) > 0
    || (history.transactions?.length ?? 0) > 0
  ))

const isFreshIncomingNotification = (tx: Transaction, now = Date.now()) => {
  const createdAtMs = Date.parse(tx.createdAt)
  return Number.isFinite(createdAtMs)
    && createdAtMs <= now + 60_000
    && now - createdAtMs <= INCOMING_NOTIFICATION_WINDOW_MS
}

const isDroppedLocalPending = (tx: Transaction, coin: Awaited<ReturnType<typeof coinService.getCoins>>[number] | undefined, now = Date.now()) => {
  if (tx.type !== 'outgoing' || tx.status !== 'pending') return false
  const createdAtMs = Date.parse(tx.createdAt)
  if (!Number.isFinite(createdAtMs)) return true
  const graceMs = walletEngineRegistry.isAccount(coin) || walletEngineRegistry.isPrivacy(coin)
    ? LONG_LOCAL_PENDING_GRACE_MS
    : LOCAL_PENDING_GRACE_MS
  return now - createdAtMs >= graceMs
}

const pendingOutgoingBlocksSend = (
  tx: Transaction,
  coin: Awaited<ReturnType<typeof coinService.getCoins>>[number] | undefined,
  now = Date.now(),
) => {
  if (tx.type !== 'outgoing' || tx.status !== 'pending') return false
  if (walletEngineRegistry.isPrivacy(coin) && !tx.balanceBefore && !tx.expectedBalanceAfter) return false
  const createdAtMs = Date.parse(tx.createdAt)
  if (!Number.isFinite(createdAtMs)) return true
  const graceMs = walletEngineRegistry.isAccount(coin) || walletEngineRegistry.isPrivacy(coin)
    ? LONG_LOCAL_PENDING_GRACE_MS
    : LOCAL_PENDING_GRACE_MS
  return now - createdAtMs < graceMs
}

const isStaleUnverifiedConfirmedUtxo = (
  tx: Transaction,
  coin: Awaited<ReturnType<typeof coinService.getCoins>>[number] | undefined,
) =>
  walletEngineRegistry.isUtxo(coin)
  && tx.status === 'confirmed'
  && !Number.isFinite(Number(tx.blockHeight))
  && Number(tx.confirmations ?? 0) <= 1

const markDroppedLocalPending = (tx: Transaction): Transaction => ({
  ...tx,
  status: 'failed',
  confirmations: 0,
})

const activeSpentOutpointsForCoin = (coinId: string, transactions: Transaction[]) => {
  const now = Date.now()
  const byOutpoint = new Map<string, { txid: string; vout: number }>()
  for (const tx of transactions) {
    if (tx.coinId !== coinId || tx.type !== 'outgoing' || tx.status === 'failed') continue
    const createdAtMs = Date.parse(tx.createdAt)
    if (Number.isFinite(createdAtMs) && now - createdAtMs >= SPENT_OUTPOINT_LOCK_MS) continue
    if (tx.status !== 'pending' && Number.isFinite(createdAtMs) && now - createdAtMs >= SPENT_OUTPOINT_LOCK_MS) continue
    for (const outpoint of tx.spentOutpoints ?? []) {
      if (!outpoint.txid || !Number.isInteger(outpoint.vout) || outpoint.vout < 0) continue
      byOutpoint.set(`${outpoint.txid}:${outpoint.vout}`, { txid: outpoint.txid, vout: outpoint.vout })
    }
  }
  return Array.from(byOutpoint.values())
}

const normalizeStoredTransaction = (tx: Transaction): Transaction => {
  if (!isEpicSyntheticTxHash(tx.coinId, tx.txHash)) return tx
  const txHash = privacyTxHash(tx.coinId, tx.txHash, [
    tx.blockHeight ?? '',
    tx.amount,
    tx.type,
    tx.spent ? 'spent' : 'unspent',
    tx.fee ?? '',
    tx.from ?? '',
    tx.to ?? '',
  ])
  return {
    ...tx,
    id: `${tx.coinId}-${txHash}`,
    txHash,
  }
}

const dedupeTransactions = (transactions: Transaction[]) => {
  const byKey = new Map<string, Transaction>()
  for (const tx of transactions) {
    const key = txKey(tx)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, tx)
      continue
    }
    const mergedMetadata = {
      balanceBefore: tx.balanceBefore ?? prev.balanceBefore,
      expectedBalanceAfter: tx.expectedBalanceAfter ?? prev.expectedBalanceAfter,
      spentOutpoints: tx.spentOutpoints ?? prev.spentOutpoints,
    }
    if (prev.status === 'pending' && tx.status === 'confirmed') {
      byKey.set(key, { ...tx, ...mergedMetadata })
    } else {
      byKey.set(key, { ...prev, ...mergedMetadata })
    }
  }
  return sortTransactions(Array.from(byKey.values()))
}

const readStoredTransactions = () =>
  dedupeTransactions([
    ...readRawStoredTransactions().map(normalizeStoredTransaction),
    ...reservedOutgoingTransactions().map(normalizeStoredTransaction),
  ])

const stillSameWallet = (expectedScope?: string, expectedMnemonic?: string) =>
  (!expectedScope || walletService.getWalletStorageScope() === expectedScope)
  && (!expectedMnemonic || walletService.getSessionMnemonic() === expectedMnemonic)

const getPrivacyHistorySnapshot = async (coin: Coin, mnemonic: string, timeoutMs: number) => {
  if ((coin.id === 'zano' || coin.id === 'epic') && privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) !== 'ready') {
    const cached = await privacyWalletService.getCachedSnapshot(coin.id as PrivacyCoin, mnemonic).catch(() => null)
    if (coin.id === 'zano') {
      const live = await withTimeout(
        privacyWalletService.getSnapshot('zano', mnemonic),
        Math.max(timeoutMs, ZANO_PRIVACY_HISTORY_TIMEOUT_MS),
      ).catch(() => null)
      if (live?.ok && live.transactions?.length) return live
      if (cached?.transactions?.length) {
        coinDebugLog(coin.id, 'privacy.history.cachedSnapshot.fallback', {
          txCount: cached.transactions.length,
          balance: cached.balance,
          spendable: cached.spendable,
          nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
        })
        return cached
      }
      if (live?.ok) return live
    } else if (cached?.transactions?.length) {
      coinDebugLog(coin.id, 'privacy.history.cachedSnapshot', {
        txCount: cached.transactions.length,
        balance: cached.balance,
        spendable: cached.spendable,
        nativeReadiness: privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin),
      })
      return cached
    }
  }
  return withTimeout(
    privacyWalletService.getSnapshot(coin.id as PrivacyCoin, mnemonic),
    timeoutMs,
  )
}

const sideloadPrivacyHistory = async (
  coins: Awaited<ReturnType<typeof coinService.getCoins>>,
  mnemonic: string,
  options: { silent?: boolean; startup?: boolean; expectedScope?: string } = {},
) => {
  if (privacyHistorySideloadInFlight) return
  const privacyCoins = coins.filter((coin) => coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light')
  if (privacyCoins.length === 0) return
  const expectedScope = options.expectedScope ?? walletService.getWalletStorageScope()

  privacyHistorySideloadInFlight = true
  try {
    await Promise.all(privacyCoins.map(async (coin) => {
      try {
        const snapshot = await getPrivacyHistorySnapshot(coin, mnemonic, PRIVACY_HISTORY_SIDELOAD_TIMEOUT_MS)
        if (!snapshot.ok || !snapshot.transactions?.length) return
        if (!stillSameWallet(expectedScope, mnemonic)) return
        const tipHeight = await privacyNetworkTipHeight(coin.id, snapshot)
        await useTransactionStore.getState().mergePrivacyTransactions(
          coin.id,
          snapshot.transactions,
          coin.satsPerCoin ?? 100_000_000,
          { ...options, tipHeight, expectedMnemonic: mnemonic, expectedScope },
        )
      } catch {
        // Zano/Epic recovery can legitimately take longer than normal paged history.
      }
    }))
  } finally {
    privacyHistorySideloadInFlight = false
  }
}

export const useTransactionStore = create<TransactionStore>((set, get) => ({
  transactions: readStoredTransactions(),
  loading: false,
  allHistoryLoaded: false,
  allHistoryLoading: false,
  loadedPages: {},
  pageItemCounts: {},
  pageCoinItemCounts: {},
  pageSize: DEFAULT_PAGE_SIZE,
  sending: false,
  lastSentAt: null,
  notifiedTxHashes: readNotifiedTxHashes(),
  pendingNotification: null,
  historyPrimed: readStoredTransactions().length > 0 || readNotifiedTxHashes().size > 0,

  loadTransactions: async (options = {}) => {
    const expectedScope = walletService.getWalletStorageScope()
    const expectedMnemonic = walletService.getSessionMnemonic() ?? undefined
    const page = Math.max(1, Math.floor(options.page ?? 1))
    const pageSize = Math.max(1, Math.min(Math.floor(options.pageSize ?? get().pageSize ?? DEFAULT_PAGE_SIZE), 50))
    const historyOffset = (page - 1) * pageSize
    const pageKey = `${pageSize}:${page}`
    const onlyCoinIds = Array.from(new Set((options.onlyCoinIds ?? []).filter(Boolean)))
    const onlyCoinIdSet = onlyCoinIds.length > 0 ? new Set(onlyCoinIds) : null
    const targetedHistoryRefresh = onlyCoinIdSet !== null
    const isBackfill = options.backfill === true
    if (!options.force && !targetedHistoryRefresh && get().loadedPages[pageKey]) {
      const state = get()
      return {
        pageLoaded: true,
        pageKey,
        pageItemCount: state.pageItemCounts[pageKey] ?? 0,
        pageCoinItemCounts: state.pageCoinItemCounts[pageKey] ?? {},
      }
    }
    const showLoading = options.silent !== true

    const prevState = get()
    const prevTransactions = prevState.transactions.length > 0 ? prevState.transactions : readStoredTransactions()
    quaiDebugLog('tx.load.start', {
      page,
      pageSize,
      historyOffset,
      force: options.force === true,
      silent: options.silent === true,
      startup: options.startup === true,
      skipBalanceRefresh: options.skipBalanceRefresh === true,
      skipIncomingBalanceDelta: options.skipIncomingBalanceDelta === true,
      backfill: options.backfill === true,
      onlyCoinIds,
      previousQuai: summarizeQuaiTxs(prevTransactions),
      previousRaptoreum: summarizeRaptoreumTxs(prevTransactions),
    })
    if (showLoading) set({ loading: true })

    const coins = await coinService.getCoins()
    const historyCoins = onlyCoinIdSet
      ? coins.filter((coin) => onlyCoinIdSet.has(coin.id))
      : coins
    const coinById = new Map(coins.map((coin) => [coin.id, coin]))
    let remote: Transaction[]
    let remoteLoaded = false
    const historyVerifiedCoins = new Set<string>()
    try {
      const { items, snapshot } = await walletSnapshotService.fetchHistory(historyCoins, pageSize, historyOffset, {
        utxoOverlay: options.utxoOverlay !== false,
      })
      const quaiItem = items.find((item) => item.coin === 'quai')
      const quaiSnapshot = snapshot.coins.quai
      const pearlItem = items.find((item) => item.coin === 'pearl')
      const pearlSnapshot = snapshot.coins.pearl
      const raptoreumItem = items.find((item) => item.coin === 'raptoreum')
      const raptoreumSnapshot = snapshot.coins.raptoreum
      quaiDebugLog('tx.history.snapshot', {
        page,
        itemAddresses: quaiItem?.addresses,
        historyAddresses: Object.keys(quaiSnapshot?.histories ?? {}),
        histories: Object.fromEntries(Object.entries(quaiSnapshot?.histories ?? {}).map(([address, history]) => [
          address,
          history
            ? {
                txids: history.txids?.slice(0, 8),
                deltaCount: history.deltas?.length ?? 0,
                firstDeltas: history.deltas?.slice(0, 8),
                mempoolCount: history.mempool?.length ?? 0,
                txCount: history.transactions?.length ?? 0,
              }
            : null,
        ])),
        errors: quaiSnapshot?.errors,
      })
      if (pearlItem || pearlSnapshot) {
        coinDebugLog('pearl', 'tx.history.snapshot', {
          page,
          itemAddresses: pearlItem?.addresses,
          historyAddresses: Object.keys(pearlSnapshot?.histories ?? {}),
          histories: Object.fromEntries(Object.entries(pearlSnapshot?.histories ?? {}).map(([address, history]) => [
            address,
            history
              ? {
                  txids: history.txids?.slice(0, 8),
                  deltaCount: history.deltas?.length ?? 0,
                  firstDeltas: history.deltas?.slice(0, 8),
                  mempoolCount: history.mempool?.length ?? 0,
                  txCount: history.transactions?.length ?? 0,
                }
              : null,
          ])),
          errors: pearlSnapshot?.errors,
        })
      }
      if (raptoreumItem || raptoreumSnapshot) {
        coinDebugLog('raptoreum', 'tx.history.snapshot', {
          page,
          itemAddresses: raptoreumItem?.addresses,
          historyAddresses: Object.keys(raptoreumSnapshot?.histories ?? {}),
          histories: Object.fromEntries(Object.entries(raptoreumSnapshot?.histories ?? {}).map(([address, history]) => [
            address,
            history
              ? {
                  txids: history.txids?.slice(0, 8),
                  deltaCount: history.deltas?.length ?? 0,
                  firstDeltas: history.deltas?.slice(0, 8),
                  mempoolCount: history.mempool?.length ?? 0,
                  txCount: history.transactions?.length ?? 0,
                }
              : null,
          ])),
          errors: raptoreumSnapshot?.errors,
        })
      }
      if (!stillSameWallet(expectedScope, expectedMnemonic)) {
        if (showLoading) set({ loading: false })
        return { pageLoaded: false, pageKey, pageItemCount: 0, pageCoinItemCounts: {} }
      }
      remote = items.flatMap((item) => {
        const coin = coinById.get(item.coin)
        const coinSnapshot = snapshot.coins[item.coin]
        if (!coin || !coinSnapshot) return []
        const historyAddresses = Object.keys(coinSnapshot.histories ?? {})
        const addresses = Array.from(new Set([
          ...(item.addresses.length > 0 ? item.addresses : []),
          ...historyAddresses,
        ]))
        if (
          page === 1
          && addresses.length > 0
          && historyAddresses.length > 0
          && historyAddresses.every((address) => Boolean(coinSnapshot.histories?.[address]))
          && addresses.some((address) => historyHasRows(coinSnapshot.histories?.[address]))
        ) {
          historyVerifiedCoins.add(item.coin)
        }
        return historyAddresses.flatMap((address) => {
          const history = coinSnapshot.histories?.[address]
          if (!history) return []
          return mapHistoryResponseToTransactions(history, coin.id, address, coin.satsPerCoin ?? 100_000_000, addresses)
        })
      })
      if (page === 1) {
        const privacyMnemonic = walletService.getSessionMnemonic()
        if (privacyMnemonic && options.skipPrivacy !== true) {
          void sideloadPrivacyHistory(historyCoins, privacyMnemonic, {
            silent: options.silent === true || options.startup === true,
            startup: options.startup === true,
            expectedScope,
          })
        }
        if (privacyMnemonic && !options.startup && options.silent !== true && options.skipPrivacy !== true) {
          const privacyResults = await Promise.all(
            historyCoins
              .filter((coin) => coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light')
              .map(async (coin) => {
                try {
                  const snapshot = await getPrivacyHistorySnapshot(coin, privacyMnemonic, PRIVACY_HISTORY_TIMEOUT_MS)
                  const satsPerCoin = coin.satsPerCoin ?? 100_000_000
                  const tipHeight = await privacyNetworkTipHeight(coin.id, snapshot)
                  return (snapshot.transactions ?? [])
                    .map((tx) => privacyTransferToTransaction(coin.id, tx, satsPerCoin, { tipHeight }))
                    .filter((tx): tx is Transaction => Boolean(tx))
                } catch {
                  return [] as Transaction[]
                }
              }),
          )
          if (stillSameWallet(expectedScope, privacyMnemonic)) {
            remote.push(...privacyResults.flat())
          }
        }
        if (!options.startup) {
          const mempoolResults = await Promise.all(
            items.flatMap((item) => {
              const coin = coinById.get(item.coin)
              if (!coin || !walletEngineRegistry.isUtxo(coin)) return []
              return item.addresses.map((address) =>
                coinApiService.getAddressMempool(coin.id, address)
                  .then((mempool) => mempool.pending.map((tx) => mempoolPendingToTransaction(coin.id, tx)))
                  .catch(() => [] as Transaction[]),
              )
            }),
          )
          remote.push(...mempoolResults.flat())
        }
      }
      remoteLoaded = true
    } catch (error) {
      quaiDebugLogError('tx.history.error', error, { page, pageSize, historyOffset })
      remote = []
    }
    if (!stillSameWallet(expectedScope, expectedMnemonic)) {
      if (showLoading) set({ loading: false })
      return { pageLoaded: false, pageKey, pageItemCount: 0, pageCoinItemCounts: {} }
    }

    const remotePageTransactions = remoteLoaded ? dedupeTransactions(remote) : []
    const remoteQuaiTransactions = summarizeQuaiTxs(remotePageTransactions)
    quaiDebugLog('tx.history.mapped', {
      page,
      remoteLoaded,
      remoteQuaiCount: remoteQuaiTransactions.length,
      remoteQuai: remoteQuaiTransactions,
    })
    if (remotePageTransactions.some((tx) => tx.coinId === 'pearl') || onlyCoinIdSet?.has('pearl')) {
      const remotePearlTransactions = summarizePearlTxs(remotePageTransactions)
      coinDebugLog('pearl', 'tx.history.mapped', {
        page,
        remoteLoaded,
        remotePearlCount: remotePearlTransactions.length,
        remotePearl: remotePearlTransactions,
      })
    }
    if (remotePageTransactions.some((tx) => tx.coinId === 'raptoreum') || onlyCoinIdSet?.has('raptoreum')) {
      const remoteRaptoreumTransactions = summarizeRaptoreumTxs(remotePageTransactions)
      coinDebugLog('raptoreum', 'tx.history.mapped', {
        page,
        remoteLoaded,
        remoteRaptoreumCount: remoteRaptoreumTransactions.length,
        remoteRaptoreum: remoteRaptoreumTransactions,
      })
    }
    for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
      if (!remotePageTransactions.some((tx) => tx.coinId === coinId) && !onlyCoinIdSet?.has(coinId)) continue
      const remoteCoinTransactions = summarizeDebugUtxoTxs(remotePageTransactions, coinId)
      coinDebugLog(coinId, 'tx.history.mapped', {
        page,
        remoteLoaded,
        remoteCoinCount: remoteCoinTransactions.length,
        remoteCoin: remoteCoinTransactions,
      })
    }
    const remotePageItemCount = remotePageTransactions.length
    const remoteOldestTimeByCoin = new Map<string, number>()
    for (const tx of remotePageTransactions) {
      const createdAtMs = Date.parse(tx.createdAt)
      if (!Number.isFinite(createdAtMs)) continue
      const previous = remoteOldestTimeByCoin.get(tx.coinId)
      if (previous === undefined || createdAtMs < previous) remoteOldestTimeByCoin.set(tx.coinId, createdAtMs)
    }
    const remotePageCoinItemCounts = remotePageTransactions.reduce<Record<string, number>>((counts, tx) => {
      counts[tx.coinId] = (counts[tx.coinId] ?? 0) + 1
      return counts
    }, {})

    // Index previous transactions by hash so we can:
    //   1. Preserve our own outgoing tx data (type/amount/to/fee) the wallet
    //      recorded at send-time. The server-side history may report only
    //      the change output until its indexer resolves the spent inputs,
    //      which would otherwise flip our send to a "+change" incoming entry.
    //   2. Keep the original `createdAt` only while both sides are pending.
    //      Once the chain reports a block time, ordering should use that
    //      canonical timestamp.
    const prevByHash = new Map(prevTransactions.map((tx) => [txKey(tx), tx]))

    const reconcileRemoteTx = (tx: Transaction, prev: Transaction | undefined) => {
      if (!prev) return tx
      // We trust our own outgoing record over a remote that disagrees —
      // the wallet is the only place that knows what the user typed in.
      const trustLocalOutgoing = prev.type === 'outgoing'
      return {
        ...tx,
        type: trustLocalOutgoing ? 'outgoing' : tx.type,
        amount: trustLocalOutgoing ? prev.amount : tx.amount,
        to: trustLocalOutgoing ? prev.to ?? tx.to : tx.to,
        from: trustLocalOutgoing ? prev.from ?? tx.from : tx.from,
        internal: prev.internal ?? tx.internal,
        fee: trustLocalOutgoing ? prev.fee ?? tx.fee : tx.fee ?? prev.fee,
        spentOutpoints: prev.spentOutpoints ?? tx.spentOutpoints,
        balanceBefore: prev.balanceBefore ?? tx.balanceBefore,
        expectedBalanceAfter: prev.expectedBalanceAfter ?? tx.expectedBalanceAfter,
        // Keep the FIRST time we ever saw this tx. Adopting the block time on
        // confirmation yanked freshly-received rows down the list (the
        // "jumping"/transient-duplicate effect); the first-seen time keeps them
        // anchored where the user first saw them.
        createdAt: prev.createdAt ?? tx.createdAt,
        blockHeight: tx.blockHeight ?? prev.blockHeight,
      } as Transaction
    }

    // Local-only pending sends that haven't propagated to the chain yet.
    // If a pending send is no longer reported by the chain/mempool after the
    // grace window, treat it as dropped instead of keeping a fake pending row
    // and locking the coin forever.
    const remoteHashes = new Set(remote.map((tx) => txKey(tx)))
    const canPruneDroppedPending = remoteLoaded && page === 1 && !options.startup
    const now = Date.now()
    const shouldPruneStaleRemoteHistory = (tx: Transaction) => {
      if (!remoteLoaded || page !== 1 || options.startup) return false
      if (remoteHashes.has(txKey(tx))) return false
      if (!historyVerifiedCoins.has(tx.coinId)) return false
      if (tx.type === 'outgoing') return false
      if (isFreshIncomingNotification(tx, now)) return false
      const oldestRemote = remoteOldestTimeByCoin.get(tx.coinId)
      if (oldestRemote === undefined) return true
      const createdAtMs = Date.parse(tx.createdAt)
      return Number.isFinite(createdAtMs) && createdAtMs >= oldestRemote
    }
    const mergeRemoteHistory = (baseTransactions: Transaction[]) => {
      const baseByHash = new Map(baseTransactions.map((tx) => [txKey(tx), tx]))
      const reconciled = remote.map((tx) =>
        reconcileRemoteTx(tx, baseByHash.get(txKey(tx)) ?? prevByHash.get(txKey(tx))),
      )
      const localOnly = baseTransactions.flatMap((tx) => {
        if (remoteHashes.has(txKey(tx))) return []
        if (shouldPruneStaleRemoteHistory(tx)) return []
        if (canPruneDroppedPending && isStaleUnverifiedConfirmedUtxo(tx, coinById.get(tx.coinId))) return []
        if (!canPruneDroppedPending || tx.type !== 'outgoing' || tx.status !== 'pending') return [tx]
        if (!isDroppedLocalPending(tx, coinById.get(tx.coinId), now)) return [tx]
        return [markDroppedLocalPending(tx)]
      })
      return dedupeTransactions([...localOnly, ...reconciled])
    }

    const latestForMerge = get().transactions.length > 0 ? get().transactions : prevTransactions
    const merged = mergeRemoteHistory(latestForMerge)

    // Detect freshly-arrived incoming transactions and fire a notification for
    // the newest one. We use a per-session "seen" set so we only notify once
    // per tx hash. A successful startup/silent page-1 history read primes the
    // session even when the wallet has zero rows; otherwise the first real
    // incoming tx into an empty wallet would be misclassified as startup data.
    const seen = new Set([...readNotifiedTxHashes(), ...get().notifiedTxHashes])
    const historyAlreadyPrimed = prevState.historyPrimed || prevTransactions.length > 0 || seen.size > 0
    const firstRun = !historyAlreadyPrimed && (options.startup === true || options.silent === true)
    let toast: TxNotification | null = null
    if (firstRun || options.startup || page !== 1 || isBackfill) {
      for (const tx of merged) if (tx.type === 'incoming') seen.add(txKey(tx))
    } else if (options.silent) {
      // Silent refreshes keep the UI current but do not consume or show
      // incoming notifications; the foreground poll will handle fresh txs.
    } else {
      const notifyNow = Date.now()
      const newIncoming = claimFreshIncomingNotifications(merged, seen, { coinById, now: notifyNow })
      if (newIncoming.length > 0) {
        set({ notifiedTxHashes: seen })
        saveMergedNotifiedTxHashes(seen)
      }
      if (newIncoming.length > 0) {
        const tx = newIncoming[0]
        const coin = coins.find((c) => c.id === tx.coinId)
        toast = {
          id: `${tx.txHash}-${tx.status}`,
          kind: tx.status === 'confirmed' ? 'received-confirmed' : 'received',
          coinTicker: coin?.ticker ?? tx.coinId,
          amount: tx.amount,
        }
      }
    }
    const incomingDeltaNow = Date.now()
    const canApplyIncomingBalanceDelta = !firstRun && !options.startup && page === 1 && !options.skipIncomingBalanceDelta
    const newIncomingBalanceDeltaTransactions = !canApplyIncomingBalanceDelta
      ? []
      : merged.filter((tx) =>
        tx.type === 'incoming'
        && !tx.spent
        && !prevByHash.has(txKey(tx))
        && (!isBackfill || isFreshIncomingNotification(tx, incomingDeltaNow))
        && (
          walletEngineRegistry.isUtxo(coinById.get(tx.coinId))
          || walletEngineRegistry.isAccount(coinById.get(tx.coinId))
          || walletEngineRegistry.isPrivacy(coinById.get(tx.coinId))
        )
      )
    quaiDebugLog('tx.incomingDelta.detected', {
      canApplyIncomingBalanceDelta,
      mergedQuai: summarizeQuaiTxs(merged),
      newIncomingQuai: summarizeQuaiTxs(newIncomingBalanceDeltaTransactions),
    })
    if (merged.some((tx) => tx.coinId === 'pearl') || newIncomingBalanceDeltaTransactions.some((tx) => tx.coinId === 'pearl')) {
      coinDebugLog('pearl', 'tx.incomingDelta.detected', {
        canApplyIncomingBalanceDelta,
        mergedPearl: summarizePearlTxs(merged),
        newIncomingPearl: summarizePearlTxs(newIncomingBalanceDeltaTransactions),
      })
    }
    if (merged.some((tx) => tx.coinId === 'raptoreum') || newIncomingBalanceDeltaTransactions.some((tx) => tx.coinId === 'raptoreum')) {
      coinDebugLog('raptoreum', 'tx.incomingDelta.detected', {
        canApplyIncomingBalanceDelta,
        mergedRaptoreum: summarizeRaptoreumTxs(merged),
        newIncomingRaptoreum: summarizeRaptoreumTxs(newIncomingBalanceDeltaTransactions),
      })
    }
    for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
      if (!merged.some((tx) => tx.coinId === coinId) && !newIncomingBalanceDeltaTransactions.some((tx) => tx.coinId === coinId)) continue
      coinDebugLog(coinId, 'tx.incomingDelta.detected', {
        canApplyIncomingBalanceDelta,
        mergedCoin: summarizeDebugUtxoTxs(merged, coinId),
        newIncomingCoin: summarizeDebugUtxoTxs(newIncomingBalanceDeltaTransactions, coinId),
      })
    }
    const hasNewIncomingLocalLedgerTransactions = newIncomingBalanceDeltaTransactions.some((tx) => {
      const coin = coinById.get(tx.coinId)
      return walletEngineRegistry.isAccount(coin) || walletEngineRegistry.isPrivacy(coin)
    })
    const hasNewIncomingBalanceTransactions = newIncomingBalanceDeltaTransactions.some((tx) => {
      const coin = coinById.get(tx.coinId)
      return walletEngineRegistry.isUtxo(coin) || walletEngineRegistry.isAccount(coin)
    })
    const balancesNeedRefresh =
      prevState.transactions.length > 0 && txSignature(prevState.transactions) !== txSignature(merged)
    const shouldRefreshBalancesAfterHistory =
      !isBackfill && (hasNewIncomingBalanceTransactions || (balancesNeedRefresh && !hasNewIncomingLocalLedgerTransactions))
    const pageTrackingBase = {
      loadedPages: get().loadedPages,
      pageItemCounts: get().pageItemCounts,
      pageCoinItemCounts: get().pageCoinItemCounts,
    }
    const incomingImmediateBalanceDeltaTransactions = newIncomingBalanceDeltaTransactions.filter((tx) => {
      const coin = coinById.get(tx.coinId)
      return walletEngineRegistry.isUtxo(coin) || walletEngineRegistry.isAccount(coin)
    },
    )
    if (incomingImmediateBalanceDeltaTransactions.length > 0) {
      useCoinStore.getState().recordFreshIncomingTransactions(incomingImmediateBalanceDeltaTransactions)
    }
    const hasOnlyUtxoIncomingImmediateBalanceDelta = incomingImmediateBalanceDeltaTransactions.length > 0
      && incomingImmediateBalanceDeltaTransactions.every((tx) =>
        shouldRefreshUtxoBalanceBeforeHistoryCommit(coinById.get(tx.coinId)),
      )

    const shouldRefreshBalancesBeforeHistoryCommit =
      !options.skipBalanceRefresh && shouldRefreshBalancesAfterHistory && hasOnlyUtxoIncomingImmediateBalanceDelta
    if (shouldRefreshBalancesBeforeHistoryCommit) {
      useCoinStore.getState().recordFreshIncomingTransactions(newIncomingBalanceDeltaTransactions)
      const refreshCoinIds = Array.from(new Set(incomingImmediateBalanceDeltaTransactions.map((tx) => tx.coinId)))
      quaiDebugLog('tx.balanceRefresh.beforeCommit.start', {
        refreshCoinIds,
        incomingImmediateQuai: summarizeQuaiTxs(incomingImmediateBalanceDeltaTransactions),
      })
      if (refreshCoinIds.includes('raptoreum')) {
        coinDebugLog('raptoreum', 'tx.balanceRefresh.beforeCommit.start', {
          refreshCoinIds,
          incomingImmediateRaptoreum: summarizeRaptoreumTxs(incomingImmediateBalanceDeltaTransactions),
        })
      }
      for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
        if (!refreshCoinIds.includes(coinId)) continue
        coinDebugLog(coinId, 'tx.balanceRefresh.beforeCommit.start', {
          refreshCoinIds,
          incomingImmediateCoin: summarizeDebugUtxoTxs(incomingImmediateBalanceDeltaTransactions, coinId),
        })
      }
      coinApiService.invalidateCoinCache()
      await useCoinStore.getState().loadCoins({
        forceBalances: true,
        onlyCoinIds: refreshCoinIds,
        skipHistoryRefresh: true,
        skipIncomingHistoryFetch: true,
      })
      quaiDebugLog('tx.balanceRefresh.beforeCommit.done', {
        refreshCoinIds,
        storeQuai: useCoinStore.getState().coins
          .filter((coin) => coin.id === 'quai')
          .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
      })
      if (refreshCoinIds.includes('raptoreum')) {
        coinDebugLog('raptoreum', 'tx.balanceRefresh.beforeCommit.done', {
          refreshCoinIds,
          storeRaptoreum: useCoinStore.getState().coins
            .filter((coin) => coin.id === 'raptoreum')
            .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
        })
      }
      for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
        if (!refreshCoinIds.includes(coinId)) continue
        coinDebugLog(coinId, 'tx.balanceRefresh.beforeCommit.done', {
          refreshCoinIds,
          storeCoin: useCoinStore.getState().coins
            .filter((coin) => coin.id === coinId)
            .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
        })
      }
      if (!stillSameWallet(expectedScope, expectedMnemonic)) {
        if (showLoading) set({ loading: false })
        return { pageLoaded: false, pageKey, pageItemCount: 0, pageCoinItemCounts: {} }
      }
    }
    const pageTracking = remoteLoaded && !targetedHistoryRefresh
      ? {
        loadedPages: { ...pageTrackingBase.loadedPages, [pageKey]: true },
        pageItemCounts: { ...pageTrackingBase.pageItemCounts, [pageKey]: remotePageItemCount },
        pageCoinItemCounts: { ...pageTrackingBase.pageCoinItemCounts, [pageKey]: remotePageCoinItemCounts },
      }
      : {}

    set({
      transactions: merged,
      ...(showLoading ? { loading: false } : {}),
      ...pageTracking,
      pageSize,
      notifiedTxHashes: seen,
      ...(remoteLoaded && page === 1 && !isBackfill && !targetedHistoryRefresh ? { historyPrimed: true } : {}),
    })
    quaiDebugLog('tx.store.commit', {
      page,
      remoteLoaded,
      shouldRefreshBalancesBeforeHistoryCommit,
      shouldRefreshBalancesAfterHistory,
      storedQuai: summarizeQuaiTxs(merged),
    })
    if (merged.some((tx) => tx.coinId === 'pearl') || newIncomingBalanceDeltaTransactions.some((tx) => tx.coinId === 'pearl')) {
      coinDebugLog('pearl', 'tx.store.commit', {
        page,
        remoteLoaded,
        shouldRefreshBalancesBeforeHistoryCommit,
        shouldRefreshBalancesAfterHistory,
        storedPearl: summarizePearlTxs(merged),
      })
    }
    if (merged.some((tx) => tx.coinId === 'raptoreum') || newIncomingBalanceDeltaTransactions.some((tx) => tx.coinId === 'raptoreum')) {
      coinDebugLog('raptoreum', 'tx.store.commit', {
        page,
        remoteLoaded,
        shouldRefreshBalancesBeforeHistoryCommit,
        shouldRefreshBalancesAfterHistory,
        storedRaptoreum: summarizeRaptoreumTxs(merged),
      })
    }
    for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
      if (!merged.some((tx) => tx.coinId === coinId) && !newIncomingBalanceDeltaTransactions.some((tx) => tx.coinId === coinId)) continue
      coinDebugLog(coinId, 'tx.store.commit', {
        page,
        remoteLoaded,
        shouldRefreshBalancesBeforeHistoryCommit,
        shouldRefreshBalancesAfterHistory,
        storedCoin: summarizeDebugUtxoTxs(merged, coinId),
      })
    }
    saveStoredTransactions(merged)
    saveMergedNotifiedTxHashes(seen)
    useCoinStore.getState().syncPendingOutgoingReservations(merged)
    if (!shouldRefreshBalancesBeforeHistoryCommit) {
      useCoinStore.getState().recordFreshIncomingTransactions(newIncomingBalanceDeltaTransactions)
    }
    if (shouldRefreshBalancesAfterHistory && !shouldRefreshBalancesBeforeHistoryCommit) {
      coinApiService.invalidateCoinCache()
    }
    if (toast) {
      quaiDebugLog('tx.toast.emit', {
        toast,
        isQuai: toast.coinTicker === 'QUAI' || toast.coinTicker.toLowerCase() === 'quai',
      })
      const emit = () => set({ pendingNotification: toast ?? get().pendingNotification })
      if (options.deferNotification) globalThis.setTimeout(emit, 0)
      else emit()
    }
    if (!shouldRefreshBalancesBeforeHistoryCommit && !options.skipBalanceRefresh && shouldRefreshBalancesAfterHistory) {
      const refreshCoinIds = Array.from(new Set(newIncomingBalanceDeltaTransactions.map((tx) => tx.coinId)))
      quaiDebugLog('tx.balanceRefresh.afterCommit.start', {
        refreshCoinIds,
        newIncomingQuai: summarizeQuaiTxs(newIncomingBalanceDeltaTransactions),
      })
      if (refreshCoinIds.includes('raptoreum')) {
        coinDebugLog('raptoreum', 'tx.balanceRefresh.afterCommit.start', {
          refreshCoinIds,
          newIncomingRaptoreum: summarizeRaptoreumTxs(newIncomingBalanceDeltaTransactions),
        })
      }
      for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
        if (!refreshCoinIds.includes(coinId)) continue
        coinDebugLog(coinId, 'tx.balanceRefresh.afterCommit.start', {
          refreshCoinIds,
          newIncomingCoin: summarizeDebugUtxoTxs(newIncomingBalanceDeltaTransactions, coinId),
        })
      }
      await useCoinStore.getState().loadCoins({
        forceBalances: true,
        onlyCoinIds: refreshCoinIds,
        skipHistoryRefresh: true,
        skipIncomingHistoryFetch: true,
      })
      quaiDebugLog('tx.balanceRefresh.afterCommit.done', {
        refreshCoinIds,
        storeQuai: useCoinStore.getState().coins
          .filter((coin) => coin.id === 'quai')
          .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
      })
      if (refreshCoinIds.includes('raptoreum')) {
        coinDebugLog('raptoreum', 'tx.balanceRefresh.afterCommit.done', {
          refreshCoinIds,
          storeRaptoreum: useCoinStore.getState().coins
            .filter((coin) => coin.id === 'raptoreum')
            .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
        })
      }
      for (const coinId of UTXO_INCOMING_DEBUG_COIN_IDS) {
        if (!refreshCoinIds.includes(coinId)) continue
        coinDebugLog(coinId, 'tx.balanceRefresh.afterCommit.done', {
          refreshCoinIds,
          storeCoin: useCoinStore.getState().coins
            .filter((coin) => coin.id === coinId)
            .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
        })
      }
    }
    if (options.startup && page === 1) {
      window.setTimeout(() => {
        void get().loadTransactions({ page: 1, pageSize, force: true, silent: true })
      }, STARTUP_SIDELOAD_DELAY_MS)
    }
    if (remoteLoaded && page === 1 && !targetedHistoryRefresh && options.skipAllHistorySideload !== true) {
      window.setTimeout(() => {
        void get().loadAllTransactions({
          pageSize: HISTORY_SIDELOAD_PAGE_SIZE,
          silent: true,
          expectedScope,
          expectedMnemonic,
        })
      }, 0)
    }
    return {
      pageLoaded: remoteLoaded,
      pageKey,
      pageItemCount: remoteLoaded ? remotePageItemCount : 0,
      pageCoinItemCounts: remoteLoaded ? remotePageCoinItemCounts : {},
    }
  },

  loadAllTransactions: async (options = {}) => {
    const pageSize = Math.max(1, Math.min(Math.floor(options.pageSize ?? HISTORY_SIDELOAD_PAGE_SIZE), 50))
    const expectedScope = options.expectedScope ?? walletService.getWalletStorageScope()
    const expectedMnemonic = options.expectedMnemonic ?? walletService.getSessionMnemonic() ?? undefined

    if (!options.force && get().allHistoryLoaded) return
    if (allHistorySideloadInFlight) return allHistorySideloadInFlight

    allHistorySideloadInFlight = (async () => {
      let completed = false
      if (stillSameWallet(expectedScope, expectedMnemonic)) {
        set({
          allHistoryLoading: true,
          ...(options.force ? { allHistoryLoaded: false } : {}),
        })
      }
      try {
        for (let page = 1; page <= MAX_HISTORY_SIDELOAD_PAGES; page += 1) {
          if (!stillSameWallet(expectedScope, expectedMnemonic)) return
          const result = await get().loadTransactions({
            page,
            pageSize,
            force: options.force === true,
            silent: true,
            skipBalanceRefresh: true,
            backfill: true,
            skipPrivacy: true,
            skipAllHistorySideload: true,
          })
          if (!stillSameWallet(expectedScope, expectedMnemonic)) return
          if (!result.pageLoaded) return
          if (result.pageItemCount < pageSize) {
            completed = true
            return
          }
        }
      } finally {
        if (stillSameWallet(expectedScope, expectedMnemonic)) {
          set({
            allHistoryLoading: false,
            allHistoryLoaded: completed,
          })
        }
        allHistorySideloadInFlight = null
      }
    })()

    return allHistorySideloadInFlight
  },

  mergePrivacyTransactions: async (coinId, rawTransactions, satsPerCoin, options = {}) => {
    if (!stillSameWallet(options.expectedScope, options.expectedMnemonic)) return
    const tipHeight = options.tipHeight ?? await privacyNetworkTipHeight(coinId, { transactions: rawTransactions })
    const incoming = rawTransactions
      .map((tx) => privacyTransferToTransaction(coinId, tx, satsPerCoin, { tipHeight }))
      .filter((tx): tx is Transaction => Boolean(tx))
    if (coinId === 'zano' || coinId === 'epic') {
      coinDebugLog(coinId, 'tx.privacy.merge.start', {
        rawCount: rawTransactions.length,
        mappedCount: incoming.length,
        tipHeight,
        options: {
          silent: options.silent === true,
          startup: options.startup === true,
          primeNotifications: options.primeNotifications === true,
        },
        mapped: incoming.slice(0, 20).map(summarizeTxForDebug),
      })
    }
    if (incoming.length === 0) return

    const coins = await coinService.getCoins()
    if (!stillSameWallet(options.expectedScope, options.expectedMnemonic)) return
    const coinById = new Map(coins.map((coin) => [coin.id, coin]))
    const prevState = get()
    const prevTransactions = prevState.transactions.length > 0 ? prevState.transactions : readStoredTransactions()
    const prevSyntheticKeys = new Set(
      prevTransactions
        .map(privacySyntheticMatchKey)
        .filter((key): key is string => Boolean(key)),
    )
    const incomingSyntheticKeys = new Set(
      incoming
        .map(privacySyntheticMatchKey)
        .filter((key): key is string => Boolean(key)),
    )
    const incomingKeys = new Set(incoming.map((tx) => txKey(tx)))
    const now = Date.now()
    const prevTransactionsForMerge = coinId === 'epic'
      ? prevTransactions.filter((tx) => {
        if (tx.coinId !== coinId) return true
        if (incomingKeys.has(txKey(tx))) return false
        if (tx.type === 'outgoing') {
          if (tx.status !== 'pending') return true
          const createdAtMs = Date.parse(tx.createdAt)
          return Number.isFinite(createdAtMs) && now - createdAtMs < LONG_LOCAL_PENDING_GRACE_MS
        }
        const createdAtMs = Date.parse(tx.createdAt)
        return tx.status === 'pending'
          && Number.isFinite(createdAtMs)
          && now - createdAtMs < LONG_LOCAL_PENDING_GRACE_MS
      })
      : (incomingSyntheticKeys.size > 0
        ? prevTransactions.filter((tx) => {
          if (tx.coinId !== 'epic') return true
          const syntheticKey = privacySyntheticMatchKey(tx)
          return !syntheticKey || !incomingSyntheticKeys.has(syntheticKey)
        })
        : prevTransactions)
    const prevByHash = new Map(prevTransactionsForMerge.map((tx) => [txKey(tx), tx]))
    const wasAlreadyKnown = (tx: Transaction) => {
      const syntheticKey = privacySyntheticMatchKey(tx)
      return prevByHash.has(txKey(tx)) || Boolean(syntheticKey && prevSyntheticKeys.has(syntheticKey))
    }
    const reconciled = incoming.map((tx) => {
      const prev = prevByHash.get(txKey(tx))
      if (!prev) return tx
      const trustLocalOutgoing = prev.type === 'outgoing'
      return {
        ...tx,
        type: trustLocalOutgoing ? 'outgoing' : tx.type,
        amount: trustLocalOutgoing ? prev.amount : tx.amount,
        to: trustLocalOutgoing ? prev.to ?? tx.to : tx.to,
        from: trustLocalOutgoing ? prev.from ?? tx.from : tx.from,
        internal: prev.internal ?? tx.internal,
        fee: trustLocalOutgoing ? prev.fee ?? tx.fee : tx.fee ?? prev.fee,
        spentOutpoints: prev.spentOutpoints ?? tx.spentOutpoints,
        balanceBefore: prev.balanceBefore ?? tx.balanceBefore,
        expectedBalanceAfter: prev.expectedBalanceAfter ?? tx.expectedBalanceAfter,
        createdAt: prev.createdAt ?? tx.createdAt,
        blockHeight: tx.blockHeight ?? prev.blockHeight,
      } as Transaction
    })
    const merged = dedupeTransactions([
      ...prevTransactionsForMerge.filter((tx) => !incomingKeys.has(txKey(tx))),
      ...reconciled,
    ])
    if (coinId === 'zano' || coinId === 'epic') {
      coinDebugLog(coinId, 'tx.privacy.merge.result', {
        prevCount: prevTransactions.length,
        incomingCount: incoming.length,
        mergedCount: merged.length,
        prevSyntheticKeys: [...prevSyntheticKeys].slice(0, 20),
        incomingSyntheticKeys: [...incomingSyntheticKeys].slice(0, 20),
        reconciled: reconciled.slice(0, 20).map(summarizeTxForDebug),
        coinTransactions: merged.filter((tx) => tx.coinId === coinId).slice(0, 30).map(summarizeTxForDebug),
      })
    }

    const seen = new Set([...readNotifiedTxHashes(), ...get().notifiedTxHashes])
    const firstRun = prevTransactions.length === 0 && seen.size === 0
    const makePrivacyIncomingToast = (tx: Transaction): TxNotification => {
      const coin = coinById.get(tx.coinId)
      return {
        id: `${tx.txHash}-${tx.status}`,
        kind: tx.status === 'confirmed' ? 'received-confirmed' : 'received',
        coinTicker: coin?.ticker ?? tx.coinId,
        amount: tx.amount,
      }
    }
    const claimPrivacyIncomingToast = (
      candidates: Transaction[],
      allowAlreadyKnownFresh = false,
    ): TxNotification | null => {
      const newIncoming = claimFreshIncomingNotifications(candidates, seen, {
        coinById,
        includePrivacy: true,
        now: Date.now(),
        wasAlreadyKnown,
        allowAlreadyKnownFresh,
      })
      return newIncoming.length > 0 ? makePrivacyIncomingToast(newIncoming[0]) : null
    }

    if (txSignature(prevTransactions) === txSignature(merged)) {
      void persistPrivacyOutgoingTransactionsToCache(coinId, merged, options.expectedMnemonic, 'merge-unchanged')
      if (firstRun || options.startup || options.primeNotifications) {
        const beforeSize = seen.size
        for (const tx of merged) if (tx.type === 'incoming') seen.add(txKey(tx))
        if (seen.size !== beforeSize) {
          set({ notifiedTxHashes: seen })
          saveMergedNotifiedTxHashes(seen)
        }
      } else {
        const toast = claimPrivacyIncomingToast(merged, true)
        if (toast) {
          coinDebugLog(coinId, 'tx.privacy.toast.emit', {
            toast,
            silent: options.silent === true,
            signatureUnchanged: true,
          })
          set({ notifiedTxHashes: seen })
          saveMergedNotifiedTxHashes(seen)
          const emit = () => set({ pendingNotification: toast ?? get().pendingNotification })
          if (options.deferNotification) globalThis.setTimeout(emit, 0)
          else emit()
        }
      }
      return
    }

    let toast: TxNotification | null = null
    if (firstRun || options.startup || options.primeNotifications) {
      for (const tx of merged) if (tx.type === 'incoming') seen.add(txKey(tx))
    } else if (options.silent) {
      // Privacy snapshots are often refreshed in the background; if that first
      // sees a fresh incoming tx, notify now before the saved history makes it
      // look "already known" to the next foreground pass.
      toast = claimPrivacyIncomingToast(reconciled, true)
    } else {
      toast = claimPrivacyIncomingToast(merged)
    }

    set({
      transactions: merged,
      notifiedTxHashes: seen,
    })
    saveStoredTransactions(merged)
    saveMergedNotifiedTxHashes(seen)
    useCoinStore.getState().syncPendingOutgoingReservations(merged)
    void persistPrivacyOutgoingTransactionsToCache(coinId, merged, options.expectedMnemonic, 'merge-updated')
    if (toast) {
      coinDebugLog(coinId, 'tx.privacy.toast.emit', {
        toast,
        silent: options.silent === true,
        signatureUnchanged: false,
      })
      const emit = () => set({ pendingNotification: toast ?? get().pendingNotification })
      if (options.deferNotification) globalThis.setTimeout(emit, 0)
      else emit()
    }
  },

  mergeSyntheticTransactions: async (incoming, options = {}) => {
    const normalized = incoming.filter((tx) => tx?.coinId && tx?.txHash)
    if (normalized.length === 0) return
    if (!stillSameWallet(options.expectedScope, options.expectedMnemonic)) return

    const coins = await coinService.getCoins()
    if (!stillSameWallet(options.expectedScope, options.expectedMnemonic)) return
    const coinById = new Map(coins.map((coin) => [coin.id, coin]))
    const prevState = get()
    const prevTransactions = prevState.transactions.length > 0 ? prevState.transactions : readStoredTransactions()
    const prevByHash = new Map(prevTransactions.map((tx) => [txKey(tx), tx]))
    const reconciled = normalized.map((tx) => {
      const prev = prevByHash.get(txKey(tx))
      if (!prev) return tx
      const trustLocalOutgoing = prev.type === 'outgoing'
      return {
        ...tx,
        type: trustLocalOutgoing ? 'outgoing' : tx.type,
        amount: trustLocalOutgoing ? prev.amount : tx.amount,
        to: trustLocalOutgoing ? prev.to ?? tx.to : tx.to,
        from: trustLocalOutgoing ? prev.from ?? tx.from : tx.from,
        internal: prev.internal ?? tx.internal,
        fee: trustLocalOutgoing ? prev.fee ?? tx.fee : tx.fee ?? prev.fee,
        spentOutpoints: prev.spentOutpoints ?? tx.spentOutpoints,
        balanceBefore: prev.balanceBefore ?? tx.balanceBefore,
        expectedBalanceAfter: prev.expectedBalanceAfter ?? tx.expectedBalanceAfter,
        createdAt: prev.createdAt ?? tx.createdAt,
        blockHeight: tx.blockHeight ?? prev.blockHeight,
      } as Transaction
    })
    const incomingKeys = new Set(normalized.map((tx) => txKey(tx)))
    const merged = dedupeTransactions([
      ...prevTransactions.filter((tx) => !incomingKeys.has(txKey(tx))),
      ...reconciled,
    ])

    const seen = new Set([...readNotifiedTxHashes(), ...get().notifiedTxHashes])
    const firstRun = prevTransactions.length === 0 && seen.size === 0
    if (txSignature(prevTransactions) === txSignature(merged)) {
      if (firstRun || options.startup) {
        const beforeSize = seen.size
        for (const tx of merged) if (tx.type === 'incoming') seen.add(txKey(tx))
        if (seen.size !== beforeSize) {
          set({ notifiedTxHashes: seen })
          saveMergedNotifiedTxHashes(seen)
        }
      }
      return
    }

    let toast: TxNotification | null = null
    if (firstRun || options.startup) {
      for (const tx of merged) if (tx.type === 'incoming') seen.add(txKey(tx))
    } else if (options.silent) {
      // Silent privacy refreshes must not consume notification hashes.
      // A later foreground poll can still notify for fresh transactions.
    } else {
      const notifyNow = Date.now()
      const newIncoming = claimFreshIncomingNotifications(reconciled, seen, {
        coinById,
        includePrivacy: true,
        now: notifyNow,
      })
      if (newIncoming.length > 0) {
        const tx = newIncoming[0]
        const coin = coins.find((c) => c.id === tx.coinId)
        toast = {
          id: `${tx.txHash}-${tx.status}`,
          kind: tx.status === 'confirmed' ? 'received-confirmed' : 'received',
          coinTicker: coin?.ticker ?? tx.coinId,
          amount: tx.amount,
        }
      }
    }
    set({
      transactions: merged,
      notifiedTxHashes: seen,
    })
    saveStoredTransactions(merged)
    saveMergedNotifiedTxHashes(seen)
    useCoinStore.getState().syncPendingOutgoingReservations(merged)
    if (toast) set({ pendingNotification: toast ?? get().pendingNotification })
  },

  clearNotification: () => set({ pendingNotification: null }),

  resetTransactions: () => {
    const emptySeen = new Set<string>()
    allHistorySideloadInFlight = null
    privacyHistorySideloadInFlight = false
    notificationKeysInFlight.clear()
    set({
      transactions: [],
      allHistoryLoaded: false,
      allHistoryLoading: false,
      loadedPages: {},
      pageItemCounts: {},
      pageCoinItemCounts: {},
      notifiedTxHashes: emptySeen,
      pendingNotification: null,
      lastSentAt: null,
      historyPrimed: false,
    })
    // Wipe EVERY wallet scope, not just the current one. The previous code
    // removed the un-scoped keys (`transactions`, ...) which never exist — the
    // real data lives under `<key>:wf-<hash>`, so a prior seed's transactions
    // survived a restore-over-existing-wallet and could resurface in the new
    // wallet. removeByPrefix clears the unscoped key AND all per-wallet scopes.
    storageService.removeByPrefix(TRANSACTIONS_KEY)
    storageService.removeByPrefix(NOTIFIED_TX_KEY)
    storageService.removeByPrefix(RESERVED_OUTGOING_KEY)
  },

  sendTransaction: async (payload) => {
    if (sendInFlight) throw new Error('A previous send is still in progress')
    // Privacy engines (Epic/Zano) enforce their own spend-locking; a phantom
    // snapshot-derived pending outgoing must not block a send the user wants.
    const lockCoin = await coinService.getCoinById(payload.coinId)
    if (get().transactions.some((tx) =>
      tx.coinId === payload.coinId && pendingOutgoingBlocksSend(tx, lockCoin ?? undefined)
    )) {
      throw new Error('pendingOutgoingLocked')
    }
    const last = get().lastSentAt
    if (last && Date.now() - last < SEND_COOLDOWN_MS) {
      const seconds = Math.ceil((SEND_COOLDOWN_MS - (Date.now() - last)) / 1000)
      throw new Error(`Please wait ${seconds}s before sending again (previous transaction is still propagating)`)
    }

    sendInFlight = true
    set({ sending: true })

    try {
      const { coinId, to, amount, mnemonic } = payload
      let balanceBeforeSend = useCoinStore.getState().coins.find((coin) => coin.id === coinId)?.balance

      const coinMeta = (await coinService.getCoinById(coinId)) ?? null
      const savedBalanceBeforeSend = coinMeta?.balance
      if (
        (!balanceBeforeSend || Number.parseFloat(balanceBeforeSend) <= 0)
        && savedBalanceBeforeSend
        && Number.parseFloat(savedBalanceBeforeSend) > 0
      ) {
        balanceBeforeSend = savedBalanceBeforeSend
      }
      if (coinMeta?.walletEngine === 'zano-light' || coinMeta?.walletEngine === 'epic-light') {
        const storeCoinBeforePrivacySend = useCoinStore.getState().coins.find((coin) => coin.id === coinId)
        const nativeReadinessBeforeSend = privacyWalletService.getNativeReadiness(coinId as PrivacyCoin)
        const canSkipWarmBeforePrivacySend = false
        coinDebugLog(coinId, 'send.privacy.start', {
          amount,
          fee: payload.fee,
          to,
          balanceBeforeSend,
          coinMeta: {
            balance: coinMeta.balance,
            spendableBalance: coinMeta.spendableBalance,
            status: coinMeta.status,
          },
          storeCoin: storeCoinBeforePrivacySend,
          nativeReadiness: nativeReadinessBeforeSend,
          canSkipWarmBeforePrivacySend,
        })
        if (nativeReadinessBeforeSend !== 'ready' && !canSkipWarmBeforePrivacySend) {
          const coinLabel = coinId === 'zano' ? 'Zano' : 'Epic'
          coinDebugLog(coinId, 'send.privacy.blockedNativeNotReady', {
            nativeReadiness: nativeReadinessBeforeSend,
            balanceBeforeSend,
            storeCoin: storeCoinBeforePrivacySend,
          })
          throw new Error(`${coinLabel} wallet is still preparing local spend data. Please wait until ${coinLabel} becomes active.`)
        }
        const nativeSendStartedAt = Date.now()
        const slowSendTimers = [
          setTimeout(() => {
            coinDebugLog(coinId, 'send.privacy.nativeCall.stillRunning', {
              elapsedMs: Date.now() - nativeSendStartedAt,
              nativeReadiness: privacyWalletService.getNativeReadiness(coinId as PrivacyCoin),
              balanceBeforeSend,
              storeCoin: useCoinStore.getState().coins.find((coin) => coin.id === coinId),
            })
          }, 15_000),
          setTimeout(() => {
            coinDebugLog(coinId, 'send.privacy.nativeCall.stillRunning', {
              elapsedMs: Date.now() - nativeSendStartedAt,
              nativeReadiness: privacyWalletService.getNativeReadiness(coinId as PrivacyCoin),
              balanceBeforeSend,
              storeCoin: useCoinStore.getState().coins.find((coin) => coin.id === coinId),
            })
          }, 45_000),
        ]
        let result: Awaited<ReturnType<typeof privacyWalletService.send>>
        try {
          coinDebugLog(coinId, 'send.privacy.nativeCall.start', {
            nativeReadiness: privacyWalletService.getNativeReadiness(coinId as PrivacyCoin),
            balanceBeforeSend,
          })
          result = await privacyWalletService.send(coinId as PrivacyCoin, mnemonic, to, amount, payload.fee, payload.comment, payload.sendMax === true)
          coinDebugLog(coinId, 'send.privacy.nativeCall.done', {
            durationMs: Date.now() - nativeSendStartedAt,
            nativeReadiness: privacyWalletService.getNativeReadiness(coinId as PrivacyCoin),
            result: {
              txid: result.txid,
              amount: result.amount,
              fee: result.fee,
              code: result.code,
              balance: result.balance,
              spendable: result.spendable,
            },
          })
        } catch (error) {
          coinDebugLog(coinId, 'send.privacy.nativeCall.error', {
            durationMs: Date.now() - nativeSendStartedAt,
            nativeReadiness: privacyWalletService.getNativeReadiness(coinId as PrivacyCoin),
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        } finally {
          slowSendTimers.forEach((timer) => clearTimeout(timer))
        }
        if (!result.txid) throw new Error('Local wallet engine did not return a transaction id')
        const fromAddress = walletService.getWalletAddresses()[coinId]
        const actualAmount = result.amount || amount
        const actualFee = result.fee ?? payload.fee
        const internal = Boolean(fromAddress && to && to.trim().toLowerCase() === fromAddress.trim().toLowerCase())
        let expectedBalanceAfter: string | undefined
        if (balanceBeforeSend) {
          const decimals = decimalsForSatsPerCoin(coinMeta.satsPerCoin ?? 100_000_000)
          const beforeUnits = toBaseUnits(balanceBeforeSend, decimals)
          const deltaUnits = (internal ? 0n : toBaseUnits(actualAmount, decimals)) + toBaseUnits(actualFee ?? '0', decimals)
          expectedBalanceAfter = fromBaseUnits(beforeUnits > deltaUnits ? beforeUnits - deltaUnits : 0n, decimals)
        }
        const tx: Transaction = {
          id: `${coinId}-${result.txid}`,
          coinId,
          type: 'outgoing',
          amount: actualAmount,
          fee: actualFee,
          status: 'pending',
          txHash: result.txid,
          from: fromAddress,
          to,
          internal,
          createdAt: new Date().toISOString(),
          confirmations: 0,
          balanceBefore: balanceBeforeSend,
          expectedBalanceAfter,
        }
        const nextTransactions = dedupeTransactions([tx, ...get().transactions])
        set({ transactions: nextTransactions, lastSentAt: Date.now() })
        saveStoredTransactions(nextTransactions)
        await persistPrivacyOutgoingTransactionsToCache(coinId, nextTransactions, mnemonic, 'send-saved-pending', fromAddress)
        await useCoinStore.getState().applyTransactionBalanceDelta(tx)
        coinDebugLog(coinId, 'send.privacy.savedPending', {
          tx: summarizeTxForDebug(tx),
          result: {
            txid: result.txid,
            amount: result.amount,
            fee: result.fee,
            code: result.code,
            balance: result.balance,
            spendable: result.spendable,
          },
          coinTransactions: nextTransactions.filter((item) => item.coinId === coinId).slice(0, 20).map(summarizeTxForDebug),
          storeCoin: useCoinStore.getState().coins.find((coin) => coin.id === coinId),
          nativeReadiness: privacyWalletService.getNativeReadiness(coinId as PrivacyCoin),
        })
        setTimeout(() => {
          void (async () => {
            await get().loadTransactions({ force: true, silent: true })
            await useCoinStore.getState().loadCoins({ forceBalances: true, onlyCoinIds: [coinId] })
          })()
        }, 3_000)
        return tx
      }

      if (coinMeta?.walletEngine === 'quai-account') {
        const fromAddress = walletService.getWalletAddresses()[coinId]
        if (!fromAddress) throw new Error(`Address for ${coinId} not derived yet вЂ” reopen the wallet`)
        const visibleQuaiBeforeSend = useCoinStore.getState().coins.find((coin) => coin.id === coinId)
        const visibleBalanceBeforeSend = visibleQuaiBeforeSend?.balance
        const visibleSpendableBeforeSend = visibleQuaiBeforeSend?.spendableBalance
        let forceOutgoingExpectedBalance = false
        let provisionalFee = payload.fee
        const provisionalFeePromise = !provisionalFee && !payload.sendMax
          ? withTimeout(quaiWalletService.estimateFee(coinId, { force: true }), 1_500).catch((error) => {
              quaiDebugLogError('send.quai.provisionalFee.error', error, { from: fromAddress })
              return null
            })
          : Promise.resolve(null)
        try {
          const [freshBalance, estimatedFee] = await Promise.all([
            coinApiService.getBalance(coinId, fromAddress),
            provisionalFeePromise,
          ])
          if (!provisionalFee && estimatedFee?.coin) provisionalFee = estimatedFee.coin
          const decimals = decimalsForSatsPerCoin(coinMeta?.satsPerCoin ?? 100_000_000)
          const freshUnits = BigInt(Math.max(0, Math.floor(Number(freshBalance.balance_spendable ?? freshBalance.balance ?? 0))))
          if (freshUnits > 0n) {
            const visibleUnits = visibleBalanceBeforeSend ? toBaseUnits(visibleBalanceBeforeSend, decimals) : 0n
            const hiddenIncomingUnits = visibleUnits > 0n && freshUnits > visibleUnits
              ? freshUnits - visibleUnits
              : 0n
            balanceBeforeSend = hiddenIncomingUnits > 0n
              ? fromBaseUnits(visibleUnits, decimals)
              : fromBaseUnits(freshUnits, decimals)
            forceOutgoingExpectedBalance = true
          }
          quaiDebugLog('send.quai.balanceBefore.fresh', {
            from: fromAddress,
            balanceBeforeSend,
            forceOutgoingExpectedBalance,
            visibleBalanceBeforeSend,
            freshBalance: {
              balance: freshBalance.balance,
              spendable: freshBalance.balance_spendable,
              pendingIncoming: freshBalance.pendingIncoming,
              pendingOutgoing: freshBalance.pendingOutgoing,
              pendingTxids: freshBalance.pendingTxids,
              pendingOutgoingTxids: freshBalance.pendingOutgoingTxids,
            },
          })
        } catch (error) {
          quaiDebugLogError('send.quai.balanceBefore.error', error, {
            from: fromAddress,
            fallbackBalanceBeforeSend: balanceBeforeSend,
          })
        }
        quaiDebugLog('send.quai.start', {
          from: fromAddress,
          to,
          amount,
          fee: payload.fee,
          provisionalFee,
          sendMax: payload.sendMax === true,
          balanceBeforeSend,
          storeQuai: useCoinStore.getState().coins
            .filter((coin) => coin.id === 'quai')
            .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
        })
        let provisionalTx: Transaction | null = null
        let provisionalBalanceApplied = false
        if (!payload.sendMax && balanceBeforeSend) {
          provisionalTx = {
            id: `${coinId}-local-${Date.now()}`,
            coinId,
            type: 'outgoing',
            amount,
            fee: provisionalFee ?? '0',
            status: 'pending',
            txHash: `local-quai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            from: fromAddress,
            to,
            internal: fromAddress.toLowerCase() === to.toLowerCase(),
            createdAt: new Date().toISOString(),
            confirmations: 0,
            balanceBefore: balanceBeforeSend,
          }
          provisionalBalanceApplied = await useCoinStore.getState().applyTransactionBalanceDelta(provisionalTx, {
            forceOutgoingExpectedBalance,
          })
          quaiDebugLog('send.quai.provisionalBalanceApplied', {
            tx: summarizeTxForDebug(provisionalTx),
            applied: provisionalBalanceApplied,
            storeQuai: useCoinStore.getState().coins
              .filter((coin) => coin.id === 'quai')
              .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
          })
        }
        let preparedTx: Transaction | null = null
        let preparedBalanceApplied = false
        const result = await (async () => {
          try {
            return await quaiWalletService.send({
              coinId,
              mnemonic,
              fromAddress,
              toAddress: to,
              amountCoin: amount,
              feeCoin: payload.fee,
              sendMax: payload.sendMax,
              onPrepared: async (prepared) => {
                const tx: Transaction = {
                  id: `${coinId}-${prepared.txid}`,
                  coinId,
                  type: 'outgoing',
                  amount: prepared.amountCoin,
                  fee: prepared.feeCoin,
                  status: 'pending',
                  txHash: prepared.txid,
                  from: fromAddress,
                  to,
                  internal: fromAddress.toLowerCase() === to.toLowerCase(),
                  createdAt: new Date().toISOString(),
                  confirmations: 0,
                  balanceBefore: balanceBeforeSend,
                }
                preparedTx = tx
                quaiDebugLog('send.quai.prepared', {
                  tx: summarizeTxForDebug(tx),
                })
                if (provisionalTx) {
                  useCoinStore.getState().releaseOutgoingReservation(provisionalTx.txHash)
                  provisionalTx = null
                }
                const nextTransactions = dedupeTransactions([tx, ...get().transactions])
                set({ transactions: nextTransactions })
                saveStoredTransactions(nextTransactions)
                preparedBalanceApplied = await useCoinStore.getState().applyTransactionBalanceDelta(tx, {
                  forceOutgoingExpectedBalance,
                })
                quaiDebugLog('send.quai.preparedBalanceApplied', {
                  tx: summarizeTxForDebug(tx),
                  applied: preparedBalanceApplied,
                  storeQuai: useCoinStore.getState().coins
                    .filter((coin) => coin.id === 'quai')
                    .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
                })
              },
            })
          } catch (error) {
            quaiDebugLogError('send.quai.error', error, {
              preparedTx: preparedTx ? summarizeTxForDebug(preparedTx) : null,
              preparedBalanceApplied,
            })
            if (provisionalTx) {
              useCoinStore.getState().releaseOutgoingReservation(provisionalTx.txHash)
              provisionalTx = null
            }
            const failedPreparedTx = preparedTx as Transaction | null
            if (failedPreparedTx) {
              useCoinStore.getState().releaseOutgoingReservation(failedPreparedTx.txHash)
              const rollbackTransactions = get().transactions.filter((item) => txKey(item) !== txKey(failedPreparedTx))
              set({ transactions: rollbackTransactions })
              saveStoredTransactions(rollbackTransactions)
            }
            if (preparedBalanceApplied || provisionalBalanceApplied) {
              if (visibleBalanceBeforeSend) {
                await useCoinStore.getState().restoreCoinBalance(
                  coinId,
                  visibleBalanceBeforeSend,
                  visibleSpendableBeforeSend,
                ).catch(() => undefined)
              }
              await useCoinStore.getState().loadCoins({ forceBalances: true, onlyCoinIds: [coinId] }).catch(() => undefined)
            }
            throw error
          }
        })()
        if (!result.txid) throw new Error('Quai wallet engine did not return a transaction id')
        const preparedTransaction = (preparedTx ?? null) as Transaction | null
        const sentAmount = result.amountCoin ?? preparedTransaction?.amount ?? amount
        const tx: Transaction = preparedTransaction
          ? {
              ...preparedTransaction,
              id: `${coinId}-${result.txid}`,
              amount: sentAmount,
              fee: result.feeCoin ?? preparedTransaction.fee,
              txHash: result.txid,
            }
          : {
              id: `${coinId}-${result.txid}`,
              coinId,
              type: 'outgoing',
              amount: sentAmount,
              fee: result.feeCoin,
              status: 'pending',
              txHash: result.txid,
              from: fromAddress,
              to,
              internal: fromAddress.toLowerCase() === to.toLowerCase(),
              createdAt: new Date().toISOString(),
              confirmations: 0,
              balanceBefore: balanceBeforeSend,
            }
        const currentTransactions = preparedTransaction
          ? get().transactions.filter((item) => txKey(item) !== txKey(preparedTransaction))
          : get().transactions
        const nextTransactions = dedupeTransactions([tx, ...currentTransactions])
        set({ transactions: nextTransactions, lastSentAt: Date.now() })
        saveStoredTransactions(nextTransactions)
        await useCoinStore.getState().applyTransactionBalanceDelta(tx, {
          forceOutgoingExpectedBalance,
        })
        quaiDebugLog('send.quai.sent', {
          tx: summarizeTxForDebug(tx),
          result,
          storeQuai: useCoinStore.getState().coins
            .filter((coin) => coin.id === 'quai')
            .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
        })
        setTimeout(() => {
          void (async () => {
            await get().loadTransactions({ force: true, silent: true })
            await useCoinStore.getState().loadCoins({ forceBalances: true, onlyCoinIds: [coinId] })
          })()
        }, 3_000)
        return tx
      }

      const params = cryptoParamsFor(coinId)
      if (!params) throw new Error(`Coin "${coinId}" has no crypto parameters configured`)

      const fromAddress = walletService.getWalletAddresses()[coinId]
      if (!fromAddress) throw new Error(`Address for ${coinId} not derived yet — reopen the wallet`)

      const satsPerCoin = coinMeta?.satsPerCoin ?? 100_000_000
      const internal = await isWalletAddressVariant(to, fromAddress, params)

      const result = await coinTxService.send({
        coinId,
        cryptoParams: params,
        satsPerCoin,
        mnemonic,
        fromAddress,
        toAddress: to,
        amountCoin: amount,
        feeCoin: payload.fee,
        sendMax: payload.sendMax,
        excludeOutpoints: activeSpentOutpointsForCoin(coinId, get().transactions),
      })
      const sentAmount = result.amountCoin ?? amount

      const tx: Transaction = {
        id: `${coinId}-${result.txid}`,
        coinId,
        type: 'outgoing',
        amount: sentAmount,
        fee: result.feeCoin,
        status: 'pending',
        txHash: result.txid,
        from: fromAddress,
        to,
        internal,
        createdAt: new Date().toISOString(),
        confirmations: 0,
        spentOutpoints: result.spentOutpoints,
        balanceBefore: balanceBeforeSend,
      }

      const nextTransactions = dedupeTransactions([tx, ...get().transactions])
      set({
        transactions: nextTransactions,
        lastSentAt: Date.now(),
      })
      saveStoredTransactions(nextTransactions)
      await useCoinStore.getState().applyTransactionBalanceDelta(tx)

      // Refresh real history in background — replaces local entry once node sees it
      setTimeout(() => {
        void (async () => {
          await get().loadTransactions({ force: true, silent: true })
          await useCoinStore.getState().loadCoins({ forceBalances: true, onlyCoinIds: [coinId] })
        })()
      }, 3_000)

      return tx
    } finally {
      sendInFlight = false
      set({ sending: false })
    }
  },
}))
