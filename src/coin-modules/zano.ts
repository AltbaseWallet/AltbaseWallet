import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'zano', name: 'Zano', ticker: 'ZANO', networkId: 'zano-mainnet',
  supportsMemo: false, satsPerCoin: 1_000_000_000_000, walletEngine: 'zano-light',
}, 'zano-wallet')
