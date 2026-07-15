import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'btgs', name: 'Bitcoin Gold', ticker: 'BTGS', networkId: 'btgs-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 38, p2shPrefix: 22, wifPrefix: 176, derivationPath: "m/44'/18888'/0'/0/0", bech32Hrp: 'bcg' },
})
