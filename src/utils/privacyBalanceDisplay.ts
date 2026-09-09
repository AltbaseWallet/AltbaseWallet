import type { Coin, CoinStatus } from '../types/coin'
import type { NativeReadiness } from '../services/privacyWalletTypes'

export const privacyBalanceDisplay = (coin: Pick<Coin, 'id' | 'status' | 'balance' | 'recoveryProgress'>, readiness: NativeReadiness) => {
  if (!['zano', 'epic', 'monero'].includes(coin.id)) return { unverified: false, hideZero: false, status: coin.status }
  const unverified = readiness !== 'ready' || coin.status !== 'active' || (coin.recoveryProgress?.blocksRemaining ?? 0) > 0
  const status: CoinStatus = coin.status !== 'active' ? coin.status
    : readiness === 'error' ? 'offline'
    : readiness === 'unknown' ? 'preparing'
    : unverified ? 'syncing' : 'active'
  return { unverified, hideZero: unverified && Number(coin.balance) === 0, status }
}
