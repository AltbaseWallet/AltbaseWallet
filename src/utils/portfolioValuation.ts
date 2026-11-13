import type { Coin } from '../types/coin'
export function portfolioValuation(coins: Coin[]) {
  const enabled = coins.filter(c => c.enabled)
  const unpriced = enabled.some(c => /^\d+(?:\.\d+)?$/.test(c.balance) && /[1-9]/.test(c.balance) && !(typeof c.priceUsd === 'number' && Number.isFinite(c.priceUsd) && c.priceUsd > 0))
  const total = enabled.reduce((sum, coin) => sum + (coin.fiatValue ?? 0), 0)
  return { total, unpriced }
}
