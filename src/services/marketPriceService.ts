import type { Coin } from '../types/coin'

export type MarketPrices = {
  prices: Record<string, number>
  updatedAt: number | null
  priceUpdatedAt?: Record<string, number>
}

const QUOTE_MAX_AGE_MS = 30 * 60_000
let latest: MarketPrices | undefined
const fresh = (timestamp: unknown, now: number): timestamp is number =>
  typeof timestamp === 'number' && Number.isFinite(timestamp)
  && timestamp > 0 && timestamp <= now && now - timestamp <= QUOTE_MAX_AGE_MS

export const marketPriceService = {
  update(snapshot: MarketPrices) {
    latest = {
      prices: { ...snapshot.prices }, updatedAt: snapshot.updatedAt,
      priceUpdatedAt: { ...snapshot.priceUpdatedAt },
    }
  },

  apply(coin: Coin, now = Date.now()): Coin {
    const priceUsd = latest ? latest.prices[coin.id] : coin.priceUsd
    const timestamp = latest ? latest.priceUpdatedAt?.[coin.id] ?? latest.updatedAt : coin.priceUpdatedAt
    const valid = typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0 && fresh(timestamp, now)
    const balance = /^\d+(?:\.\d+)?$/.test(coin.balance) ? Number(coin.balance) : NaN
    const value = valid ? priceUsd * balance : NaN
    return {
      ...coin,
      priceUsd: valid ? priceUsd : undefined,
      priceUpdatedAt: valid ? timestamp : undefined,
      fiatValue: Number.isFinite(value) ? value : undefined,
    }
  },
}
