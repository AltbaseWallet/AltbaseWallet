import { nonsenseWalletService } from '../../services/nonsenseWalletService'
import type { AddressVariant } from '../../types/crypto'
import type { WalletEngine } from '../types'

const dagVariant = (address: string): AddressVariant => ({ id: 'dag', label: 'Nonsense', address, scriptKind: 'dag' })

export const nonsenseEngine: WalletEngine = {
  id: 'nonsense-utxo',
  kind: 'utxo',
  deriveAddress: (_coin, mnemonic) => nonsenseWalletService.deriveAddress(mnemonic),
  async getAddressVariants(_coin, address) { return [dagVariant(address)] },
  async validateAddress(_coin, address) { return nonsenseWalletService.isValidAddress(address) },
  async estimateFee(coin, options = {}) {
    if (options.fromAddress && options.toAddress && options.amountCoin) {
      return nonsenseWalletService.estimateSendFee({
        coinId: coin.id,
        fromAddress: options.fromAddress,
        toAddress: options.toAddress,
        amountCoin: options.amountCoin,
        force: options.force,
      })
    }
    return nonsenseWalletService.estimateFee(coin.id)
  },
  async estimateMinimumFee(coin) { return nonsenseWalletService.estimateFee(coin.id) },
  async estimateMaxSend(coin, address, _feeCoin, toAddress) {
    return nonsenseWalletService.estimateMaxSend(coin.id, address, toAddress)
  },
  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, sendMax, maxFeeCoin }) {
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return nonsenseWalletService.send({ coinId: coin.id, mnemonic, fromAddress, toAddress, amountCoin, sendMax, maxFeeCoin })
  },
  async exportSecret(_coin, mnemonic) { return nonsenseWalletService.exportPrivateKey(mnemonic) },
}
