import type { Coin } from '../types/coin'
import { walletEngineRegistry } from '../wallet-engines/registry'

export const isPrivacyCoin = (coin?: Pick<Coin, 'walletEngine'> | null) =>
  walletEngineRegistry.isPrivacy(coin)
