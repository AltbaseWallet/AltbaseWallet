import { kaspaWalletService } from '../../services/kaspaWalletService'
import type { AddressVariant } from '../../types/crypto'
import type { WalletEngine } from '../types'

const dagVariant = (address: string): AddressVariant => ({ id: 'dag', label: 'Kaspa', address, scriptKind: 'dag' })

export const kaspaEngine: WalletEngine = {
  id: 'kaspa-utxo',
  kind: 'utxo',
  deriveAddress: (_coin, mnemonic) => kaspaWalletService.deriveAddress(mnemonic),
  async getAddressVariants(_coin, address) { return [dagVariant(address)] },
  async validateAddress(_coin, address) { return kaspaWalletService.isValidAddress(address) },
  async estimateFee(coin, options = {}) {
    if (options.fromAddress && options.toAddress && options.amountCoin) {
      return kaspaWalletService.estimateSendFee({
        coinId: coin.id,
        fromAddress: options.fromAddress,
        toAddress: options.toAddress,
        amountCoin: options.amountCoin,
        force: options.force,
      })
    }
    return kaspaWalletService.estimateFee(coin.id)
  },
  async estimateMinimumFee(coin) { return kaspaWalletService.estimateFee(coin.id) },
  async estimateMaxSend(coin, address, _feeCoin, toAddress) {
    return kaspaWalletService.estimateMaxSend(coin.id, address, toAddress)
  },
  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, sendMax }) {
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return kaspaWalletService.send({ coinId: coin.id, mnemonic, fromAddress, toAddress, amountCoin, sendMax })
  },
  async exportSecret(_coin, mnemonic) { return kaspaWalletService.exportPrivateKey(mnemonic) },
}
