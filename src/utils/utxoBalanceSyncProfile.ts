import type { Coin, UtxoReadProfile } from '../types/coin'
import { isUtxoCoin } from './utxoCoins'

type UtxoBalanceSyncProfile = {
  refreshBeforeHistoryCommit: boolean
  freshIncomingOverlay: boolean
}

const DEFAULT_PROFILE: UtxoBalanceSyncProfile = {
  refreshBeforeHistoryCommit: true,
  freshIncomingOverlay: true,
}

const PROFILES: Record<UtxoReadProfile, UtxoBalanceSyncProfile> = {
  'address-index': {
    refreshBeforeHistoryCommit: true,
    freshIncomingOverlay: true,
  },
  'scan-utxo': {
    refreshBeforeHistoryCommit: true,
    freshIncomingOverlay: true,
  },
  'local-index': {
    refreshBeforeHistoryCommit: true,
    freshIncomingOverlay: true,
  },
  blockbook: {
    refreshBeforeHistoryCommit: true,
    freshIncomingOverlay: true,
  },
}

export const utxoBalanceSyncProfileFor = (
  coin?: Pick<Coin, 'walletEngine' | 'utxoReadProfile'> | null,
): UtxoBalanceSyncProfile => {
  if (!coin || !isUtxoCoin(coin)) return { refreshBeforeHistoryCommit: false, freshIncomingOverlay: false }
  return PROFILES[coin.utxoReadProfile ?? 'address-index'] ?? DEFAULT_PROFILE
}

export const shouldRefreshUtxoBalanceBeforeHistoryCommit = (
  coin?: Pick<Coin, 'walletEngine' | 'utxoReadProfile'> | null,
) => utxoBalanceSyncProfileFor(coin).refreshBeforeHistoryCommit

export const shouldUseFreshIncomingUtxoOverlay = (
  coin?: Pick<Coin, 'walletEngine' | 'utxoReadProfile'> | null,
) => utxoBalanceSyncProfileFor(coin).freshIncomingOverlay
