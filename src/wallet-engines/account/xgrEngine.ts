import { xgrWalletService } from '../../services/xgrWalletService'
import type { AddressVariant } from '../../types/crypto'
import type { WalletEngine } from '../types'

const accountAddressVariant = (address: string): AddressVariant => ({
  id: 'account',
  label: 'Address',
  address,
  scriptKind: 'account',
})

export const xgrEngine: WalletEngine = {
  id: 'xgr-account',
  kind: 'account',

  async deriveAddress(_coin, mnemonic) {
    return xgrWalletService.deriveAddress(mnemonic)
  },

  async getAddressVariants(_coin, address) {
    return [accountAddressVariant(address)]
  },

  async validateAddress(_coin, address) {
    return xgrWalletService.isValidAddress(address)
  },

  async estimateFee(coin, options = {}) {
    return xgrWalletService.estimateFee(coin.id, options)
  },

  async estimateMinimumFee(coin, options = {}) {
    return xgrWalletService.estimateFee(coin.id, options)
  },

  async estimateMaxSend(coin, address, feeCoin, toAddress) {
    return xgrWalletService.estimateMaxSend(
      coin.id,
      address,
      feeCoin,
      toAddress,
      coin.spendableBalance ?? coin.balance ?? '0',
    )
  },

  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, feeCoin, sendMax }) {
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return xgrWalletService.send({
      coinId: coin.id,
      mnemonic,
      fromAddress,
      toAddress,
      amountCoin,
      feeCoin,
      sendMax,
      knownSpendableCoin: coin.spendableBalance ?? coin.balance ?? '0',
    })
  },

  async exportSecret(_coin, mnemonic) {
    return xgrWalletService.getPrivateKey(mnemonic)
  },
}
