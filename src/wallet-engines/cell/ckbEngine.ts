import { ckbWalletService } from '../../services/ckbWalletService'
import type { AddressVariant } from '../../types/crypto'
import type { WalletEngine } from '../types'

const cellVariant = (address: string): AddressVariant => ({ id: 'cell', label: 'CKB', address, scriptKind: 'cell' })

export const ckbEngine: WalletEngine = {
  id: 'ckb-cell',
  kind: 'utxo',
  deriveAddress: (_coin, mnemonic) => ckbWalletService.deriveAddress(mnemonic),
  async getAddressVariants(_coin, address) { return [cellVariant(address)] },
  async validateAddress(_coin, address) { return ckbWalletService.isValidAddress(address) },
  async estimateFee(coin) { return ckbWalletService.estimateFee(coin.id) },
  async estimateMinimumFee(coin) { return ckbWalletService.estimateFee(coin.id) },
  async estimateMaxSend(coin, address) { return ckbWalletService.estimateMaxSend(coin.id, address) },
  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, sendMax }) {
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return ckbWalletService.send({ coinId: coin.id, mnemonic, fromAddress, toAddress, amountCoin, sendMax })
  },
  async exportSecret(_coin, mnemonic) { return ckbWalletService.exportPrivateKey(mnemonic) },
}
