import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'terracoin', name: 'Terracoin', ticker: 'TRC', networkId: 'terracoin-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'address-index',
  cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/83'/0'/0/0" },
})
