import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'nonsense', name: 'Nonsense', ticker: 'NNN',
  networkId: 'nonsense-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  walletEngine: 'nonsense-utxo',
}, 'nonsense-wasm')
