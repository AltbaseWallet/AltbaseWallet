import { coinApiService } from '../../services/coinApiService'
import { quaiWalletService } from '../../services/quaiWalletService'
import type { AddressVariant } from '../../types/crypto'
import type { WalletEngine } from '../types'

const accountAddressVariant = (address: string): AddressVariant => ({
  id: 'account',
  label: 'Address',
  address,
  scriptKind: 'account',
})

export const quaiEngine: WalletEngine = {
  id: 'quai-account',
  kind: 'account',

  async deriveAddress(_coin, mnemonic) {
    return quaiWalletService.deriveAddress(mnemonic)
  },

  async getAddressVariants(_coin, address) {
    return [accountAddressVariant(address)]
  },

  async validateAddress(coin, address) {
    if (!quaiWalletService.isValidAddress(address)) return false
    const daemonValidation = await coinApiService.validateAddress(coin.id, address).catch(() => null)
    return daemonValidation?.isvalid === true
  },

  async estimateFee(coin, options = {}) {
    return quaiWalletService.estimateFee(coin.id, options)
  },

  async estimateMinimumFee(coin, options = {}) {
    return quaiWalletService.estimateFee(coin.id, options)
  },

  async estimateMaxSend(coin, address, feeCoin, toAddress) {
    return quaiWalletService.estimateMaxSend(coin.id, address, feeCoin, toAddress)
  },

  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, feeCoin, sendMax }) {
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return quaiWalletService.send({
      coinId: coin.id,
      mnemonic,
      fromAddress,
      toAddress,
      amountCoin,
      feeCoin,
      sendMax,
    })
  },

  async exportSecret(_coin, mnemonic) {
    return quaiWalletService.getPrivateKey(mnemonic)
  },
}
