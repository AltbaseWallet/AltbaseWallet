import { nativeCoreService } from './nativeCoreService'
import { privacyCacheService } from './privacyCacheService'
import { privacyBirthService } from './privacyBirthService'
import type { NativePrivacyRecoveryProgress } from './nativeCoreService'
import { coinDebugLog, coinDebugLogError } from '../utils/quaiDebugLog'

type PrivacyCoin = 'zano' | 'epic'

type PrivacyWalletResponse = {
  ok: boolean
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
  txid?: string
  amount?: string
  fee?: string
  serverStatus?: string
  error?: string
  code?: string
  cacheHistoryRegression?: boolean
}

type NativeReadiness = 'unknown' | 'syncing' | 'ready' | 'error'
type NativeReadinessSource = 'ensure' | 'warm' | 'snapshot' | 'send'
type SnapshotInFlight = {
  promise: Promise<PrivacyWalletResponse>
  listeners: Set<(progress: NativePrivacyRecoveryProgress) => void>
  mnemonic: string
}

const snapshotInFlight: Partial<Record<PrivacyCoin, SnapshotInFlight>> = {}
const nativeCallQueues: Partial<Record<PrivacyCoin, Promise<unknown>>> = {}
const nativeReadiness: Record<PrivacyCoin, NativeReadiness> = { zano: 'unknown', epic: 'unknown' }
const readinessListeners = new Set<(coin: PrivacyCoin, readiness: NativeReadiness) => void>()
const ZANO_READINESS_POLL_INTERVAL_MS = 3_000
const ZANO_READINESS_POLL_ATTEMPTS = 400
const ZANO_SCAN_STATE_REORG_OVERLAP = 30
let zanoReadinessPollToken = 0
let zanoReadinessPollActive = false
let nativeReadinessEpoch = 0
let nativeCallSeq = 0
let nativeQueueSeq = 0

const nativeProgressLogState = new Map<string, {
  at: number
  currentHeight: number
  blocksRemaining: number
  percent: number
}>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const summarizeProgress = (progress: NativePrivacyRecoveryProgress) => ({
  progressToken: progress.progressToken,
  fromHeight: progress.fromHeight,
  currentHeight: progress.currentHeight,
  tipHeight: progress.tipHeight,
  totalBlocks: progress.totalBlocks,
  scannedBlocks: progress.scannedBlocks,
  blocksRemaining: progress.blocksRemaining,
  percent: progress.percent,
})

const shouldLogNativeProgress = (key: string, progress: NativePrivacyRecoveryProgress) => {
  const previous = nativeProgressLogState.get(key)
  const now = Date.now()
  if (!previous) {
    nativeProgressLogState.set(key, {
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
    nativeProgressLogState.set(key, {
      at: now,
      currentHeight: progress.currentHeight,
      blocksRemaining: progress.blocksRemaining,
      percent: progress.percent,
    })
  }
  return shouldLog
}

const positiveHeight = (value: unknown) => {
  const height = Number(value ?? 0)
  return Number.isFinite(height) && height > 0 ? Math.floor(height) : 0
}

const zanoRestoreTimestampFromScanState = (scanState?: string) => {
  if (!scanState) return undefined
  try {
    const parsed = JSON.parse(scanState) as { outputs?: Array<{ timestamp?: unknown }> }
    let earliest = Number.POSITIVE_INFINITY
    for (const output of parsed.outputs ?? []) {
      const timestamp = Number(output.timestamp ?? 0)
      if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < earliest) earliest = timestamp
    }
    if (!Number.isFinite(earliest)) return undefined
    return String(Math.max(0, Math.floor(earliest) - 24 * 60 * 60))
  } catch {
    return undefined
  }
}

const zanoCachedRestoreStartFrom = (cached: {
  restoreStartHeight?: number
  lastScannedHeight?: number
  scanState?: string
  transactions?: unknown[]
} | null) => {
  if (!cached?.scanState) return undefined
  const heights: number[] = []
  let scanStateHeight: number | undefined
  try {
    const parsed = JSON.parse(cached.scanState) as { height?: unknown; outputs?: Array<{ height?: unknown }> }
    scanStateHeight = positiveHeight(parsed.height)
    for (const output of parsed.outputs ?? []) {
      const height = positiveHeight(output.height)
      if (height > 0) heights.push(height)
    }
  } catch {
    return undefined
  }
  for (const raw of cached.transactions ?? []) {
    const tx = raw as { height?: unknown; blockHeight?: unknown; block_height?: unknown; tipHeight?: unknown; tip_height?: unknown }
    const height = positiveHeight(tx.height ?? tx.blockHeight ?? tx.block_height ?? tx.tipHeight ?? tx.tip_height)
    if (height > 0) heights.push(height)
  }
  const cachedFloor = positiveHeight(cached.restoreStartHeight)
  const cachedScannedHeight = Math.max(scanStateHeight ?? 0, positiveHeight(cached.lastScannedHeight))
  const restoreAnchor = cachedScannedHeight > 0
    ? cachedScannedHeight
    : (heights.length ? Math.min(...heights) : 0)
  if (restoreAnchor <= 0) return undefined
  const cacheBackfillStart = Math.max(0, restoreAnchor - ZANO_SCAN_STATE_REORG_OVERLAP)
  return cachedFloor > 0
    ? Math.max(cachedFloor, cacheBackfillStart)
    : cacheBackfillStart
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

const summarizePrivacyTransactions = (transactions?: unknown[]) => {
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
    if (tx && typeof tx === 'object') {
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

const summarizePrivacyResponse = (response: PrivacyWalletResponse | null | undefined) => ({
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

const privacySnapshotHeight = (snapshot: { lastScannedHeight?: number; transactions?: unknown[] } | null | undefined) => {
  const explicit = Number(snapshot?.lastScannedHeight ?? 0)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  let best = 0
  for (const raw of snapshot?.transactions ?? []) {
    const tx = raw as { height?: unknown; blockHeight?: unknown; block_height?: unknown; tipHeight?: unknown; tip_height?: unknown }
    const height = Number(tx.tipHeight ?? tx.tip_height ?? tx.height ?? tx.blockHeight ?? tx.block_height ?? 0)
    if (Number.isFinite(height) && height > best) best = Math.floor(height)
  }
  return best
}

const positiveAmount = (value: unknown) => {
  const amount = Number.parseFloat(String(value ?? '0'))
  return Number.isFinite(amount) && amount > 0
}

const hasSpendableReady = (response: PrivacyWalletResponse) => {
  if (!response.ok) return false
  if (positiveAmount(response.balance) && !positiveAmount(response.spendable)) return false
  return true
}

const hasLockedNativeBalanceReady = (response: PrivacyWalletResponse) => {
  if (!response.ok) return false
  const code = response.code ?? ''
  if (code !== 'zano-native-wallet' && code !== 'epic-native-wallet') return false
  if (!positiveAmount(response.balance) || positiveAmount(response.spendable)) return false
  return (response.transactions?.length ?? 0) > 0
}

const hasNativeBalanceReady = (response: PrivacyWalletResponse) =>
  hasSpendableReady(response) || hasLockedNativeBalanceReady(response)

const zanoNativeRegressesCachedHistory = (
  cached: { transactions?: unknown[]; lastScannedHeight?: number; scanState?: string } | null,
  response: PrivacyWalletResponse,
) => {
  if (!cached || !response.ok || response.code !== 'zano-native-wallet') return false
  const cachedTxCount = cached.transactions?.length ?? 0
  const responseTxCount = response.transactions?.length ?? 0
  if (cachedTxCount <= responseTxCount) return false
  const cachedHeight = privacySnapshotHeight(cached)
  const responseHeight = privacySnapshotHeight(response)
  const responseIsNotAhead = cachedHeight > 0 && responseHeight > 0
    ? responseHeight <= cachedHeight
    : responseHeight <= 0
  return responseIsNotAhead && (Boolean(cached.scanState) || !response.scanState || cachedTxCount - responseTxCount >= 2)
}

const privacyTxRichness = (tx: unknown) => {
  if (!tx || typeof tx !== 'object') return 0
  const item = tx as {
    amount?: unknown
    type?: unknown
    direction?: unknown
    status?: unknown
    confirmations?: unknown
    from?: unknown
    to?: unknown
    subtransfers?: unknown
    remote_addresses?: unknown
  }
  let score = 0
  if (item.amount !== undefined && (item.type || item.direction)) score += 8
  if (item.status) score += 2
  if (item.confirmations !== undefined) score += 1
  if (item.from || item.to) score += 1
  if (Array.isArray(item.subtransfers) && item.subtransfers.length > 0) score += 4
  if (Array.isArray(item.remote_addresses) && item.remote_addresses.length > 0) score += 1
  return score
}

const mergePrivacyTransactions = (primary?: unknown[], fallback?: unknown[]) => {
  const merged: unknown[] = []
  const seen = new Map<string, number>()
  for (const tx of [...(primary ?? []), ...(fallback ?? [])]) {
    const key = privacyTxKey(tx, merged.length)
    const existingIndex = seen.get(key)
    if (existingIndex !== undefined) {
      if (privacyTxRichness(tx) > privacyTxRichness(merged[existingIndex])) merged[existingIndex] = tx
      continue
    }
    seen.set(key, merged.length)
    merged.push(tx)
  }
  return merged
}

const zanoWithCachedHistory = (
  cached: { transactions?: unknown[]; lastScannedHeight?: number; scanState?: string } | null,
  response: PrivacyWalletResponse,
): PrivacyWalletResponse => {
  if (!cached || !response.ok || response.code !== 'zano-native-wallet') return response
  const mergedTransactions = mergePrivacyTransactions(response.transactions, cached.transactions)
  const responseTransactions = response.transactions ?? []
  const transactionsChanged = mergedTransactions.length !== responseTransactions.length
    || mergedTransactions.some((tx, index) => tx !== responseTransactions[index])
  if (!transactionsChanged) return response
  const cachedHeight = privacySnapshotHeight(cached)
  const responseHeight = privacySnapshotHeight(response)
  return {
    ...response,
    transactions: mergedTransactions,
    scanState: response.scanState || cached.scanState,
    lastScannedHeight: Math.max(responseHeight, cachedHeight) || response.lastScannedHeight || cached.lastScannedHeight,
  }
}

const runExclusive = async <T,>(coin: PrivacyCoin, task: () => Promise<T>, reason = 'native-call'): Promise<T> => {
  const previous = nativeCallQueues[coin] ?? Promise.resolve()
  const queueId = ++nativeQueueSeq
  const queuedAt = Date.now()
  const hadQueue = Boolean(nativeCallQueues[coin])
  coinDebugLog(coin, 'privacy.native.queue', {
    queueId,
    reason,
    hadQueue,
    readiness: nativeReadiness[coin],
  })
  const current = previous.catch(() => undefined).then(async () => {
    const startedAt = Date.now()
    coinDebugLog(coin, 'privacy.native.queue.start', {
      queueId,
      reason,
      waitMs: startedAt - queuedAt,
      readiness: nativeReadiness[coin],
    })
    try {
      const result = await task()
      coinDebugLog(coin, 'privacy.native.queue.done', {
        queueId,
        reason,
        waitMs: startedAt - queuedAt,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness[coin],
      })
      return result
    } catch (error) {
      coinDebugLogError(coin, 'privacy.native.queue.error', error, {
        queueId,
        reason,
        waitMs: startedAt - queuedAt,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness[coin],
      })
      throw error
    }
  })
  nativeCallQueues[coin] = current.catch(() => undefined)
  return current
}

const runPriorityExclusive = async <T,>(
  coin: PrivacyCoin,
  reason: string,
  task: () => Promise<T>,
): Promise<T> => {
  const hadSnapshot = Boolean(snapshotInFlight[coin])
  const hadQueue = Boolean(nativeCallQueues[coin])
  if (hadSnapshot || hadQueue) {
    coinDebugLog(coin, 'privacy.native.priority', { reason, hadSnapshot, hadQueue })
  }
  delete snapshotInFlight[coin]
  const queueId = ++nativeQueueSeq
  const startedAt = Date.now()
  coinDebugLog(coin, 'privacy.native.priority.start', {
    queueId,
    reason,
    readiness: nativeReadiness[coin],
  })
  const current = task()
    .then((result) => {
      coinDebugLog(coin, 'privacy.native.priority.done', {
        queueId,
        reason,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness[coin],
      })
      return result
    })
    .catch((error) => {
      coinDebugLogError(coin, 'privacy.native.priority.error', error, {
        queueId,
        reason,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness[coin],
      })
      throw error
    })
  nativeCallQueues[coin] = current.catch(() => undefined)
  return current
}

const setNativeReadiness = (coin: PrivacyCoin, readiness: NativeReadiness) => {
  if (nativeReadiness[coin] === readiness) return
  coinDebugLog(coin, 'privacy.readiness.change', {
    from: nativeReadiness[coin],
    to: readiness,
  })
  nativeReadiness[coin] = readiness
  for (const listener of readinessListeners) listener(coin, readiness)
}

const updateNativeReadiness = (
  coin: PrivacyCoin,
  response: PrivacyWalletResponse,
  source: NativeReadinessSource = 'snapshot',
) => {
  const code = response.code ?? ''
  const spendableReady = hasSpendableReady(response)
  const nativeBalanceReady = hasNativeBalanceReady(response)
  const lockedNativeBalanceReady = hasLockedNativeBalanceReady(response)
  coinDebugLog(coin, 'privacy.readiness.update', {
    before: nativeReadiness[coin],
    source,
    response: summarizePrivacyResponse(response),
    spendableReady,
    nativeBalanceReady,
    lockedNativeBalanceReady,
  })
  if (coin === 'zano') {
    if (
      response.ok
      && (code === 'zano-native-wallet' || code === 'zano-native-wallet-ready')
      && !nativeBalanceReady
    ) {
      setNativeReadiness(coin, 'syncing')
      return
    }
    if (
      nativeReadiness[coin] === 'ready'
      && (
        code === 'zano-native-wallet-syncing'
        || code === 'zano-native-wallet-warming'
        || code === 'zano-compact-scan'
        || code === 'zano-compact-scan-verified'
        || code === 'zano-compact-scan-needs-native'
      )
    ) {
      coinDebugLog(coin, 'privacy.readiness.keepReady', {
        source,
        response: summarizePrivacyResponse(response),
      })
      return
    }
    if (response.ok && code === 'zano-native-wallet-ready') setNativeReadiness(coin, 'ready')
    else if (
      response.ok
      && code === 'zano-native-wallet'
      && response.cacheHistoryRegression !== true
      && (source !== 'snapshot' || nativeBalanceReady)
    ) setNativeReadiness(coin, 'ready')
    else if (response.ok && code === 'zano-native-wallet' && source === 'snapshot') {
      if (nativeReadiness[coin] !== 'ready') setNativeReadiness(coin, 'syncing')
    }
    else if (
      response.cacheHistoryRegression === true
      || code === 'zano-native-wallet-syncing'
      || code === 'zano-native-wallet-warming'
      || code === 'zano-compact-scan-verified'
      || code === 'zano-compact-scan-needs-native'
    ) setNativeReadiness(coin, 'syncing')
    else if (!response.ok && code === 'zano-native-wallet-error') setNativeReadiness(coin, 'error')
  } else if (coin === 'epic') {
    if (response.ok && code === 'epic-native-wallet' && !nativeBalanceReady) {
      setNativeReadiness(coin, 'syncing')
    }
    else if (response.ok && code === 'epic-native-wallet') {
      setNativeReadiness(coin, 'ready')
    }
    else if (code === 'epic-native-wallet-syncing' || !response.ok && /sync|busy|node status/i.test(response.error ?? code)) {
      setNativeReadiness(coin, 'syncing')
    }
    else if (!response.ok && /not enough funds|insufficient/i.test(response.error ?? code)) {
      return
    }
    else if (!response.ok) {
      setNativeReadiness(coin, 'error')
    }
  }
}

const callNativeLightWallet = async (
  action: 'ensure' | 'warm' | 'snapshot' | 'send',
  coin: PrivacyCoin,
  body: Record<string, string | undefined> = {},
  onProgress?: (progress: NativePrivacyRecoveryProgress) => void,
) => {
  const callId = ++nativeCallSeq
  const callStartedAt = Date.now()
  const mnemonic = body.mnemonic
  const shouldLoadCache = Boolean(mnemonic)
  const cached = shouldLoadCache
    ? await privacyCacheService.load(coin, mnemonic as string).catch(() => null)
    : null
  const cachedRestoreStart = Number(cached?.restoreStartHeight ?? 0)
  const zanoCachedRestoreStart = coin === 'zano' ? zanoCachedRestoreStartFrom(cached) : undefined
  const shouldUseRestoreStartHeight = Boolean(body.mnemonic && (action === 'snapshot' || coin === 'zano'))
  const cachedRestoreStartHeight = Number.isFinite(cachedRestoreStart) && cachedRestoreStart > 0
    ? Math.floor(cachedRestoreStart)
    : undefined
  let restoreStartSource = 'not-used'
  let restoreStartHeight: number | undefined
  if (shouldUseRestoreStartHeight) {
    if (zanoCachedRestoreStart) {
      restoreStartHeight = zanoCachedRestoreStart
      restoreStartSource = 'zano-cache-scan-state'
    } else if (cachedRestoreStartHeight) {
      restoreStartHeight = cachedRestoreStartHeight
      restoreStartSource = 'cache-floor'
    } else if (coin === 'zano') {
      restoreStartSource = 'zano-default-compact-window'
    } else {
      restoreStartHeight = await privacyBirthService.restoreStartHeight(coin)
      restoreStartSource = 'birth-service'
    }
  }
  const scanState = coin === 'zano' && typeof cached?.scanState === 'string'
    ? cached.scanState
    : undefined
  const restoreTimestamp = coin === 'zano'
    ? zanoRestoreTimestampFromScanState(scanState)
    : undefined
  const cachedSpendable = Number.parseFloat(cached?.spendable ?? '0')
  const cachedBalance = Number.parseFloat(cached?.balance ?? '0')
  const zanoHasVerifiedNativeCache = coin === 'zano'
    && cached?.verifiedSpendState === true
    && Boolean(cached.nativeWalletFileBlob)
  const expectedSpendable = coin === 'zano'
    ? (Number.isFinite(cachedSpendable) && cachedSpendable > 0
      ? cached?.spendable
      : (Number.isFinite(cachedBalance) && cachedBalance > 0 ? cached?.balance : undefined))
    : undefined
  const defaultVerifyCompact = coin === 'zano'
    && action === 'snapshot'
    && nativeReadiness.zano !== 'ready'
    && !zanoHasVerifiedNativeCache
    ? 'true'
    : undefined
  const verifyCompact = coin === 'zano'
    ? body.verifyCompact ?? defaultVerifyCompact
    : undefined
  const fastCompact = coin === 'zano'
    && action === 'snapshot'
    && Boolean(scanState)
    && !cached?.nativeWalletFileBlob
    && nativeReadiness.zano !== 'ready'
    ? 'true'
    : undefined
  coinDebugLog(coin, 'privacy.native.start', {
    callId,
    action,
    hasMnemonic: Boolean(body.mnemonic),
    hasCachedSnapshot: Boolean(cached),
    cached: cached ? summarizePrivacyResponse({ ok: true, ...cached }) : null,
    restoreStartHeight,
    restoreStartSource,
    restoreTimestamp,
    expectedSpendable,
    verifyCompact,
    fastCompact,
    zanoHasVerifiedNativeCache,
    scanStateLength: scanState?.length ?? 0,
  })
  let response: PrivacyWalletResponse
  const progressKey = `${coin}:${callId}:${action}`
  try {
    response = await nativeCoreService.privacyLightWallet({
      action,
      coin,
      restoreStartHeight,
      restoreTimestamp,
      expectedSpendable,
      scanState,
      fastCompact,
      nativeWalletFileName: cached?.nativeWalletFileName,
      nativeWalletFileBlob: cached?.nativeWalletFileBlob,
      verifyCompact,
      ...body,
    }, (progress) => {
      if (shouldLogNativeProgress(progressKey, progress)) {
        coinDebugLog(coin, 'privacy.native.progress', {
          callId,
          action,
          elapsedMs: Date.now() - callStartedAt,
          progress: summarizeProgress(progress),
        })
      }
      onProgress?.(progress)
    })
  } catch (error) {
    coinDebugLogError(coin, 'privacy.native.throw', error, {
      callId,
      action,
      durationMs: Date.now() - callStartedAt,
    })
    throw error
  } finally {
    nativeProgressLogState.delete(progressKey)
  }
  const responseWithCachedHistory = coin === 'zano'
    ? zanoWithCachedHistory(cached, response)
    : response
  const cacheHistoryRegression = coin === 'zano'
    ? zanoNativeRegressesCachedHistory(cached, responseWithCachedHistory)
    : false
  coinDebugLog(coin, 'privacy.native.done', {
    callId,
    action,
    durationMs: Date.now() - callStartedAt,
    response: summarizePrivacyResponse({
      ...responseWithCachedHistory,
      cacheHistoryRegression,
    }),
  })
  const finalResponse: PrivacyWalletResponse = cacheHistoryRegression
    ? { ...responseWithCachedHistory, cacheHistoryRegression: true, error: responseWithCachedHistory.error || 'native-history-regression' }
    : responseWithCachedHistory
  return restoreStartHeight ? { ...finalResponse, restoreStartHeight } : finalResponse
}

const assertOk = (response: PrivacyWalletResponse) => {
  if (!response.ok) throw new Error(response.error || response.code || 'Local wallet engine error')
  return response
}

const startZanoReadinessPoll = (mnemonic: string) => {
  if (zanoReadinessPollActive || nativeReadiness.zano === 'ready') return
  zanoReadinessPollActive = true
  const token = ++zanoReadinessPollToken
  coinDebugLog('zano', 'privacy.zanoReadinessPoll.start', {
    token,
    readiness: nativeReadiness.zano,
  })

  void (async () => {
    for (let attempt = 0; attempt < ZANO_READINESS_POLL_ATTEMPTS; attempt += 1) {
      if (token !== zanoReadinessPollToken || nativeReadiness.zano === 'ready') {
        coinDebugLog('zano', 'privacy.zanoReadinessPoll.stop', {
          token,
          attempt,
          reason: token !== zanoReadinessPollToken ? 'token-replaced' : 'ready',
          readiness: nativeReadiness.zano,
        })
        return
      }
      try {
        const response = await runExclusive('zano', () => callNativeLightWallet('warm', 'zano', { mnemonic }), 'zano-readiness-poll:warm')
        updateNativeReadiness('zano', response, 'warm')
        coinDebugLog('zano', 'privacy.zanoReadinessPoll.attempt', {
          token,
          attempt,
          response: summarizePrivacyResponse(response),
          readiness: nativeReadiness.zano,
        })
        if (
          response.ok
          && response.code === 'zano-native-wallet'
          && response.cacheHistoryRegression !== true
          && hasNativeBalanceReady(response)
        ) {
          coinDebugLog('zano', 'privacy.zanoReadinessPoll.ready', {
            token,
            attempt,
            response: summarizePrivacyResponse(response),
          })
          return
        }
        if (response.ok && response.code === 'zano-native-wallet-ready') {
          const snapshot = await runExclusive('zano', () => callNativeLightWallet('snapshot', 'zano', { mnemonic, verifyCompact: 'false' }), 'zano-readiness-poll:snapshot')
          updateNativeReadiness('zano', snapshot, 'warm')
          void privacyCacheService.saveFromSnapshot('zano', mnemonic, snapshot)
          coinDebugLog('zano', 'privacy.zanoReadinessPoll.snapshot', {
            token,
            attempt,
            snapshot: summarizePrivacyResponse(snapshot),
            readiness: nativeReadiness.zano,
          })
          if (
            snapshot.ok
            && snapshot.code === 'zano-native-wallet'
            && snapshot.cacheHistoryRegression !== true
            && hasNativeBalanceReady(snapshot)
          ) {
            coinDebugLog('zano', 'privacy.zanoReadinessPoll.ready', {
              token,
              attempt,
              response: summarizePrivacyResponse(snapshot),
            })
            return
          }
        }
      } catch (error) {
        coinDebugLogError('zano', 'privacy.zanoReadinessPoll.error', error, {
          token,
          attempt,
          readiness: nativeReadiness.zano,
        })
        setNativeReadiness('zano', 'syncing')
      }
      await sleep(ZANO_READINESS_POLL_INTERVAL_MS)
    }
    coinDebugLog('zano', 'privacy.zanoReadinessPoll.exhausted', {
      token,
      attempts: ZANO_READINESS_POLL_ATTEMPTS,
      readiness: nativeReadiness.zano,
    })
  })().finally(() => {
    if (token === zanoReadinessPollToken) {
      zanoReadinessPollActive = false
      coinDebugLog('zano', 'privacy.zanoReadinessPoll.finally', {
        token,
        readiness: nativeReadiness.zano,
      })
    }
  })
}

const stopZanoReadinessPoll = () => {
  zanoReadinessPollToken += 1
  zanoReadinessPollActive = false
}

export const privacyWalletService = {
  async getCachedSnapshot(coin: PrivacyCoin, mnemonic: string): Promise<PrivacyWalletResponse | null> {
    const cached = await privacyCacheService.load(coin, mnemonic)
    if (!cached) return null
    return {
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
    }
  },

  async ensureWallet(coin: PrivacyCoin, mnemonic: string) {
    const response = await runExclusive(coin, () => callNativeLightWallet('ensure', coin, { mnemonic }), 'ensure')
    if (!response.ok) updateNativeReadiness(coin, response, 'ensure')
    return response
  },

  async warmWallet(coin: PrivacyCoin, mnemonic: string) {
    const warmStartedAt = Date.now()
    const epoch = nativeReadinessEpoch
    coinDebugLog(coin, 'privacy.warm.start', {
      epoch,
      readiness: nativeReadiness[coin],
    })
    if (nativeReadiness[coin] !== 'ready') setNativeReadiness(coin, 'syncing')
    if (coin === 'epic') {
      const response = await runExclusive(coin, () => callNativeLightWallet('snapshot', coin, { mnemonic }), 'warm:snapshot')
      if (epoch !== nativeReadinessEpoch) return response
      updateNativeReadiness(coin, response, 'warm')
      void privacyCacheService.saveFromSnapshot(coin, mnemonic, response)
      coinDebugLog(coin, 'privacy.warm.done', {
        epoch,
        durationMs: Date.now() - warmStartedAt,
        response: summarizePrivacyResponse(response),
        readiness: nativeReadiness[coin],
      })
      return response
    }
    const response = await runExclusive(coin, () => callNativeLightWallet('warm', coin, { mnemonic }), 'warm')
    if (epoch !== nativeReadinessEpoch) return response
    updateNativeReadiness(coin, response, 'warm')
    if (coin === 'zano' && response.ok && response.code === 'zano-native-wallet-ready') {
      const snapshot = await runExclusive('zano', () => callNativeLightWallet('snapshot', 'zano', { mnemonic, verifyCompact: 'false' }), 'warm:ready-snapshot')
      if (epoch !== nativeReadinessEpoch) return snapshot
      updateNativeReadiness('zano', snapshot, 'warm')
      void privacyCacheService.saveFromSnapshot('zano', mnemonic, snapshot)
      if (!(
        snapshot.ok
        && snapshot.code === 'zano-native-wallet'
        && snapshot.cacheHistoryRegression !== true
        && hasNativeBalanceReady(snapshot)
      )) {
        setNativeReadiness('zano', 'syncing')
        startZanoReadinessPoll(mnemonic)
      }
      coinDebugLog(coin, 'privacy.warm.done', {
        epoch,
        durationMs: Date.now() - warmStartedAt,
        response: summarizePrivacyResponse(snapshot),
        readiness: nativeReadiness[coin],
      })
      return snapshot
    }
    if (coin === 'zano' && !(
      response.ok
      && response.code === 'zano-native-wallet'
      && response.cacheHistoryRegression !== true
      && hasNativeBalanceReady(response)
    )) {
      setNativeReadiness('zano', 'syncing')
      startZanoReadinessPoll(mnemonic)
    }
    coinDebugLog(coin, 'privacy.warm.done', {
      epoch,
      durationMs: Date.now() - warmStartedAt,
      response: summarizePrivacyResponse(response),
      readiness: nativeReadiness[coin],
    })
    return response
  },

  async getSnapshot(coin: PrivacyCoin, mnemonic?: string, onProgress?: (progress: NativePrivacyRecoveryProgress) => void) {
    if (!mnemonic) return callNativeLightWallet('snapshot', coin, { mnemonic }, onProgress)
    if (nativeReadiness[coin] !== 'ready') setNativeReadiness(coin, 'syncing')

    const existing = snapshotInFlight[coin]
    if (existing?.mnemonic === mnemonic) {
      coinDebugLog(coin, 'privacy.snapshot.reuseInFlight', {
        listenerAdded: Boolean(onProgress),
        readiness: nativeReadiness[coin],
      })
      if (onProgress) existing.listeners.add(onProgress)
      return existing.promise.finally(() => {
        if (onProgress) existing.listeners.delete(onProgress)
      })
    }

    const listeners = new Set<(progress: NativePrivacyRecoveryProgress) => void>()
    if (onProgress) listeners.add(onProgress)

    const task = async () => {
      const response = await callNativeLightWallet('snapshot', coin, { mnemonic }, (progress) => {
        for (const listener of listeners) listener(progress)
      })
      if (snapshotInFlight[coin]?.mnemonic === mnemonic) {
        updateNativeReadiness(coin, response, 'snapshot')
        if (
          coin === 'zano'
          && (
            response.code === 'zano-compact-scan'
            || response.code === 'zano-compact-scan-verified'
            || response.code === 'zano-compact-scan-needs-native'
            || response.code === 'zano-native-wallet-syncing'
            || (response.code === 'zano-native-wallet' && !hasNativeBalanceReady(response))
          )
        ) startZanoReadinessPoll(mnemonic)
        void privacyCacheService.saveFromSnapshot(coin, mnemonic, response)
      }
      return response
    }
    const promise = runExclusive(coin, task, 'snapshot').finally(() => {
        if (snapshotInFlight[coin]?.mnemonic === mnemonic) delete snapshotInFlight[coin]
        listeners.clear()
      })

    snapshotInFlight[coin] = { promise, listeners, mnemonic }
    return promise
  },

  async rescan(
    coin: PrivacyCoin,
    mnemonic: string,
    fromHeight: number,
    onProgress?: (progress: NativePrivacyRecoveryProgress) => void,
  ) {
    const restoreStartHeight = Math.max(0, Math.floor(fromHeight))
    if (!Number.isFinite(restoreStartHeight)) throw new Error('Invalid rescan height')
    setNativeReadiness(coin, 'syncing')
    if (coin === 'zano') stopZanoReadinessPoll()
    delete snapshotInFlight[coin]
    const response = await runPriorityExclusive(coin, 'manual-rescan', () => callNativeLightWallet('snapshot', coin, {
      mnemonic,
      restoreStartHeight: String(restoreStartHeight),
      restoreTimestamp: '',
      expectedSpendable: '',
      fastCompact: coin === 'zano' ? 'true' : undefined,
      compactOnly: coin === 'zano' ? 'true' : undefined,
      forceRescan: coin === 'zano' ? 'true' : undefined,
      verifyCompact: coin === 'zano' ? 'true' : undefined,
      nativeWalletFileName: '',
      nativeWalletFileBlob: '',
    }, onProgress))
    const finalResponse = { ...response, restoreStartHeight }
    updateNativeReadiness(coin, finalResponse, 'snapshot')
    if (
      coin === 'zano'
      && (
        finalResponse.code === 'zano-compact-scan'
        || finalResponse.code === 'zano-compact-scan-verified'
        || finalResponse.code === 'zano-compact-scan-needs-native'
        || finalResponse.code === 'zano-native-wallet-syncing'
      )
    ) startZanoReadinessPoll(mnemonic)
    if (finalResponse.ok) {
      await privacyCacheService.saveFromSnapshot(coin, mnemonic, finalResponse, { force: true })
    }
    return assertOk(finalResponse)
  },

  async send(coin: PrivacyCoin, mnemonic: string, to: string, amount: string, fee?: string, memo?: string, sendMax?: boolean) {
    const sendTask = () => callNativeLightWallet('send', coin, {
      mnemonic,
      to,
      amount,
      fee,
      memo,
      sendMax: sendMax ? 'true' : undefined,
    })
    const response = coin === 'epic' || coin === 'zano'
      ? await runPriorityExclusive(coin, 'send', sendTask)
      : await runExclusive(coin, sendTask, 'send')
    if (response.ok || coin !== 'epic') {
      updateNativeReadiness(coin, response, 'send')
    } else {
      coinDebugLog(coin, 'privacy.send.skipReadinessUpdate', {
        response: summarizePrivacyResponse(response),
      })
    }
    if (response.ok && response.nativeWalletFileBlob) {
      await privacyCacheService.saveFromSnapshot(coin, mnemonic, response).catch((error) => {
        coinDebugLogError(coin, 'privacy.send.cacheSave.error', error, {
          response: summarizePrivacyResponse(response),
        })
      })
    }
    return assertOk(response)
  },

  getNativeReadiness(coin: PrivacyCoin) {
    return nativeReadiness[coin]
  },

  onNativeReadinessChange(listener: (coin: PrivacyCoin, readiness: NativeReadiness) => void) {
    readinessListeners.add(listener)
    return () => readinessListeners.delete(listener)
  },

  resetNativeReadiness(coin?: PrivacyCoin) {
    nativeReadinessEpoch += 1
    if (coin) {
      if (coin === 'zano') stopZanoReadinessPoll()
      delete snapshotInFlight[coin]
      delete nativeCallQueues[coin]
      for (const key of [...nativeProgressLogState.keys()]) {
        if (key.startsWith(`${coin}:`)) nativeProgressLogState.delete(key)
      }
      setNativeReadiness(coin, 'unknown')
      return
    }
    stopZanoReadinessPoll()
    delete snapshotInFlight.zano
    delete snapshotInFlight.epic
    delete nativeCallQueues.zano
    delete nativeCallQueues.epic
    nativeProgressLogState.clear()
    setNativeReadiness('zano', 'unknown')
    setNativeReadiness('epic', 'unknown')
  },
}

export type { PrivacyCoin, PrivacyWalletResponse, NativePrivacyRecoveryProgress, NativeReadiness }
