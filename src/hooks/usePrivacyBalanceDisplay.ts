import { useSyncExternalStore } from 'react'
import type { Coin } from '../types/coin'
import { privacyWalletService, type PrivacyCoin } from '../services/privacyWalletService'
import { privacyBalanceDisplay } from '../utils/privacyBalanceDisplay'

const subscribe = (listener: () => void) => privacyWalletService.onNativeReadinessChange(() => listener())
export const usePrivacyBalanceDisplay = (coin: Coin | undefined) => {
  const privacy = coin && ['zano', 'epic', 'monero'].includes(coin.id)
  const readiness = useSyncExternalStore(subscribe, () => privacy
    ? privacyWalletService.getNativeReadiness(coin.id as PrivacyCoin) : 'ready')
  return coin ? privacyBalanceDisplay(coin, readiness) : { unverified: false, hideZero: false, status: 'offline' as const }
}
