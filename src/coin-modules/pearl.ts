import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'pearl', name: 'Pearl', ticker: 'PRL', explorerUrl: 'https://blockbook.pearlresearch.ai',
  networkId: 'pearl-mainnet', supportsMemo: false, satsPerCoin: 100_000_000,
  utxoReadProfile: 'blockbook', walletEngine: 'pearl-utxo',
  cryptoParams: {
    p2pkhPrefix: 0, p2shPrefix: 0, wifPrefix: 128,
    derivationPath: "m/86'/808276'/0'/0/0", bech32Hrp: 'prl',
    addressType: 'p2tr', sighashStyle: 'taproot',
  },
})
