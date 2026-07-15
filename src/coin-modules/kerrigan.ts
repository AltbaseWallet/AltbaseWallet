import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'kerrigan', name: 'Kerrigan', ticker: 'KER', networkId: 'kerrigan-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'address-index',
  cryptoParams: { p2pkhPrefix: 45, p2shPrefix: 16, wifPrefix: 204, derivationPath: "m/44'/16008'/0'/0/0", txVersion: 2 },
})
