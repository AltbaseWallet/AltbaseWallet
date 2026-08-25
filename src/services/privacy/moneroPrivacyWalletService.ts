import { nativeCoreService } from '../nativeCoreService'
import { privacyBirthService } from '../privacyBirthService'
import { privacyCacheService } from '../privacyCacheService'
import type {
  NativePrivacyRecoveryProgress,
  NativeReadiness,
  PrivacyCoinWalletService,
  PrivacyReadinessListener,
  PrivacyWalletResponse,
} from '../privacyWalletTypes'
import { coinDebugLog, coinDebugLogError } from '../../utils/quaiDebugLog'
import {
  assertOk,
  cachedSnapshotResponse,
  hasNativeBalanceReady,
  shouldLogNativeProgress,
  summarizePrivacyResponse,
  summarizeProgress,
  type NativeProgressLogState,
} from './privacyWalletCommon'

const COIN = 'monero' as const

type SnapshotInFlight = {
  promise: Promise<PrivacyWalletResponse>
  listeners: Set<(progress: NativePrivacyRecoveryProgress) => void>
  mnemonic: string
}

let snapshotInFlight: SnapshotInFlight | undefined
let nativeCallQueue: Promise<unknown> | undefined
let checkpointSaveQueue: Promise<void> = Promise.resolve()
let nativeReadiness: NativeReadiness = 'unknown'
let readinessEpoch = 0
let nativeCallSeq = 0
let nativeQueueSeq = 0
const readinessListeners = new Set<PrivacyReadinessListener>()
const nativeProgressLogState: NativeProgressLogState = new Map()

const setNativeReadiness = (readiness: NativeReadiness) => {
  if (nativeReadiness === readiness) return
  coinDebugLog(COIN, 'privacy.readiness.change', { from: nativeReadiness, to: readiness })
  nativeReadiness = readiness
  for (const listener of readinessListeners) listener(COIN, readiness)
}

const updateNativeReadiness = (response: PrivacyWalletResponse) => {
  const code = response.code ?? ''
  const nativeBalanceReady = hasNativeBalanceReady(response, 'monero-native-wallet')
  coinDebugLog(COIN, 'privacy.readiness.update', {
    before: nativeReadiness,
    response: summarizePrivacyResponse(response),
    nativeBalanceReady,
  })
  if (nativeReadiness === 'ready') return
  if (response.ok && code === 'monero-native-wallet' && nativeBalanceReady) {
    setNativeReadiness('ready')
  } else if (code === 'monero-native-wallet-syncing' || (!response.ok && /sync|busy|node status/i.test(response.error ?? code))) {
    setNativeReadiness('syncing')
  } else if (!response.ok && /not enough funds|insufficient/i.test(response.error ?? code)) {
    return
  } else if (!response.ok) {
    setNativeReadiness('error')
  }
}

const queueCheckpointSave = (
  mnemonic: string,
  restoreStartHeight: number | undefined,
  progress: NativePrivacyRecoveryProgress,
) => {
  const checkpoint = progress.checkpoint
  if (!checkpoint?.address || !checkpoint.scanState || checkpoint.lastScannedHeight <= 0) return
  const checkpointCode = progress.blocksRemaining <= 0
    ? 'monero-native-wallet'
    : 'monero-native-wallet-syncing'
  checkpointSaveQueue = checkpointSaveQueue
    .catch(() => undefined)
    .then(() => privacyCacheService.saveFromSnapshot(COIN, mnemonic, {
      ok: true,
      code: checkpointCode,
      restoreStartHeight,
      ...checkpoint,
    }, { force: true }))
    .catch((error) => {
      coinDebugLogError(COIN, 'privacy.checkpoint.save.error', error, {
        lastScannedHeight: checkpoint.lastScannedHeight,
      })
    })
}

const runExclusive = async <T,>(task: () => Promise<T>, reason: string): Promise<T> => {
  const previous = nativeCallQueue ?? Promise.resolve()
  const queueId = ++nativeQueueSeq
  const queuedAt = Date.now()
  const hadQueue = Boolean(nativeCallQueue)
  coinDebugLog(COIN, 'privacy.native.queue', { queueId, reason, hadQueue, readiness: nativeReadiness })
  const current = previous.catch(() => undefined).then(async () => {
    const startedAt = Date.now()
    coinDebugLog(COIN, 'privacy.native.queue.start', {
      queueId,
      reason,
      waitMs: startedAt - queuedAt,
      readiness: nativeReadiness,
    })
    try {
      const result = await task()
      coinDebugLog(COIN, 'privacy.native.queue.done', {
        queueId,
        reason,
        waitMs: startedAt - queuedAt,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness,
      })
      return result
    } catch (error) {
      coinDebugLogError(COIN, 'privacy.native.queue.error', error, {
        queueId,
        reason,
        waitMs: startedAt - queuedAt,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness,
      })
      throw error
    }
  })
  nativeCallQueue = current.catch(() => undefined)
  return current
}

const runPriorityExclusive = async <T,>(reason: string, task: () => Promise<T>): Promise<T> => {
  const hadSnapshot = Boolean(snapshotInFlight)
  const hadQueue = Boolean(nativeCallQueue)
  if (hadSnapshot || hadQueue) coinDebugLog(COIN, 'privacy.native.priority', { reason, hadSnapshot, hadQueue })
  snapshotInFlight = undefined
  const queueId = ++nativeQueueSeq
  const startedAt = Date.now()
  coinDebugLog(COIN, 'privacy.native.priority.start', { queueId, reason, readiness: nativeReadiness })
  const current = task()
    .then((result) => {
      coinDebugLog(COIN, 'privacy.native.priority.done', {
        queueId,
        reason,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness,
      })
      return result
    })
    .catch((error) => {
      coinDebugLogError(COIN, 'privacy.native.priority.error', error, {
        queueId,
        reason,
        durationMs: Date.now() - startedAt,
        readiness: nativeReadiness,
      })
      throw error
    })
  nativeCallQueue = current.catch(() => undefined)
  return current
}

const callNativeLightWallet = async (
  action: 'ensure' | 'warm' | 'snapshot' | 'send',
  body: Record<string, string | undefined> = {},
  onProgress?: (progress: NativePrivacyRecoveryProgress) => void,
): Promise<PrivacyWalletResponse> => {
  const callId = ++nativeCallSeq
  const callStartedAt = Date.now()
  const mnemonic = body.mnemonic
  const cached = mnemonic
    ? await privacyCacheService.load(COIN, mnemonic).catch(() => null)
    : null
  const cachedRestoreStart = Number(cached?.restoreStartHeight ?? 0)
  const cachedRestoreStartHeight = Number.isFinite(cachedRestoreStart) && cachedRestoreStart > 0
    ? Math.floor(cachedRestoreStart)
    : undefined
  let restoreStartHeight: number | undefined
  let restoreStartSource = 'not-used'
  if (mnemonic) {
    if (cachedRestoreStartHeight) {
      restoreStartHeight = cachedRestoreStartHeight
      restoreStartSource = 'cache-floor'
    } else {
      restoreStartHeight = await privacyBirthService.restoreStartHeight(COIN)
      restoreStartSource = 'birth-service'
    }
  }
  const scanState = typeof cached?.scanState === 'string' ? cached.scanState : undefined
  coinDebugLog(COIN, 'privacy.native.start', {
    callId,
    action,
    hasMnemonic: Boolean(mnemonic),
    hasCachedSnapshot: Boolean(cached),
    cached: cached ? summarizePrivacyResponse({ ok: true, ...cached }) : null,
    restoreStartHeight,
    restoreStartSource,
    scanStateLength: scanState?.length ?? 0,
  })
  const progressKey = `${COIN}:${callId}:${action}`
  try {
    const response = await nativeCoreService.privacyLightWallet({
      action,
      coin: COIN,
      restoreStartHeight,
      scanState,
      cachedWalletName: cached?.nativeWalletFileName,
      cachedWalletState: cached?.nativeWalletFileBlob,
      ...body,
    }, (progress) => {
      if (shouldLogNativeProgress(nativeProgressLogState, progressKey, progress)) {
        coinDebugLog(COIN, 'privacy.native.progress', {
          callId,
          action,
          elapsedMs: Date.now() - callStartedAt,
          progress: summarizeProgress(progress),
        })
      }
      if (mnemonic) queueCheckpointSave(mnemonic, restoreStartHeight, progress)
      onProgress?.(progress)
    })
    if (mnemonic) await checkpointSaveQueue
    coinDebugLog(COIN, 'privacy.native.done', {
      callId,
      action,
      durationMs: Date.now() - callStartedAt,
      response: summarizePrivacyResponse(response),
    })
    return restoreStartHeight ? { ...response, restoreStartHeight } : response
  } catch (error) {
    coinDebugLogError(COIN, 'privacy.native.throw', error, {
      callId,
      action,
      durationMs: Date.now() - callStartedAt,
    })
    throw error
  } finally {
    nativeProgressLogState.delete(progressKey)
  }
}

const getOrStartSnapshot = (
  mnemonic: string,
  onProgress: ((progress: NativePrivacyRecoveryProgress) => void) | undefined,
  reason: string,
) => {
  if (nativeReadiness !== 'ready') setNativeReadiness('syncing')
  if (snapshotInFlight?.mnemonic === mnemonic) {
    if (onProgress) snapshotInFlight.listeners.add(onProgress)
    return snapshotInFlight.promise.finally(() => {
      if (onProgress) snapshotInFlight?.listeners.delete(onProgress)
    })
  }
  const listeners = new Set<(progress: NativePrivacyRecoveryProgress) => void>()
  if (onProgress) listeners.add(onProgress)
  const task = async () => {
    const response = await callNativeLightWallet('snapshot', { mnemonic }, (progress) => {
      for (const listener of listeners) listener(progress)
    })
    if (snapshotInFlight?.mnemonic === mnemonic) {
      updateNativeReadiness(response)
      await privacyCacheService.saveFromSnapshot(COIN, mnemonic, response, { force: true })
    }
    return response
  }
  const promise = runExclusive(task, reason).finally(() => {
    if (snapshotInFlight?.mnemonic === mnemonic) snapshotInFlight = undefined
    listeners.clear()
  })
  snapshotInFlight = { promise, listeners, mnemonic }
  return promise
}

export const moneroPrivacyWalletService: PrivacyCoinWalletService = {
  async getCachedSnapshot(mnemonic) {
    const cached = await privacyCacheService.load(COIN, mnemonic)
    return cached ? cachedSnapshotResponse(COIN, cached) : null
  },

  async ensureWallet(mnemonic) {
    const response = await runExclusive(() => callNativeLightWallet('ensure', { mnemonic }), 'ensure')
    updateNativeReadiness(response)
    return response
  },

  async warmWallet(mnemonic) {
    const startedAt = Date.now()
    const epoch = readinessEpoch
    coinDebugLog(COIN, 'privacy.warm.start', { epoch, readiness: nativeReadiness })
    const response = await getOrStartSnapshot(mnemonic, undefined, 'warm:snapshot')
    if (epoch !== readinessEpoch) return response
    coinDebugLog(COIN, 'privacy.warm.done', {
      epoch,
      durationMs: Date.now() - startedAt,
      response: summarizePrivacyResponse(response),
      readiness: nativeReadiness,
    })
    return response
  },

  async getSnapshot(mnemonic, onProgress) {
    if (!mnemonic) return callNativeLightWallet('snapshot', {}, onProgress)
    return getOrStartSnapshot(mnemonic, onProgress, 'snapshot')
  },

  async rescan(mnemonic, fromHeight, onProgress) {
    const restoreStartHeight = Math.max(0, Math.floor(fromHeight))
    if (!Number.isFinite(restoreStartHeight)) throw new Error('Invalid rescan height')
    setNativeReadiness('syncing')
    snapshotInFlight = undefined
    const response = await runPriorityExclusive('manual-rescan', () => callNativeLightWallet('snapshot', {
      mnemonic,
      restoreStartHeight: String(restoreStartHeight),
      cachedWalletName: '',
      cachedWalletState: '',
      scanState: '',
    }, onProgress))
    const finalResponse = { ...response, restoreStartHeight }
    updateNativeReadiness(finalResponse)
    if (finalResponse.ok) await privacyCacheService.saveFromSnapshot(COIN, mnemonic, finalResponse, { force: true })
    return assertOk(finalResponse)
  },

  async send(mnemonic, to, amount, fee, memo, sendMax) {
    const sendTask = async () => {
      const preflight = assertOk(await callNativeLightWallet('snapshot', { mnemonic }))
      updateNativeReadiness(preflight)
      await privacyCacheService.saveFromSnapshot(COIN, mnemonic, preflight, { force: true })
      return callNativeLightWallet('send', {
        mnemonic,
        to,
        amount,
        fee,
        memo,
        sendMax: sendMax ? 'true' : undefined,
        scanState: preflight.scanState,
      })
    }
    const response = await runPriorityExclusive('send', sendTask)
    if (response.ok) updateNativeReadiness(response)
    if (response.ok && response.nativeWalletFileBlob) {
      await privacyCacheService.saveFromSnapshot(COIN, mnemonic, response).catch((error) => {
        coinDebugLogError(COIN, 'privacy.send.cacheSave.error', error, {
          response: summarizePrivacyResponse(response),
        })
      })
    }
    return assertOk(response)
  },

  getNativeReadiness() {
    return nativeReadiness
  },

  onNativeReadinessChange(listener) {
    readinessListeners.add(listener)
    return () => readinessListeners.delete(listener)
  },

  resetNativeReadiness() {
    readinessEpoch += 1
    snapshotInFlight = undefined
    nativeCallQueue = undefined
    nativeProgressLogState.clear()
    checkpointSaveQueue = Promise.resolve()
    setNativeReadiness('unknown')
  },
}
