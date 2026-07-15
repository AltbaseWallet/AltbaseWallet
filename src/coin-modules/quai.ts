import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'quai', name: 'Quai', ticker: 'QUAI', explorerUrl: 'https://quaiscan.io',
  networkId: 'quai-mainnet-cyprus1', supportsMemo: false, satsPerCoin: 100_000_000,
  walletEngine: 'quai-account',
}, 'quai-js')
