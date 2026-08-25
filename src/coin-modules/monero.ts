import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'monero', name: 'Monero', ticker: 'XMR', networkId: 'monero-mainnet',
  supportsMemo: false, satsPerCoin: 1_000_000_000_000, walletEngine: 'monero-light',
}, 'monero-wallet')
