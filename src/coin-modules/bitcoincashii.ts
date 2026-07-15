import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'bitcoincashii', name: 'Bitcoin Cash II', ticker: 'BCH2',
  networkId: 'bitcoincashII-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/145'/0'/0/0", sighashStyle: 'bip143-forkid', cashaddrPrefix: 'bitcoincashii' },
})
