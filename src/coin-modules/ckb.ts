import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'ckb', name: 'Nervos', ticker: 'CKB', explorerUrl: 'https://explorer.nervos.org',
  networkId: 'ckb-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  walletEngine: 'ckb-cell',
}, 'ckb-lumos')
