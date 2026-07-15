import { qubicWalletService } from '../../services/qubicWalletService'
import type { AddressVariant } from '../../types/crypto'
import type { WalletEngine } from '../types'

const identityVariant = (address: string): AddressVariant => ({
  id: 'account', label: 'Identity', address, scriptKind: 'account',
})

export const qubicEngine: WalletEngine = {
  id: 'qubic-account',
  kind: 'account',
  deriveAddress: (_coin, mnemonic) => qubicWalletService.deriveAddress(mnemonic),
  async getAddressVariants(_coin, address) { return [identityVariant(address)] },
  async validateAddress(_coin, address) { return qubicWalletService.isValidAddress(address) },
  async estimateFee() { return qubicWalletService.estimateFee() },
  async estimateMinimumFee() { return qubicWalletService.estimateFee() },
  async estimateMaxSend(coin, address) { return qubicWalletService.estimateMaxSend(coin.id, address) },
  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, sendMax }) {
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return qubicWalletService.send({ coinId: coin.id, mnemonic, fromAddress, toAddress, amountCoin, sendMax })
  },
  async exportSecret(_coin, mnemonic) { return qubicWalletService.exportSeed(mnemonic) },
}
