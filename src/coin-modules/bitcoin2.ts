import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'bitcoin2', name: 'Bitcoin II', ticker: 'BC2',
  explorerUrl: 'https://explorer.bitcoin2.org', networkId: 'bitcoin2-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/16001'/0'/0/0", bech32Hrp: 'bc' },
})
