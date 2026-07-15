import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'hypercoin', name: 'Hypercoin', ticker: 'HRC', networkId: 'hypercoin-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/1935'/0'/0/0", bech32Hrp: 'hc' },
})
