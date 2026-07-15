import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'raptoreum', name: 'Raptoreum', ticker: 'RTM', networkId: 'raptoreum-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'address-index',
  cryptoParams: { p2pkhPrefix: 60, p2shPrefix: 16, wifPrefix: 128, derivationPath: "m/44'/10226'/0'/0/0" },
})
