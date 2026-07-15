import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'firo', name: 'Firo', ticker: 'FIRO', explorerUrl: 'https://explorer.firo.org',
  networkId: 'firo-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  utxoReadProfile: 'address-index',
  cryptoParams: { p2pkhPrefix: 82, p2shPrefix: 7, wifPrefix: 210, derivationPath: "m/44'/136'/0'/0/0" },
})
