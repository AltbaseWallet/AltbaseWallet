import { defineCoinModule } from './types'

export default defineCoinModule({
  id: 'qubic', name: 'Qubic', ticker: 'QUBIC', explorerUrl: 'https://explorer.qubic.org',
  networkId: 'qubic-mainnet', supportsMemo: false, satsPerCoin: 1,
  walletEngine: 'qubic-account',
}, 'qubic-js')
