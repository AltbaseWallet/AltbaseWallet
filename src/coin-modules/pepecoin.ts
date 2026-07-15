import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'pepecoin', name: 'Pepecoin', ticker: 'PEPE', explorerUrl: 'https://pepeblocks.com',
  networkId: 'pepecoin-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  utxoReadProfile: 'local-index',
  cryptoParams: { p2pkhPrefix: 56, p2shPrefix: 22, wifPrefix: 158, derivationPath: "m/44'/3434'/0'/0/0" },
})
