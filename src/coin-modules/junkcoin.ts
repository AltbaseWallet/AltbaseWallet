import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'junkcoin', name: 'Junkcoin', ticker: 'JKC', networkId: 'junkcoin-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'local-index',
  cryptoParams: { p2pkhPrefix: 16, p2shPrefix: 5, wifPrefix: 144, derivationPath: "m/44'/2013'/0'/0/0" },
})
