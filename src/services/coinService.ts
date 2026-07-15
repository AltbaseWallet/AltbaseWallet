import { coinModules } from '../coin-modules'
import type { Coin } from '../types/coin'
import { storageService } from './storageService'
import { getWalletStorageScope } from './walletScopeService'
import type { WalletAddresses } from './walletService'
import { applyCachedCoinRuntime, toCachedCoinRuntime, type CachedCoinRuntime } from './coinRuntimeCache'

const COINS_KEY = 'coins'
const WALLET_ADDRESSES_KEY = 'wallet-addresses'
const CATALOG: Coin[] = coinModules.map((module) => module.coin)

const coinsKey = () => `${COINS_KEY}:${getWalletStorageScope()}`

/** Return the immutable crypto parameters owned by a coin module. */
export const cryptoParamsFor = (coinId: string) =>
  CATALOG.find((coin) => coin.id === coinId)?.cryptoParams

/** All registered coin modules as detached runtime coin values. */
export const allCoins = (): Coin[] => CATALOG.map((coin) => ({ ...coin }))

const loadCoins = (): Coin[] => {
  const addresses = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  const persisted = storageService.get<CachedCoinRuntime[]>(coinsKey(), [])
  const persistedById = new Map(persisted.map((coin) => [coin.id, coin]))

  return CATALOG.map((base) => {
    const stored = persistedById.get(base.id)
    return {
      ...applyCachedCoinRuntime(base, stored),
      cryptoParams: base.cryptoParams,
      satsPerCoin: base.satsPerCoin,
      walletEngine: base.walletEngine,
      utxoReadProfile: base.utxoReadProfile,
      deferStartupBalance: base.deferStartupBalance,
      address: addresses[base.id as keyof WalletAddresses] ?? '',
    }
  })
}

const saveCoins = (coins: Coin[]) => {
  const slim = coins.map(toCachedCoinRuntime)
  storageService.set(coinsKey(), slim)
}

export const coinService = {
  async getCoins() {
    return loadCoins()
  },

  async getCoinById(id: string) {
    return loadCoins().find((coin) => coin.id === id) ?? null
  },

  async toggleFavorite(id: string) {
    const coins = loadCoins().map((coin) => (coin.id === id ? { ...coin, favorite: !coin.favorite } : coin))
    saveCoins(coins)
    return coins
  },

  async toggleEnabled(id: string) {
    const coins = loadCoins().map((coin) => (coin.id === id ? { ...coin, enabled: !coin.enabled } : coin))
    saveCoins(coins)
    return coins
  },

  async saveCoins(coins: Coin[]) {
    saveCoins(coins)
    return loadCoins()
  },

  async saveRuntimeCoins(coins: Coin[]) {
    const currentPrefs = new Map(loadCoins().map((coin) => [coin.id, {
      enabled: coin.enabled,
      favorite: coin.favorite,
    }]))
    const merged = coins.map((coin) => ({
      ...coin,
      enabled: currentPrefs.get(coin.id)?.enabled ?? coin.enabled,
      favorite: currentPrefs.get(coin.id)?.favorite ?? coin.favorite,
    }))
    saveCoins(merged)
    const progressById = new Map(coins.map((coin) => [coin.id, coin.recoveryProgress]))
    return merged.map((coin) => ({
      ...coin,
      recoveryProgress: progressById.get(coin.id),
    }))
  },

  async resetVisibility() {
    const coins = loadCoins().map((coin) => ({ ...coin, enabled: true }))
    saveCoins(coins)
    return loadCoins()
  },

  async resetFavorites() {
    const coins = loadCoins().map((coin) => ({ ...coin, favorite: false }))
    saveCoins(coins)
    return loadCoins()
  },

  async resetForCurrentWallet() {
    storageService.removeByPrefix(COINS_KEY)
    return loadCoins()
  },
}
