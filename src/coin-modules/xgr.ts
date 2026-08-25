import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'xgr', name: 'XGR', ticker: 'XGR', explorerUrl: 'https://explorer.xgr.network',
  networkId: 'xgr-mainnet-1643', supportsMemo: false, satsPerCoin: 100_000_000,
  walletEngine: 'xgr-account',
})
