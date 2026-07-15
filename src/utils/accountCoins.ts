import type { Coin } from '../types/coin'
import { walletEngineRegistry } from '../wallet-engines/registry'

export const isAccountCoin = (coin?: Pick<Coin, 'walletEngine'> | null) =>
  walletEngineRegistry.isAccount(coin)
