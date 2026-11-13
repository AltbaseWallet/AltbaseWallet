import { useSyncExternalStore } from 'react'
import type { Coin } from '../types/coin'
import { privacyWalletService, type PrivacyCoin } from '../services/privacyWalletService'
import { privacyBalanceDisplay } from '../utils/privacyBalanceDisplay'
import { pluginReadiness } from '../services/pluginReadiness'

const subscribe = (listener: () => void) => privacyWalletService.onNativeReadinessChange(() => listener())
export const usePrivacyBalanceDisplay = (coin: Coin | undefined) => {
  const privacy = coin && ['zano', 'epic', 'monero'].includes(coin.id)
  const readiness = useSyncExternalStore(subscribe, () => privacy
    ? privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) : 'ready')
  const moduleState = useSyncExternalStore(pluginReadiness.subscribe, () => coin?.walletEngine === 'plugin' ? pluginReadiness.get(coin.id) : 'ready')
  if (coin?.walletEngine === 'plugin') {
    const unverified = moduleState !== 'ready' || coin.status !== 'active'
    const status = moduleState === 'error' ? 'offline' : moduleState === 'syncing' ? 'syncing' : moduleState === 'unknown' ? 'preparing' : coin.status
    return { unverified, hideZero: unverified && Number(coin.balance) === 0, status }
  }
  return coin ? privacyBalanceDisplay(coin, readiness) : { unverified: false, hideZero: false, status: 'offline' as const }
}
