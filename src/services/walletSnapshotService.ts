import type { Coin } from '../types/coin'
import { coinApiService, type WalletSnapshotRequest, type WalletSnapshotResponse } from './coinApiService'
import { walletService } from './walletService'
import { walletEngineRegistry } from '../wallet-engines/registry'

export type WalletSnapshotItem = WalletSnapshotRequest['coins'][number]

const BALANCE_CHUNK_SIZE = 1
const BALANCE_CHUNK_TIMEOUT_MS = 20_000

const emptySnapshot = (): WalletSnapshotResponse => ({
  prices: {},
  pricesUpdatedAt: null,
  coins: {},
})

const chunkCoins = (coins: Coin[], size = BALANCE_CHUNK_SIZE) => {
  const chunks: Coin[][] = []
  for (let index = 0; index < coins.length; index += size) {
    chunks.push(coins.slice(index, index + size))
  }
  return chunks
}

const withTimeout = async <T,>(promise: Promise<T>, ms = BALANCE_CHUNK_TIMEOUT_MS): Promise<T> => {
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

const mergeSnapshotResults = (
  results: Array<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }>,
) => {
  const merged = {
    items: [] as WalletSnapshotItem[],
    snapshot: emptySnapshot(),
  }
  for (const result of results) {
    merged.items.push(...result.items)
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

export const walletSnapshotService = {
  async buildItems(coins: Coin[]): Promise<WalletSnapshotItem[]> {
    const walletAddresses = walletService.getWalletAddresses()

    const items = await Promise.all(
      coins.map(async (coin) => {
        const baseAddress = walletAddresses[coin.id] ?? coin.address
        if (!baseAddress) return { coin: coin.id, addresses: [] }
        try {
          const variants = await walletEngineRegistry.get(coin).getAddressVariants(coin, baseAddress)
          const canonical = variants.filter((variant) => !variant.aliasOfLegacy)
          const addresses = (canonical.length > 0 ? canonical : variants)
            .map((variant) => variant.address)
            .filter(Boolean)
          return { coin: coin.id, addresses: Array.from(new Set(addresses.length > 0 ? addresses : [baseAddress])) }
        } catch {
          return { coin: coin.id, addresses: [baseAddress] }
        }
      }),
    )

    return items
  },

  async fetch(
    coins: Coin[],
    historyLimit = 25,
    historyOffset = 0,
  ): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    const items = await this.buildItems(enabled)
    const snapshot = await coinApiService.getWalletSnapshot({
      coins: items,
      historyLimit,
      historyOffset,
      includeNetwork: true,
      includeBalances: true,
      includeHistory: true,
      expandAddresses: false,
    })
    return { items, snapshot }
  },

  async fetchBalances(
    coins: Coin[],
    options: { forceBalances?: boolean } = {},
  ): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    if (enabled.length === 0) return { items: [], snapshot: emptySnapshot() }
    const items = await this.buildItems(enabled)
    const snapshot = await coinApiService.getWalletSnapshot({
      coins: items,
      historyLimit: 0,
      historyOffset: 0,
      includeNetwork: true,
      includeBalances: true,
      includeHistory: false,
      forceBalances: options.forceBalances === true,
      expandAddresses: false,
    })
    return { items, snapshot }
  },

  async fetchHistory(
    coins: Coin[],
    historyLimit = 25,
    historyOffset = 0,
    options: { utxoOverlay?: boolean } = {},
  ): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    const items = await this.buildItems(enabled)
    const snapshot = await coinApiService.getWalletSnapshot({
      coins: items,
      historyLimit,
      historyOffset,
      includeNetwork: false,
      includeBalances: false,
      includeHistory: true,
      historyUtxoOverlay: options.utxoOverlay === true,
      expandAddresses: true,
    })
    return { items, snapshot }
  },

  async fetchBalancesChunked(
    coins: Coin[],
    options: { forceBalances?: boolean; chunkSize?: number; timeoutMs?: number } = {},
  ): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    if (enabled.length === 0) return { items: [], snapshot: emptySnapshot() }
    if (enabled.length <= (options.chunkSize ?? BALANCE_CHUNK_SIZE)) return this.fetchBalances(enabled, options)

    const results = await Promise.all(
      chunkCoins(enabled, options.chunkSize ?? BALANCE_CHUNK_SIZE).map(async (chunk) => {
        try {
          return await withTimeout(this.fetchBalances(chunk, options), options.timeoutMs)
        } catch {
          return { items: await this.buildItems(chunk), snapshot: emptySnapshot() }
        }
      }),
    )
    return mergeSnapshotResults(results)
  },

  async fetchNetwork(coins: Coin[]): Promise<WalletSnapshotResponse> {
    const enabled = coins.filter((coin) => coin.enabled)
    if (enabled.length === 0) return emptySnapshot()
    return coinApiService.getWalletSnapshot({
      coins: enabled.map((coin) => ({ coin: coin.id, addresses: [] })),
      includeNetwork: true,
      includeBalances: false,
      includeHistory: false,
      expandAddresses: false,
    })
  },

  async fetchSendReady(coins: Coin[]): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    const items = await this.buildItems(enabled)
    const snapshot = await coinApiService.getWalletSnapshot({
      coins: items,
      historyLimit: 0,
      historyOffset: 0,
      includeNetwork: true,
      includeBalances: true,
      includeHistory: false,
      expandAddresses: false,
    })
    return { items, snapshot }
  },

  async fetchSendReadyBalances(
    coins: Coin[],
    options: { forceBalances?: boolean } = {},
  ): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    if (enabled.length === 0) return { items: [], snapshot: emptySnapshot() }
    const items = await this.buildItems(enabled)
    const snapshot = await coinApiService.getWalletSnapshot({
      coins: items,
      historyLimit: 0,
      historyOffset: 0,
      includeNetwork: false,
      includeBalances: true,
      includeHistory: false,
      forceBalances: options.forceBalances === true,
      expandAddresses: false,
    })
    return { items, snapshot }
  },

  async fetchSendReadyBalancesChunked(
    coins: Coin[],
    options: { forceBalances?: boolean; chunkSize?: number; timeoutMs?: number } = {},
  ): Promise<{ items: WalletSnapshotItem[]; snapshot: WalletSnapshotResponse }> {
    const enabled = coins.filter((coin) => coin.enabled)
    if (enabled.length === 0) return { items: [], snapshot: emptySnapshot() }
    if (enabled.length <= (options.chunkSize ?? BALANCE_CHUNK_SIZE)) return this.fetchSendReadyBalances(enabled, options)

    const results = await Promise.all(
      chunkCoins(enabled, options.chunkSize ?? BALANCE_CHUNK_SIZE).map(async (chunk) => {
        try {
          return await withTimeout(this.fetchSendReadyBalances(chunk, options), options.timeoutMs)
        } catch {
          return { items: await this.buildItems(chunk), snapshot: emptySnapshot() }
        }
      }),
    )
    return mergeSnapshotResults(results)
  },
}
