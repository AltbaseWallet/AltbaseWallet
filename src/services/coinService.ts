import type { Coin, UtxoReadProfile } from '../types/coin'
import { storageService } from './storageService'
import { getWalletStorageScope } from './walletScopeService'
import type { WalletAddresses } from './walletService'

const COINS_KEY = 'coins'
const WALLET_ADDRESSES_KEY = 'wallet-addresses'

const coinsKey = () => `${COINS_KEY}:${getWalletStorageScope()}`

const UTXO_READ_PROFILE_BY_COIN: Record<string, UtxoReadProfile> = {
  bitcoin2: 'scan-utxo',
  bitcoincashii: 'scan-utxo',
  capstash: 'scan-utxo',
  firo: 'address-index',
  kerrigan: 'address-index',
  litecoinii: 'scan-utxo',
  pepecoin: 'local-index',
  scash: 'scan-utxo',
  neoxa: 'blockbook',
  terracoin: 'address-index',
  junkcoin: 'local-index',
  raptoreum: 'address-index',
  pearl: 'blockbook',
}

/**
 * Static catalog of every coin the wallet ships with.
 *
 * `cryptoParams` for each chain comes from the project's `chainparams.cpp`
 * (mainnet block) and the official wallet's BIP44/SLIP-44 derivation path
 * where one is defined.
 */
const CATALOG: Coin[] = [
  {
    id: 'bitcoin2',
    name: 'Bitcoin II',
    ticker: 'BC2',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    explorerUrl: 'https://explorer.bitcoin2.org',
    networkId: 'bitcoin2-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 0,  p2shPrefix: 5,  wifPrefix: 128, derivationPath: "m/44'/16001'/0'/0/0", bech32Hrp: 'bc' },
  },
  {
    id: 'bitcoincashii',
    name: 'Bitcoin Cash II',
    ticker: 'BCH2',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'bitcoincashII-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 0,  p2shPrefix: 5,  wifPrefix: 128, derivationPath: "m/44'/145'/0'/0/0", sighashStyle: 'bip143-forkid', cashaddrPrefix: 'bitcoincashii' },
  },
  {
    id: 'firo',
    name: 'Firo',
    ticker: 'FIRO',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    explorerUrl: 'https://explorer.firo.org',
    networkId: 'firo-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 82, p2shPrefix: 7,  wifPrefix: 210, derivationPath: "m/44'/136'/0'/0/0" },
  },
  {
    id: 'capstash',
    name: 'CapStash',
    ticker: 'CAPS',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'capstash-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 28, p2shPrefix: 18, wifPrefix: 156, derivationPath: "m/44'/16005'/0'/0/0", bech32Hrp: 'cap' },
  },
  {
    id: 'pepecoin',
    name: 'Pepecoin',
    ticker: 'PEPE',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    explorerUrl: 'https://pepeblocks.com',
    networkId: 'pepecoin-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 56, p2shPrefix: 22, wifPrefix: 158, derivationPath: "m/44'/3434'/0'/0/0" },
  },
  {
    id: 'kerrigan',
    name: 'Kerrigan',
    ticker: 'KER',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'kerrigan-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 45, p2shPrefix: 16, wifPrefix: 204, derivationPath: "m/44'/16008'/0'/0/0", txVersion: 2 },
  },
  {
    id: 'scash',
    name: 'Scash',
    ticker: 'SCASH',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'scash-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 0,  p2shPrefix: 5,  wifPrefix: 128, derivationPath: "m/44'/805'/0'/0/0", bech32Hrp: 'scash' },
  },
  {
    id: 'litecoinii',
    name: 'LitecoinII',
    ticker: 'LC2',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'litecoinii-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 48, p2shPrefix: 5, wifPrefix: 176, derivationPath: "m/44'/2102'/0'/0/0", bech32Hrp: 'lc2' },
  },
  {
    id: 'neoxa',
    name: 'Neoxa',
    ticker: 'NEOX',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'neoxa-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 38, p2shPrefix: 122, wifPrefix: 112, derivationPath: "m/44'/1668'/0'/0/0" },
  },
  {
    id: 'terracoin',
    name: 'Terracoin',
    ticker: 'TRC',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'terracoin-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/83'/0'/0/0" },
  },
  {
    id: 'junkcoin',
    name: 'Junkcoin',
    ticker: 'JKC',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'junkcoin-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 16, p2shPrefix: 5, wifPrefix: 144, derivationPath: "m/44'/2013'/0'/0/0" },
  },
  {
    id: 'raptoreum',
    name: 'Raptoreum',
    ticker: 'RTM',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'raptoreum-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 60, p2shPrefix: 16, wifPrefix: 128, derivationPath: "m/44'/10226'/0'/0/0" },
  },
  {
    id: 'zano',
    name: 'Zano',
    ticker: 'ZANO',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'zano-mainnet',
    supportsMemo: false,
    satsPerCoin: 1_000_000_000_000,
    walletEngine: 'zano-light',
  },
  {
    id: 'epic',
    name: 'Epic Cash',
    ticker: 'EPIC',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    networkId: 'epic-mainnet',
    supportsMemo: true,
    satsPerCoin: 100_000_000,
    walletEngine: 'epic-light',
  },
  {
    id: 'quai',
    name: 'Quai',
    ticker: 'QUAI',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    explorerUrl: 'https://quaiscan.io',
    networkId: 'quai-mainnet-cyprus1',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    walletEngine: 'quai-account',
  },
  {
    id: 'pearl',
    name: 'Pearl',
    ticker: 'PRL',
    balance: '0', fiatValue: 0, address: '',
    status: 'syncing', enabled: true, favorite: false,
    explorerUrl: 'https://blockbook.pearlresearch.ai',
    networkId: 'pearl-mainnet',
    supportsMemo: false,
    satsPerCoin: 100_000_000,
    cryptoParams: {
      p2pkhPrefix: 0,
      p2shPrefix: 0,
      wifPrefix: 128,
      derivationPath: "m/86'/808276'/0'/0/0",
      bech32Hrp: 'prl',
      addressType: 'p2tr',
      sighashStyle: 'taproot',
    },
    walletEngine: 'pearl-utxo',
  },
]

/** Return the static cryptoParams for a coin id (used by services). */
export const cryptoParamsFor = (coinId: string) =>
  CATALOG.find((c) => c.id === coinId)?.cryptoParams

/** All coins in the catalog (read-only, full crypto params attached). */
export const allCoins = (): Coin[] => CATALOG.map((c) => ({ ...c }))

/** Build the runtime coin list by merging persisted state on top of the catalog. */
const loadCoins = (): Coin[] => {
  const addresses = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  const persisted = storageService.get<Coin[]>(coinsKey(), [])
  const persistedById = new Map(persisted.map((c) => [c.id, c]))

  return CATALOG.map((base) => {
    const stored = persistedById.get(base.id)
    return {
      ...base,
      enabled: stored?.enabled ?? base.enabled,
      favorite: stored?.favorite ?? base.favorite,
      priceUsd: stored?.priceUsd ?? base.priceUsd,
      status: stored?.status ?? base.status,
      // Always reset derivation params from catalog (never user-overridable)
      cryptoParams: base.cryptoParams,
      satsPerCoin: base.satsPerCoin,
      walletEngine: base.walletEngine,
      utxoReadProfile: base.utxoReadProfile ?? UTXO_READ_PROFILE_BY_COIN[base.id],
      deferStartupBalance: base.deferStartupBalance,
      // Address comes from the wallet-derived map
      address: addresses[base.id as keyof WalletAddresses] ?? '',
    }
  })
}

const saveCoins = (coins: Coin[]) => {
  // Persist only preferences + lightweight metadata. Balances are deliberately
  // excluded: every visible balance must come from the API during this session,
  // never from localStorage.
  const slim = coins.map(({ id, priceUsd, status, enabled, favorite }) => ({
    id, priceUsd, status, enabled, favorite,
  }))
  storageService.set(coinsKey(), slim)
}

export const coinService = {
  async getCoins() {
    return loadCoins()
  },

  async getCoinById(id: string) {
    return loadCoins().find((c) => c.id === id) ?? null
  },

  async toggleFavorite(id: string) {
    const coins = loadCoins().map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c))
    saveCoins(coins)
    return coins
  },

  async toggleEnabled(id: string) {
    const coins = loadCoins().map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
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

  /** Restore every coin to its catalog defaults (visible, not-favorite). */
  async resetVisibility() {
    const coins = loadCoins().map((c) => ({ ...c, enabled: true }))
    saveCoins(coins)
    return loadCoins()
  },

  async resetFavorites() {
    const coins = loadCoins().map((c) => ({ ...c, favorite: false }))
    saveCoins(coins)
    return loadCoins()
  },

  async resetForCurrentWallet() {
    // Clear cached coin balances for EVERY wallet scope (not just the current
    // one) so a restored-over wallet never shows a previous seed's balances.
    storageService.removeByPrefix(COINS_KEY)
    return loadCoins()
  },
}
