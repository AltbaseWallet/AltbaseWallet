import { coinApiService } from './coinApiService'
import { storageService } from './storageService'
import { getWalletStorageScope } from './walletScopeService'

export type PrivacyBirthCoin = 'epic' | 'zano'

type WalletOrigin = {
  mode: 'created' | 'restored'
  capturedAt: string
}

type PrivacyBirthRecord = {
  height: number
  capturedAt: string
  source: 'created-network' | 'first-use-network' | 'altbase-support-floor'
}

type PrivacyBirthState = Partial<Record<PrivacyBirthCoin, PrivacyBirthRecord>>
type PrivacyRecoveryState = Partial<Record<PrivacyBirthCoin, boolean>>

const ORIGIN_KEY = 'wallet-origin'
const BIRTH_KEY = 'wallet-privacy-birth'
const RECOVERY_KEY = 'wallet-privacy-recovery'

const SUPPORT_FLOOR_HEIGHTS: Record<PrivacyBirthCoin, number> = {
  epic: 3_540_000,
  zano: 3_695_000,
}

const BIRTH_SAFETY_BLOCKS: Record<PrivacyBirthCoin, number> = {
  epic: 30,
  zano: 30,
}

const scopedKey = (key: string, scope = getWalletStorageScope()) => `${key}:${scope}`

const removeLegacyUnscopedState = () => {
  storageService.remove(BIRTH_KEY)
  storageService.remove(RECOVERY_KEY)
  storageService.remove(ORIGIN_KEY)
}

const readBirthState = (scope = getWalletStorageScope()) => storageService.get<PrivacyBirthState>(scopedKey(BIRTH_KEY, scope), {})
const readRecoveryState = (scope = getWalletStorageScope()) => storageService.get<PrivacyRecoveryState>(scopedKey(RECOVERY_KEY, scope), {})

const writeBirthRecord = (coin: PrivacyBirthCoin, record: PrivacyBirthRecord, scope = getWalletStorageScope()) => {
  storageService.set<PrivacyBirthState>(scopedKey(BIRTH_KEY, scope), {
    ...readBirthState(scope),
    [coin]: record,
  })
}

const captureNetworkBirthHeight = async (
  coin: PrivacyBirthCoin,
  source: PrivacyBirthRecord['source'],
  scope = getWalletStorageScope(),
): Promise<number | null> => {
  try {
    const network = await coinApiService.getNetwork(coin)
    const blocks = Number(network.blocks ?? 0)
    if (!Number.isFinite(blocks) || blocks <= 0) return null
    const height = Math.max(SUPPORT_FLOOR_HEIGHTS[coin], Math.floor(blocks) - BIRTH_SAFETY_BLOCKS[coin])
    writeBirthRecord(coin, {
      height,
      capturedAt: new Date().toISOString(),
      source,
    }, scope)
    return height
  } catch {
    return null
  }
}

export const privacyBirthService = {
  markCreatedWallet() {
    const scope = getWalletStorageScope()
    removeLegacyUnscopedState()
    storageService.remove(scopedKey(BIRTH_KEY, scope))
    storageService.remove(scopedKey(RECOVERY_KEY, scope))
    storageService.set<WalletOrigin>(scopedKey(ORIGIN_KEY, scope), {
      mode: 'created',
      capturedAt: new Date().toISOString(),
    })
    void captureNetworkBirthHeight('epic', 'created-network', scope)
    void captureNetworkBirthHeight('zano', 'created-network', scope)
  },

  markRestoredWallet() {
    const scope = getWalletStorageScope()
    removeLegacyUnscopedState()
    storageService.remove(scopedKey(BIRTH_KEY, scope))
    storageService.set<PrivacyRecoveryState>(scopedKey(RECOVERY_KEY, scope), {
      epic: true,
      zano: true,
    })
    storageService.set<WalletOrigin>(scopedKey(ORIGIN_KEY, scope), {
      mode: 'restored',
      capturedAt: new Date().toISOString(),
    })
  },

  async restoreStartHeight(coin: PrivacyBirthCoin) {
    const scope = getWalletStorageScope()
    const existing = readBirthState(scope)[coin]
    if (existing && Number.isFinite(existing.height) && existing.height > 0) return existing.height

    const origin = storageService.get<WalletOrigin | null>(scopedKey(ORIGIN_KEY, scope), null)
    if (origin?.mode === 'created') {
      const captured = await captureNetworkBirthHeight(coin, 'first-use-network', scope)
      if (captured) return captured
    }

    return SUPPORT_FLOOR_HEIGHTS[coin]
  },

  setManualRestoreStartHeight(coin: PrivacyBirthCoin, height: number) {
    const normalized = Math.max(SUPPORT_FLOOR_HEIGHTS[coin], Math.floor(height))
    writeBirthRecord(coin, {
      height: normalized,
      capturedAt: new Date().toISOString(),
      source: 'first-use-network',
    })
    return normalized
  },

  isRecoveryPending(coin: PrivacyBirthCoin) {
    return readRecoveryState()[coin] === true
  },

  markRecoveryComplete(coin: PrivacyBirthCoin) {
    const scope = getWalletStorageScope()
    const next = {
      ...readRecoveryState(scope),
      [coin]: false,
    }
    storageService.set<PrivacyRecoveryState>(scopedKey(RECOVERY_KEY, scope), next)
  },
}
