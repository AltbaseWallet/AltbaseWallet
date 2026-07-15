import type { Coin } from '../types/coin'
import { compareAmounts } from './decimalAmount'

const fiatValue = (coin: Coin) =>
  typeof coin.fiatValue === 'number' && Number.isFinite(coin.fiatValue) ? coin.fiatValue : 0

export const compareCoinsByPortfolioValue = (a: Coin, b: Coin) => {
  const byValue = fiatValue(b) - fiatValue(a)
  if (Math.abs(byValue) > 0.00000001) return byValue
  const byBalance = compareAmounts(b.balance || '0', a.balance || '0')
  return byBalance || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

export const sortCoinsByPortfolioValue = (coins: Coin[]) =>
  [...coins].sort(compareCoinsByPortfolioValue)

export const pickDefaultCoinId = (coins: Coin[], preferredId?: string | null) => {
  const enabled = coins.filter((coin) => coin.enabled)
  if (preferredId && enabled.some((coin) => coin.id === preferredId)) return preferredId
  return sortCoinsByPortfolioValue(enabled)[0]?.id ?? ''
}
