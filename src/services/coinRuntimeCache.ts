import type { Coin } from '../types/coin'
import { marketPriceService } from './marketPriceService'

export type CachedCoinRuntime = Pick<
  Coin,
  'id' | 'priceUsd' | 'priceUpdatedAt' | 'balance' | 'spendableBalance' | 'fiatValue' | 'status' | 'enabled' | 'favorite'
>

export const toCachedCoinRuntime = (coin: Coin): CachedCoinRuntime => ({
  id: coin.id,
  priceUsd: coin.priceUsd,
  priceUpdatedAt: coin.priceUpdatedAt,
  balance: coin.balance,
  spendableBalance: coin.spendableBalance,
  fiatValue: coin.fiatValue,
  status: coin.status,
  enabled: coin.enabled,
  favorite: coin.favorite,
})

export const applyCachedCoinRuntime = (base: Coin, stored?: Partial<CachedCoinRuntime>): Coin => marketPriceService.apply({
  ...base,
  enabled: stored?.enabled ?? base.enabled,
  favorite: stored?.favorite ?? base.favorite,
  priceUsd: stored?.priceUsd ?? base.priceUsd,
  priceUpdatedAt: stored?.priceUpdatedAt ?? base.priceUpdatedAt,
  balance: stored?.balance ?? base.balance,
  spendableBalance: stored?.spendableBalance ?? base.spendableBalance,
  fiatValue: stored?.fiatValue ?? base.fiatValue,
  status: stored?.status ?? base.status,
})
