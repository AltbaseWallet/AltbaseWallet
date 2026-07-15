import type { Coin } from '../types/coin'
import { coinModuleRegistry } from '../coin-modules'
import { quaiEngine } from './account/quaiEngine'
import { qubicEngine } from './account/qubicEngine'
import { ckbEngine } from './cell/ckbEngine'
import { privacyEngine } from './privacy/privacyEngine'
import type { WalletEngine, WalletEngineKind } from './types'
import { pearlEngine } from './utxo/pearlEngine'
import { utxoEngine } from './utxo/utxoEngine'
import { kaspaEngine } from './utxo/kaspaEngine'

const engineForCoin = (coin?: Pick<Coin, 'walletEngine'> | null): WalletEngine => {
  if (coin?.walletEngine === 'quai-account') return quaiEngine
  if (coin?.walletEngine === 'qubic-account') return qubicEngine
  if (coin?.walletEngine === 'kaspa-utxo') return kaspaEngine
  if (coin?.walletEngine === 'ckb-cell') return ckbEngine
  if (coin?.walletEngine === 'pearl-utxo') return pearlEngine
  if (coin?.walletEngine === 'zano-light' || coin?.walletEngine === 'epic-light') return privacyEngine
  return utxoEngine
}

export const walletEngineRegistry = {
  get: engineForCoin,

  moduleFor(coinId: string) {
    return coinModuleRegistry.require(coinId)
  },

  nativeRouteFor(coinId: string) {
    return coinModuleRegistry.require(coinId).nativeRoute
  },

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
