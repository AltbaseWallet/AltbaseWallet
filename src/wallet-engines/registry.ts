import type { Coin } from '../types/coin'
import { quaiEngine } from './account/quaiEngine'
import { privacyEngine } from './privacy/privacyEngine'
import type { WalletEngine, WalletEngineKind } from './types'
import { pearlEngine } from './utxo/pearlEngine'
import { utxoEngine } from './utxo/utxoEngine'

const engineForCoin = (coin?: Pick<Coin, 'walletEngine'> | null): WalletEngine => {
  if (coin?.walletEngine === 'quai-account') return quaiEngine
  if (coin?.walletEngine === 'pearl-utxo') return pearlEngine
  if (coin?.walletEngine === 'zano-light' || coin?.walletEngine === 'epic-light') return privacyEngine
  return utxoEngine
}

export const walletEngineRegistry = {
  get: engineForCoin,

  kindOf(coin?: Pick<Coin, 'walletEngine'> | null): WalletEngineKind {
    return engineForCoin(coin).kind
  },

  isUtxo(coin?: Pick<Coin, 'walletEngine'> | null) {
    return engineForCoin(coin).kind === 'utxo'
  },

  isPrivacy(coin?: Pick<Coin, 'walletEngine'> | null) {
    return engineForCoin(coin).kind === 'privacy'
  },

  isAccount(coin?: Pick<Coin, 'walletEngine'> | null) {
    return engineForCoin(coin).kind === 'account'
  },
}

export type { WalletEngine, WalletEngineKind, WalletFeeEstimate, WalletMaxSendResult, WalletSendParams, WalletSendResult } from './types'
export { PRIVACY_AUTO_FEES, privacyFeeForCoin } from './privacy/privacyEngine'
