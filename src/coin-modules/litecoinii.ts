import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'litecoinii', name: 'LitecoinII', ticker: 'LC2', networkId: 'litecoinii-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 48, p2shPrefix: 5, wifPrefix: 176, derivationPath: "m/44'/2102'/0'/0/0", bech32Hrp: 'lc2' },
})
