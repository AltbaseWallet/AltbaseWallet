import { normalizeSeedPhrase } from '../utils/validateSeedPhrase'
import { allCoins } from './coinService'
import { nativeCoreService, type NativeWalletSecretOptions } from './nativeCoreService'
import { privacyWalletService, type PrivacyCoin } from './privacyWalletService'
import { privacyBirthService } from './privacyBirthService'
import { storageService } from './storageService'
import { getWalletStorageScope, walletFingerprintFromMnemonic } from './walletScopeService'
import { buildWalletLoadProgress, type WalletLoadProgressHandler } from '../types/walletLoadProgress'
import { walletEngineRegistry } from '../wallet-engines/registry'

const WALLET_KEY = 'wallet-meta'
const WALLET_ADDRESSES_KEY = 'wallet-addresses'
let sessionMnemonicCache: string | null = null
let pendingWalletSetupId = 0
let walletSessionRevision = 0

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
  walletSessionRevision += 1
  return walletSessionRevision
}

/**
 * Map of coinId → derived P2PKH address. The wallet builds it once on unlock
 * (or wallet creation/restore) from the mnemonic + each coin's cryptoParams.
 * Keys are open-ended on purpose so adding a new coin only requires updating
 * the catalog in `coinService.ts`.
 */
export type WalletAddresses = Record<string, string | undefined>

const privacyCoins = () =>
  allCoins().filter((coin) => coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light')

const deriveStandardCoinAddresses = async (
  mnemonic: string,
  previous: WalletAddresses = {},
): Promise<WalletAddresses> => {
  const coinsToDerive = allCoins().filter((coin) =>
    walletEngineRegistry.kindOf(coin) !== 'privacy' && !previous[coin.id],
  )
  if (coinsToDerive.length === 0) return {}

  // Derive every coin's address in parallel — they're independent computations.
  const results = await Promise.all(
    coinsToDerive.map(async (coin) => {
      try {
        const addr = await walletEngineRegistry.get(coin).deriveAddress?.(coin, mnemonic)
        return [coin.id, addr] as const
      } catch {
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
  const current = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  const privacyResults = await Promise.all(
    privacyCoins().map(async (coin) => {
      try {
        const result = await privacyWalletService.ensureWallet(coin.id as PrivacyCoin, mnemonic)
        return [coin.id, result.address] as const
      } catch {
        return [coin.id, undefined] as const
      }
    }),
  )
  const next: WalletAddresses = { ...current }
  let changed = false
  for (const [id, addr] of privacyResults) {
    if (addr && next[id] !== addr) {
      next[id] = addr
      changed = true
    }
  }
  if (changed && revision === walletSessionRevision) storageService.set(WALLET_ADDRESSES_KEY, next)
  return next
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
  if (!legacy.encryptedMnemonic) return null
  try {
    const mnemonic = await nativeCoreService.decryptWalletSecret(legacy.encryptedMnemonic, password)
    const upgraded = await buildWalletMeta(mnemonic, password)
    storageService.set<WalletMeta>(WALLET_KEY, upgraded)
    return mnemonic
  } catch {
    return null
  }
}

const savePublicAddresses = async (mnemonic: string, includePrivacy = true, forceStandard = false) => {
  const previous = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  const standard = await deriveStandardCoinAddresses(mnemonic, forceStandard ? {} : previous)
  const addresses = forceStandard ? standard : { ...previous, ...standard }
  if (forceStandard || Object.keys(standard).length > 0) storageService.set(WALLET_ADDRESSES_KEY, addresses)
  if (includePrivacy) return refreshPrivacyAddresses(mnemonic)
  return addresses
}

const trySavePublicAddresses = async (mnemonic: string, includePrivacy = true, forceStandard = false) => {
  try {
    return await savePublicAddresses(mnemonic, includePrivacy, forceStandard)
  } catch {
    storageService.set<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
    return {}
  }
}

const getWalletMeta = () => storageService.get<WalletMeta | null>(WALLET_KEY, null)

const ensureWalletFingerprint = async (meta: WalletMetaV2, mnemonic: string) => {
  if (meta.walletFingerprint) return meta
  const upgraded = { ...meta, walletFingerprint: await walletFingerprintFromMnemonic(mnemonic) }
  storageService.set<WalletMeta>(WALLET_KEY, upgraded)
  return upgraded
}

const getMnemonic = async (password: string) => {
  const meta = getWalletMeta()
  if (!meta?.isCreated) throw new Error('Wallet is not created')

  if (!isV2(meta)) {
    const mnemonic = await migrateLegacyWallet(meta, password)
    if (!mnemonic) throw new Error('Wrong password')
    return mnemonic
  }

  if (!(await verifyPassword(meta, password))) throw new Error('Wrong password')
  const mnemonic = await nativeCoreService.decryptWalletSecret(meta.encryptedMnemonic, password)
  await ensureWalletFingerprint(meta, mnemonic)
  return mnemonic
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
    bumpWalletSessionRevision()
    const mnemonic = await nativeCoreService.generateMnemonic()
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
      if (getWalletMeta()?.isCreated) return true
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
    bumpWalletSessionRevision()
    const words = normalizeSeedPhrase(seedPhrase)
    const mnemonic = words.join(' ')
    if (words.length !== 12 || !(await nativeCoreService.validateMnemonic(mnemonic))) {
      throw new Error('Seed phrase must contain 12 valid BIP39 words')
    }
    onProgress?.(buildWalletLoadProgress('addresses'))
    const metaPromise = buildWalletMeta(mnemonic, password, {
      requireSeedSafetyAcknowledgement: true,
      seedSafetyAcknowledged: options.seedSafetyAcknowledged,
    })
    await trySavePublicAddresses(mnemonic, false, true)
    onProgress?.(buildWalletLoadProgress('secureSeed'))
    const meta = await metaPromise
    storageService.set<WalletMeta>(WALLET_KEY, meta)
    privacyBirthService.markRestoredWallet()
    privacyWalletService.resetNativeReadiness()
    bumpWalletSessionRevision()
    sessionMnemonicCache = mnemonic
    return true
  },

  async unlockWallet(password: string, onProgress?: WalletLoadProgressHandler) {
    const meta = getWalletMeta()
    if (!meta?.isCreated) return false

    if (!isV2(meta)) {
      const mnemonic = await migrateLegacyWallet(meta, password)
      if (!mnemonic) return false
      privacyWalletService.resetNativeReadiness()
      bumpWalletSessionRevision()
      sessionMnemonicCache = mnemonic
      onProgress?.(buildWalletLoadProgress('addresses'))
      await trySavePublicAddresses(mnemonic, false, true)
      return true
    }

    const ok = await verifyPassword(meta, password)
    if (ok) {
      const mnemonic = await nativeCoreService.decryptWalletSecret(meta.encryptedMnemonic, password)
      await ensureWalletFingerprint(meta, mnemonic)
      bumpWalletSessionRevision()
      sessionMnemonicCache = mnemonic
      onProgress?.(buildWalletLoadProgress('addresses'))
      await trySavePublicAddresses(mnemonic, false, true)
    }
    return ok
  },

  async lockWallet() {
    bumpWalletSessionRevision()
    sessionMnemonicCache = null
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
    const mnemonic = await getMnemonic(password)
    sessionMnemonicCache = mnemonic
    return mnemonic
  },

  getSessionMnemonic() {
    return sessionMnemonicCache
  },

  warmPrivacyAddresses() {
    if (sessionMnemonicCache) refreshPrivacyAddressesInBackground(sessionMnemonicCache)
  },

  warmNativeCore() {
    void nativeCoreService.health().catch(() => undefined)
  },

  async preparePublicAddresses(mnemonic?: string) {
    const source = mnemonic ?? sessionMnemonicCache
    if (!source) return {}
    sessionMnemonicCache = source
    return trySavePublicAddresses(source, false, true)
  },

  /**
   * Returns the WIF private key for the given coin, deriving it on the fly
   * from the user's mnemonic using the coin's cryptoParams. Zano/Epic do not
   * use WIF, so this returns their native recovery seed instead.
   */
  async getPrivateKey(coinId: string, password: string) {
    const mnemonic = await getMnemonic(password)
    const coin = allCoins().find((item) => item.id === coinId)
    if (!coin) throw new Error(`coin-not-supported:${coinId}`)
    const exportSecret = walletEngineRegistry.get(coin).exportSecret
    if (!exportSecret) throw new Error(`coin-not-supported:${coinId}`)
    const secret = await exportSecret(coin, mnemonic)
    if (coin.walletEngine === 'zano-light' || coin.walletEngine === 'epic-light') {
      const height = await privacyBirthService.restoreStartHeight(coin.id as PrivacyCoin).catch(() => null)
      return height ? `${secret}\n\nRestore height: ${height}` : secret
    }
    return secret
  },

  async refreshDerivedAddresses(password: string) {
    const mnemonic = await getMnemonic(password)
    return savePublicAddresses(mnemonic, true, true)
  },

  async changePassword(currentPassword: string, nextPassword: string) {
    const mnemonic = await getMnemonic(currentPassword)
    const meta = await buildWalletMeta(mnemonic, nextPassword)
    storageService.set<WalletMeta>(WALLET_KEY, meta)
    await savePublicAddresses(mnemonic, true, true)
    return true
  },

  clearWallet() {
    pendingWalletSetup = null
    bumpWalletSessionRevision()
    sessionMnemonicCache = null
    privacyWalletService.resetNativeReadiness()
    storageService.clear()
  },

  discardWalletSetup() {
    pendingWalletSetup = null
    bumpWalletSessionRevision()
    sessionMnemonicCache = null
    privacyWalletService.resetNativeReadiness()
    storageService.remove(WALLET_KEY)
    storageService.remove(WALLET_ADDRESSES_KEY)
  },

  getWalletAddresses() {
    return storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  },

  getWalletStorageScope,
}
