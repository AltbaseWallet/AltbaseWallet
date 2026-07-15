import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'kaspa', name: 'Kaspa', ticker: 'KAS', explorerUrl: 'https://explorer.kaspa.org',
  networkId: 'kaspa-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  walletEngine: 'kaspa-utxo',
}, 'kaspa-wasm')
