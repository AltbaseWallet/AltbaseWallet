import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'bitcoin', name: 'Bitcoin', ticker: 'BTC', explorerUrl: 'https://mempool.space',
  networkId: 'bitcoin-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  utxoReadProfile: 'mempool-space',
  cryptoParams: {
    p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128,
    derivationPath: "m/84'/0'/0'/0/0", bech32Hrp: 'bc',
    addressType: 'p2wpkh',
  },
})
