import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'mydogecoin', name: 'Mydogecoin', ticker: 'MYDOGE', networkId: 'mydogecoin-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 51, p2shPrefix: 30, wifPrefix: 158, derivationPath: "m/44'/1995'/0'/0/0" },
})
