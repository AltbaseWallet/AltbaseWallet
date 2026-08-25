import { nativeCoreService } from '../../services/nativeCoreService'
import { privacyWalletService, type PrivacyCoin } from '../../services/privacyWalletService'
import type { AddressVariant } from '../../types/crypto'
import { toBaseUnits } from '../../utils/decimalAmount'
import type { WalletEngine, WalletFeeEstimate } from '../types'

export const PRIVACY_AUTO_FEES: Record<PrivacyCoin, string> = {
  // A standard Epicbox send spends one wallet output and creates the
  // recipient plus change outputs: (1 * 4 + 2 * 1 + 1) * 0.001 EPIC.
  // The native MAX path recalculates this when the selected input/output
  // shape differs, but it needs this realistic seed fee to start that loop.
  epic: '0.007',
  zano: '0.01',
  monero: '0.0001',
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

  async validateAddress(coin, address) {
    if (coin.id === 'monero') {
      return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(address)
        || /^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(address)
    }
    return /^\S{8,}$/.test(address)
  },

  async estimateFee(coin) {
    return privacyFeeForCoin(coin.id, coin.satsPerCoin ?? 100_000_000)
  },

  async estimateMinimumFee(coin) {
    return privacyFeeForCoin(coin.id, coin.satsPerCoin ?? 100_000_000)
  },

  async estimateMaxSend(coin, _address, feeCoin, _toAddress, mnemonic) {
    if (coin.id !== 'epic' || !mnemonic) {
      throw new Error('Exact privacy MAX estimation is available only for an unlocked Epic wallet')
    }
    const result = await privacyWalletService.estimateMaxSend('epic', mnemonic, feeCoin)
    if (!result.amount || !result.fee) throw new Error('Epic MAX estimator did not return an amount and fee')
    return {
      amountCoin: result.amount,
      feeCoin: result.fee,
      feeSatoshis: Number(toBaseUnits(result.fee, decimalsForScale(coin.satsPerCoin ?? 100_000_000))),
    }
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
