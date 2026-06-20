import { nativeCoreService } from '../../services/nativeCoreService'
import { privacyWalletService, type PrivacyCoin } from '../../services/privacyWalletService'
import type { AddressVariant } from '../../types/crypto'
import { toBaseUnits } from '../../utils/decimalAmount'
import type { WalletEngine, WalletFeeEstimate } from '../types'

export const PRIVACY_AUTO_FEES: Record<PrivacyCoin, string> = {
  epic: '0.01',
  zano: '0.01',
}

const decimalsForScale = (scale = 100_000_000) => {
  let value = Math.max(1, Math.trunc(scale))
  let decimals = 0
  while (value > 1 && value % 10 === 0) {
    value /= 10
    decimals += 1
  }
  return value === 1 ? decimals : 8
}

export const privacyFeeForCoin = (coinId: string, satsPerCoin = 100_000_000): WalletFeeEstimate | null => {
  const fee = PRIVACY_AUTO_FEES[coinId as PrivacyCoin]
  if (!fee) return null
  return {
    satoshis: Number(toBaseUnits(fee, decimalsForScale(satsPerCoin))),
    coin: fee,
  }
}

const privacyAddressVariant = (address: string): AddressVariant => ({
  id: 'privacy',
  label: 'Address',
  address,
  scriptKind: 'privacy',
})

export const privacyEngine: WalletEngine = {
  id: 'zano-light',
  kind: 'privacy',

  async deriveAddress(coin, mnemonic) {
    const result = await privacyWalletService.ensureWallet(coin.id as PrivacyCoin, mnemonic)
    return result.address
  },

  async getAddressVariants(_coin, address) {
    return [privacyAddressVariant(address)]
  },

  async validateAddress(_coin, address) {
    return /^\S{8,}$/.test(address)
  },

  async estimateFee(coin) {
    return privacyFeeForCoin(coin.id, coin.satsPerCoin ?? 100_000_000)
  },

  async estimateMinimumFee(coin) {
    return privacyFeeForCoin(coin.id, coin.satsPerCoin ?? 100_000_000)
  },

  async send({ coin, mnemonic, toAddress, amountCoin, feeCoin, memo, sendMax }) {
    const result = await privacyWalletService.send(
      coin.id as PrivacyCoin,
      mnemonic,
      toAddress,
      amountCoin,
      feeCoin,
      memo,
      sendMax === true,
    )
    if (!result.txid) throw new Error('Local wallet engine did not return a transaction id')
    return {
      txid: result.txid,
      amountCoin: result.amount || amountCoin,
      fee: result.fee,
      feeCoin: result.fee,
    }
  },

  async exportSecret(coin, mnemonic) {
    const secret = await nativeCoreService.privacyWalletSecret(coin.id as PrivacyCoin, mnemonic)
    return secret.seed
  },
}
