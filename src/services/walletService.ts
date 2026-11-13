import { pluginReadiness } from './pluginReadiness'
import { normalizeSeedPhrase } from '../utils/validateSeedPhrase'
import { allCoins } from './coinService'
import { nativeCoreService, type NativeWalletSecretOptions } from './nativeCoreService'
import { privacyWalletService, type PrivacyCoin } from './privacyWalletService'
import { privacyBirthService } from './privacyBirthService'
import { storageService } from './storageService'
import { getWalletStorageScope, walletFingerprintFromMnemonic } from './walletScopeService'
import { buildWalletLoadProgress, type WalletLoadProgressHandler } from '../types/walletLoadProgress'
import { walletEngineRegistry } from '../wallet-engines/registry'
import { coinDebugLog, coinDebugLogError } from '../utils/quaiDebugLog'

const WALLET_KEY = 'wallet-meta'
const WALLET_ADDRESSES_KEY = 'wallet-addresses'
let sessionMnemonicCache: string | null = null
let pendingWalletSetupId = 0
let walletSessionRevision = 0
const pendingPublicAddressRequests = new Map<string, Promise<string | undefined>>()
const STANDARD_ADDRESS_DERIVATION_TIMEOUT_MS = 20_000
const STANDARD_ADDRESS_RETRY_DELAY_MS = 5_000
const ALWAYS_REDERIVE_STANDARD_COIN_IDS = new Set([
  'xelis',
  'mwc',
  'bitcoin',
  'bitcoincashii',
  'firo',
  'junkcoin',
  'litecoinii',
  'pepecoin',
  'scash',
])

type EncryptedSecret = {
  cipherText: string
  iv: string
  salt: string
}

type LegacyWalletMeta = {
  isCreated: boolean
  passwordHash: string
  encryptedMnemonic?: EncryptedSecret
  version?: undefined
}

type WalletMetaV2 = {
  isCreated: boolean
  version: 2
  verifyHash: string
  verifySalt: string
  walletFingerprint?: string
  encryptedMnemonic: EncryptedSecret
}

type WalletMeta = WalletMetaV2 | LegacyWalletMeta

type PendingWalletSetup = {
  id: number
  mnemonic: string
  password: string
  seedSafetyAcknowledged: boolean
}

let pendingWalletSetup: PendingWalletSetup | null = null

const bumpWalletSessionRevision = () => {
  pluginReadiness.reset()
  pendingPublicAddressRequests.clear()
  walletSessionRevision += 1
  return walletSessionRevision
}
const assertCurrentSession = (revision: number) => {
  if (revision !== walletSessionRevision) throw new Error('Wallet session changed')
}

/**
 * Map of coinId → derived P2PKH address. The wallet builds it once on unlock
 * (or wallet creation/restore) from the mnemonic + each coin's cryptoParams.
 * Keys are open-ended on purpose so adding a new coin only requires updating
 * the catalog in `coinService.ts`.
 */
export type WalletAddresses = Record<string, string | undefined>

const privacyCoins = () =>
  allCoins().filter((coin) => coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light' || coin.walletEngine === 'monero-light')

const withTimeout = <T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    operation.then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer)
        reject(error)
      },
    )
  })

const deriveStandardCoinAddresses = async (
  mnemonic: string,
  previous: WalletAddresses = {},
): Promise<WalletAddresses> => {
  const coinsToDerive = allCoins().filter((coin) =>
    walletEngineRegistry.kindOf(coin) !== 'privacy'
      && (!previous[coin.id] || coin.walletEngine === 'plugin' || ALWAYS_REDERIVE_STANDARD_COIN_IDS.has(coin.id)),
  )
  if (coinsToDerive.length === 0) return {}

  // Derive every coin's address in parallel — they're independent computations.
  const results = await Promise.all(
    coinsToDerive.map(async (coin) => {
      const startedAt = Date.now()
      try {
        const deriveAddress = walletEngineRegistry.get(coin).deriveAddress
        const addr = deriveAddress
          ? await withTimeout(
              Promise.resolve(deriveAddress(coin, mnemonic)),
              STANDARD_ADDRESS_DERIVATION_TIMEOUT_MS,
              `${coin.id} address derivation`,
            )
          : undefined
        coinDebugLog(coin.id, 'wallet.address.derive.done', {
          durationMs: Date.now() - startedAt,
          hasAddress: Boolean(addr),
        })
        return [coin.id, addr] as const
      } catch (error) {
        coinDebugLogError(coin.id, 'wallet.address.derive.error', error, {
          durationMs: Date.now() - startedAt,
        })
        return [coin.id, undefined] as const
      }
    }),
  )
  const map: WalletAddresses = {}
  for (const [id, addr] of results) if (addr) map[id] = addr

  return map
}

const refreshPrivacyAddresses = async (mnemonic: string): Promise<WalletAddresses> => {
  const revision = walletSessionRevision
  await Promise.all(
    privacyCoins().map(async (coin) => {
      try {
        const result = await privacyWalletService.ensureWallet(coin.id as PrivacyCoin, mnemonic)
        if (!result.address || revision !== walletSessionRevision || sessionMnemonicCache !== mnemonic) return
        // Publish each deterministic address immediately. An unrelated slow
        // privacy scan must not hold every coin's receive address hostage.
        const current = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
        if (current[coin.id] !== result.address) storageService.set(WALLET_ADDRESSES_KEY, { ...current, [coin.id]: result.address })
      } catch {
        // Another coin's address can still become available independently.
      }
    }),
  )
  return storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
}

const refreshPrivacyAddressesInBackground = (mnemonic: string) => {
  void refreshPrivacyAddresses(mnemonic).catch(() => undefined)
}

const buildWalletMeta = async (
  mnemonic: string,
  password: string,
  options: NativeWalletSecretOptions = {},
): Promise<WalletMetaV2> => {
  const secret = await nativeCoreService.createWalletSecret(mnemonic, password, options)
  const walletFingerprint = await walletFingerprintFromMnemonic(mnemonic)

  // Roundtrip integrity check — guarantees the stored data can actually be unlocked.
  // Catches silent encryption issues (Buffer polyfill quirks, encoding mismatches, etc).
  const restored = await nativeCoreService.decryptWalletSecret(secret.encryptedMnemonic, password)
  if (restored !== mnemonic) throw new Error('Encrypted wallet verification failed')

  return {
    isCreated: true,
    version: 2,
    verifyHash: secret.verifyHash,
    verifySalt: secret.verifySalt,
    walletFingerprint,
    encryptedMnemonic: secret.encryptedMnemonic,
  }
}

const isV2 = (meta: WalletMeta | null): meta is WalletMetaV2 =>
  Boolean(meta && meta.version === 2 && 'verifyHash' in meta)

const verifyPassword = async (meta: WalletMeta, password: string) => {
  if (isV2(meta)) {
    return nativeCoreService.verifyWalletPassword(password, meta.verifySalt, meta.verifyHash)
  }

  if (!meta.encryptedMnemonic) return false
  try {
    await nativeCoreService.decryptWalletSecret(meta.encryptedMnemonic, password)
    return true
  } catch {
    return false
  }
}

const migrateLegacyWallet = async (legacy: LegacyWalletMeta, password: string) => {
  const revision = walletSessionRevision
  if (!legacy.encryptedMnemonic) return null
  try {
    const mnemonic = await nativeCoreService.decryptWalletSecret(legacy.encryptedMnemonic, password)
    const upgraded = await buildWalletMeta(mnemonic, password)
    assertCurrentSession(revision)
    storageService.set<WalletMeta>(WALLET_KEY, upgraded)
    return mnemonic
  } catch {
    return null
  }
}

const savePublicAddresses = async (mnemonic: string, includePrivacy = true, forceStandard = false) => {
  const revision = walletSessionRevision
  const previous = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  const standard = await deriveStandardCoinAddresses(mnemonic, forceStandard ? {} : previous)
  const addresses = { ...previous, ...standard }
  if (revision !== walletSessionRevision) return previous
  if (Object.keys(standard).length > 0) storageService.set(WALLET_ADDRESSES_KEY, addresses)
  if (includePrivacy) return refreshPrivacyAddresses(mnemonic)
  return addresses
}

const retryMissingStandardAddressesInBackground = (mnemonic: string) => {
  const revision = walletSessionRevision
  globalThis.setTimeout(() => {
    if (revision !== walletSessionRevision || sessionMnemonicCache !== mnemonic) return
    void savePublicAddresses(mnemonic, false, false).catch(() => undefined)
  }, STANDARD_ADDRESS_RETRY_DELAY_MS)
}

const trySavePublicAddresses = async (mnemonic: string, includePrivacy = true, forceStandard = false) => {
  try {
    const addresses = await savePublicAddresses(mnemonic, includePrivacy, forceStandard)
    retryMissingStandardAddressesInBackground(mnemonic)
    return addresses
  } catch {
    retryMissingStandardAddressesInBackground(mnemonic)
    return storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  }
}

const getWalletMeta = () => storageService.get<WalletMeta | null>(WALLET_KEY, null)

const ensureWalletFingerprint = async (meta: WalletMetaV2, mnemonic: string) => {
  const revision = walletSessionRevision
  if (meta.walletFingerprint) return meta
  const upgraded = { ...meta, walletFingerprint: await walletFingerprintFromMnemonic(mnemonic) }
  assertCurrentSession(revision)
  storageService.set<WalletMeta>(WALLET_KEY, upgraded)
  return upgraded
}

const ensureCompatibleWalletMeta = async (meta: WalletMetaV2, mnemonic: string, password: string) => {
  const revision = walletSessionRevision
  if (meta.encryptedMnemonic.salt.startsWith('fullnode-scrypt-v1:')) {
    const compatible = await buildWalletMeta(mnemonic, password)
    assertCurrentSession(revision)
    storageService.set<WalletMeta>(WALLET_KEY, compatible)
  } else {
    await ensureWalletFingerprint(meta, mnemonic)
    assertCurrentSession(revision)
  }
}

const getMnemonic = async (password: string) => {
  const revision = walletSessionRevision
  const meta = getWalletMeta()
  if (!meta?.isCreated) throw new Error('Wallet is not created')

  if (!isV2(meta)) {
    const mnemonic = await migrateLegacyWallet(meta, password)
    assertCurrentSession(revision)
    if (!mnemonic) throw new Error('Wrong password')
    return mnemonic
  }

  if (!(await verifyPassword(meta, password))) throw new Error('Wrong password')
  assertCurrentSession(revision)
  const mnemonic = await nativeCoreService.decryptWalletSecret(meta.encryptedMnemonic, password)
  assertCurrentSession(revision)
  await ensureCompatibleWalletMeta(meta, mnemonic, password)
  assertCurrentSession(revision)
  return mnemonic
}

const ensurePublicAddress = async (coinId: string, force = false): Promise<string | undefined> => {
  const normalizedCoinId = coinId.trim().toLowerCase()
  const existing = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})[normalizedCoinId]
  if (existing && !force) return existing

  const pending = pendingPublicAddressRequests.get(normalizedCoinId)
  if (pending) return pending

  const request = (async () => {
    const mnemonic = sessionMnemonicCache
    const revision = walletSessionRevision
    if (!mnemonic) return undefined

    const coin = allCoins().find((item) => item.id === normalizedCoinId)
    if (!coin) return undefined

    let address: string | undefined
    if (coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light' || coin.walletEngine === 'monero-light') {
      const result = await privacyWalletService.ensureWallet(coin.id as PrivacyCoin, mnemonic)
      address = result.address
    } else {
      const deriveAddress = walletEngineRegistry.get(coin).deriveAddress
      if (deriveAddress) {
        address = await withTimeout(
          Promise.resolve(deriveAddress(coin, mnemonic)),
          STANDARD_ADDRESS_DERIVATION_TIMEOUT_MS,
          `${coin.id} mining address derivation`,
        )
      }
    }

    if (!address || revision !== walletSessionRevision || sessionMnemonicCache !== mnemonic) return undefined
    const addresses = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
    storageService.set<WalletAddresses>(WALLET_ADDRESSES_KEY, { ...addresses, [coin.id]: address })
    return address
  })().finally(() => {
    if (pendingPublicAddressRequests.get(normalizedCoinId) === request) pendingPublicAddressRequests.delete(normalizedCoinId)
  })

  pendingPublicAddressRequests.set(normalizedCoinId, request)
  return request
}

const startPendingWalletSetup = (mnemonic: string, password: string) => {
  const setupId = ++pendingWalletSetupId
  const setup: PendingWalletSetup = {
    id: setupId,
    mnemonic,
    password,
    seedSafetyAcknowledged: false,
  }

  pendingWalletSetup = setup
  return setup
}

export const walletService = {
  async createWallet(password: string) {
    const revision = bumpWalletSessionRevision()
    const mnemonic = await nativeCoreService.generateMnemonic()
    assertCurrentSession(revision)
    privacyWalletService.resetNativeReadiness()
    sessionMnemonicCache = mnemonic
    startPendingWalletSetup(mnemonic, password)
    return { seedPhrase: mnemonic }
  },

  setPendingSeedSafetyAcknowledged(mnemonic: string | null | undefined, acknowledged: boolean) {
    if (!pendingWalletSetup) return false
    if (mnemonic && pendingWalletSetup.mnemonic !== mnemonic) return false
    pendingWalletSetup.seedSafetyAcknowledged = acknowledged
    return true
  },

  async finalizeWalletSetup(mnemonic?: string, options: { seedSafetyAcknowledged?: boolean } = {}) {
    const pending = pendingWalletSetup
    if (!pending) {
      if (getWalletMeta()?.isCreated && sessionMnemonicCache && (!mnemonic || mnemonic === sessionMnemonicCache)) return true
      throw new Error('Wallet setup is not ready')
    }
    if (mnemonic && pending.mnemonic !== mnemonic) throw new Error('Wallet setup seed mismatch')

    try {
      const meta = await buildWalletMeta(pending.mnemonic, pending.password, {
        requireSeedSafetyAcknowledgement: true,
        seedSafetyAcknowledged: options.seedSafetyAcknowledged ?? pending.seedSafetyAcknowledged,
      })
      if (pendingWalletSetup?.id !== pending.id) throw new Error('Wallet setup was cancelled')
      storageService.set<WalletMeta>(WALLET_KEY, meta)
      privacyBirthService.markCreatedWallet()
      bumpWalletSessionRevision()
      sessionMnemonicCache = pending.mnemonic
      pendingWalletSetup = null
      return true
    } catch (error) {
      if (pendingWalletSetup?.id === pending.id) pendingWalletSetup = null
      throw error
    }
  },

  async restoreWallet(
    seedPhrase: string,
    password: string,
    onProgress?: WalletLoadProgressHandler,
    options: { seedSafetyAcknowledged?: boolean } = {},
  ) {
    const revision = bumpWalletSessionRevision()
    const words = normalizeSeedPhrase(seedPhrase)
    const mnemonic = words.join(' ')
    if (words.length !== 12 || !(await nativeCoreService.validateMnemonic(mnemonic))) {
      throw new Error('Seed phrase must contain 12 valid BIP39 words')
    }
    assertCurrentSession(revision)
    onProgress?.(buildWalletLoadProgress('addresses'))
    const meta = await buildWalletMeta(mnemonic, password, {
      requireSeedSafetyAcknowledgement: true,
      seedSafetyAcknowledged: options.seedSafetyAcknowledged,
    })
    assertCurrentSession(revision)
    const addresses = await deriveStandardCoinAddresses(mnemonic)
    assertCurrentSession(revision)
    onProgress?.(buildWalletLoadProgress('secureSeed'))
    storageService.setMany({ [WALLET_KEY]: meta, [WALLET_ADDRESSES_KEY]: addresses })
    privacyBirthService.markRestoredWallet()
    privacyWalletService.resetNativeReadiness()
    bumpWalletSessionRevision()
    sessionMnemonicCache = mnemonic
    return true
  },

  async unlockWallet(password: string, onProgress?: WalletLoadProgressHandler) {
    const revision = bumpWalletSessionRevision()
    sessionMnemonicCache = null
    const meta = getWalletMeta()
    if (!meta?.isCreated) return false

    if (!isV2(meta)) {
      const mnemonic = await migrateLegacyWallet(meta, password)
      assertCurrentSession(revision)
      if (!mnemonic) return false
      privacyWalletService.resetNativeReadiness()
      sessionMnemonicCache = mnemonic
      onProgress?.(buildWalletLoadProgress('addresses'))
      await trySavePublicAddresses(mnemonic, false, true)
      assertCurrentSession(revision)
      return true
    }

    const ok = await verifyPassword(meta, password)
    assertCurrentSession(revision)
    if (ok) {
      const mnemonic = await nativeCoreService.decryptWalletSecret(meta.encryptedMnemonic, password)
      assertCurrentSession(revision)
      await ensureCompatibleWalletMeta(meta, mnemonic, password)
      assertCurrentSession(revision)
      sessionMnemonicCache = mnemonic
      onProgress?.(buildWalletLoadProgress('addresses'))
      await trySavePublicAddresses(mnemonic, false, true)
      assertCurrentSession(revision)
    }
    return ok
  },

  async lockWallet() {
    bumpWalletSessionRevision()
    pendingWalletSetup = null
    sessionMnemonicCache = null
    privacyWalletService.resetNativeReadiness()
    await window.altbaseWallet?.resetCoreSession?.()
    return true
  },

  walletExists() {
    return getWalletMeta()?.isCreated === true
  },

  hasStoredSeedPhrase() {
    const meta = getWalletMeta()
    return Boolean(meta?.encryptedMnemonic)
  },

  async getSeedPhrase(password: string) {
    const revision = walletSessionRevision
    const mnemonic = await getMnemonic(password)
    assertCurrentSession(revision)
    sessionMnemonicCache = mnemonic
    return mnemonic
  },

  getSessionMnemonic() {
    return sessionMnemonicCache
  },

  getSessionRevision: () => walletSessionRevision,

  warmPrivacyAddresses() {
    if (sessionMnemonicCache) refreshPrivacyAddressesInBackground(sessionMnemonicCache)
  },

  warmNativeCore() {
    void nativeCoreService.health().catch(() => undefined)
  },

  async preparePublicAddresses(mnemonic?: string) {
    const source = mnemonic ?? sessionMnemonicCache
    if (!source) return {}
    if (source !== sessionMnemonicCache) throw new Error('Wallet session changed')
    return trySavePublicAddresses(source, false, true)
  },

  /**
   * Returns the WIF private key for the given coin, deriving it on the fly
   * from the user's mnemonic using the coin's cryptoParams. Zano/Epic do not
   * use WIF, so this returns their native recovery seed instead.
   */
  async getPrivateKey(coinId: string, password: string) {
    const revision = walletSessionRevision
    const mnemonic = await getMnemonic(password)
    assertCurrentSession(revision)
    const coin = allCoins().find((item) => item.id === coinId)
    if (!coin) throw new Error(`coin-not-supported:${coinId}`)
    const exportSecret = walletEngineRegistry.get(coin).exportSecret
    if (!exportSecret) throw new Error(`coin-not-supported:${coinId}`)
    const secret = await exportSecret(coin, mnemonic)
    assertCurrentSession(revision)
    if (coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light' || coin.walletEngine === 'monero-light') {
      const height = await privacyBirthService.restoreStartHeight(coin.id as PrivacyCoin).catch(() => null)
      assertCurrentSession(revision)
      return height ? `${secret}\n\nRestore height: ${height}` : secret
    }
    return secret
  },

  async refreshDerivedAddresses(password: string) {
    const revision = walletSessionRevision
    const mnemonic = await getMnemonic(password)
    assertCurrentSession(revision)
    return savePublicAddresses(mnemonic, true, true)
  },

  async changePassword(currentPassword: string, nextPassword: string) {
    const revision = walletSessionRevision
    const mnemonic = await getMnemonic(currentPassword)
    assertCurrentSession(revision)
    const meta = await buildWalletMeta(mnemonic, nextPassword)
    assertCurrentSession(revision)
    storageService.set<WalletMeta>(WALLET_KEY, meta)
    // Re-encrypting the same phrase does not change any public address. Do
    // not make password changes wait for coin adapters or privacy scans.
    bumpWalletSessionRevision()
    return true
  },

  clearWallet() {
    pendingWalletSetup = null
    bumpWalletSessionRevision()
    sessionMnemonicCache = null
    privacyWalletService.resetNativeReadiness()
    void window.altbaseWallet?.resetCoreSession?.().catch(() => undefined)
    storageService.clear()
  },

  discardWalletSetup() {
    pendingWalletSetup = null
    bumpWalletSessionRevision()
    sessionMnemonicCache = null
    privacyWalletService.resetNativeReadiness()
    void window.altbaseWallet?.resetCoreSession?.().catch(() => undefined)
    storageService.remove(WALLET_KEY)
    storageService.remove(WALLET_ADDRESSES_KEY)
  },

  getWalletAddresses() {
    return storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  },

  ensurePublicAddress,

  getWalletStorageScope,
}
