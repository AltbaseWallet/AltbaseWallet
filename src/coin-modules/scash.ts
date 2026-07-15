import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'scash', name: 'Scash', ticker: 'SCASH', networkId: 'scash-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/805'/0'/0/0", bech32Hrp: 'scash' },
})
