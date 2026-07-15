import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'neoxa', name: 'Neoxa', ticker: 'NEOX', networkId: 'neoxa-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'blockbook',
  cryptoParams: { p2pkhPrefix: 38, p2shPrefix: 122, wifPrefix: 112, derivationPath: "m/44'/1668'/0'/0/0" },
})
