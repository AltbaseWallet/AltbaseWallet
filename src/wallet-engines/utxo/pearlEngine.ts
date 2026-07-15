import type { WalletEngine } from '../types'
import { utxoEngine } from './utxoEngine'

export const pearlEngine: WalletEngine = {
  ...utxoEngine,
  id: 'pearl-utxo',
}
