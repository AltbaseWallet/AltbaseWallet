import type { Coin } from '../types/coin'
import { walletEngineRegistry } from '../wallet-engines/registry'

export const isUtxoCoin = (coin?: Pick<Coin, 'walletEngine'> | null) =>
  walletEngineRegistry.isUtxo(coin)
