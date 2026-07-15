import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'capstash', name: 'CapStash', ticker: 'CAPS', networkId: 'capstash-mainnet',
  supportsMemo: false, satsPerCoin: 100_000_000, utxoReadProfile: 'scan-utxo',
  cryptoParams: { p2pkhPrefix: 28, p2shPrefix: 18, wifPrefix: 156, derivationPath: "m/44'/16005'/0'/0/0", bech32Hrp: 'cap' },
})
