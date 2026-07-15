import { coinApiService } from '../../services/coinApiService'
import { coinTxService } from '../../services/coinTxService'
import { nativeCoreService } from '../../services/nativeCoreService'
import type { Coin } from '../../types/coin'
import type { AddressVariant } from '../../types/crypto'
import { addressVariantsFromLegacyAddress } from '../../utils/addressVariants'
import type { WalletEngine } from '../types'

const fallbackVariant = (address: string): AddressVariant => ({
  id: 'legacy',
  label: 'Legacy',
  address,
  scriptKind: 'p2pkh',
})

const mergeAddressVariants = (primary: AddressVariant[], secondary: AddressVariant[]) => {
  const byId = new Map<string, AddressVariant>()
  for (const variant of [...primary, ...secondary]) {
    if (!byId.has(variant.id)) byId.set(variant.id, variant)
  }
  return Array.from(byId.values())
}

const preferCashaddrCoinIds = new Set(['bitcoincashii'])

const cashaddrVariantFor = async (address: string, coin: Coin) => {
  if (!coin.cryptoParams || !coin.cryptoParams.cashaddrPrefix || !preferCashaddrCoinIds.has(coin.id)) return null
  const variants = await addressVariantsFromLegacyAddress(address, coin.cryptoParams).catch(() => [] as AddressVariant[])
  return variants.find((variant) => variant.id === 'cashaddr') ?? null
}

export const utxoEngine: WalletEngine = {
  id: 'bitcoin-utxo',
  kind: 'utxo',

  async deriveAddress(coin, mnemonic) {
    if (!coin.cryptoParams) return undefined
    const address = await nativeCoreService.deriveAddress(coin.id, mnemonic, coin.cryptoParams)
    return (await cashaddrVariantFor(address, coin))?.address ?? address
  },

  async getAddressVariants(coin, address) {
    if (!coin.cryptoParams) return [fallbackVariant(address)]
    const localVariants = await addressVariantsFromLegacyAddress(address, coin.cryptoParams).catch(() => [] as AddressVariant[])
    if (preferCashaddrCoinIds.has(coin.id) && localVariants.some((variant) => variant.id === 'cashaddr')) {
      return localVariants.filter((variant) => variant.id === 'cashaddr')
    }
    if (localVariants.length > 0) return localVariants

    try {
      const variants = await nativeCoreService.addressVariantsFromLegacy(coin.id, address, coin.cryptoParams)
      const merged = mergeAddressVariants(variants, localVariants)
      if (preferCashaddrCoinIds.has(coin.id) && merged.some((variant) => variant.id === 'cashaddr')) {
        return merged.filter((variant) => variant.id === 'cashaddr')
      }
      return merged.length > 0 ? merged : [fallbackVariant(address)]
    } catch {
      return [fallbackVariant(address)]
    }
  },

  async validateAddress(coin, address) {
    if (!coin.cryptoParams) return /^\S{8,}$/.test(address)
    const localValidation = await nativeCoreService.validateAddress(coin.id, address, coin.cryptoParams)
    if (localValidation.isValid) return true
    const daemonValidation = await coinApiService.validateAddress(coin.id, address).catch(() => null)
    return daemonValidation?.isvalid === true
  },

  async estimateFee(coin, options = {}) {
    if (!coin.cryptoParams) return null
    if (options.fromAddress && options.toAddress && options.amountCoin) {
      const estimate = await coinTxService.estimateSendFee({
        coinId: coin.id,
        cryptoParams: coin.cryptoParams,
        satsPerCoin: coin.satsPerCoin ?? 100_000_000,
        fromAddress: options.fromAddress,
        toAddress: options.toAddress,
        amountCoin: options.amountCoin,
        force: options.force,
      })
      return { ...estimate, exact: true }
    }
    return coinTxService.estimateFee(
      coin.id,
      coin.cryptoParams,
      coin.satsPerCoin ?? 100_000_000,
      1,
      2,
      options,
    )
  },

  async estimateMinimumFee(coin, options = {}) {
    if (!coin.cryptoParams) return null
    return coinTxService.estimateMinimumRelayFee(
      coin.id,
      coin.satsPerCoin ?? 100_000_000,
      1,
      2,
      options,
    )
  },

  async estimateMaxSend(coin, address, feeCoin) {
    if (!coin.cryptoParams) throw new Error(`Coin "${coin.id}" has no crypto parameters configured`)
    return coinTxService.estimateMaxSend({
      coinId: coin.id,
      cryptoParams: coin.cryptoParams,
      satsPerCoin: coin.satsPerCoin ?? 100_000_000,
      fromAddress: address,
      feeCoin,
    })
  },

  async send({ coin, mnemonic, fromAddress, toAddress, amountCoin, feeCoin, sendMax }) {
    if (!coin.cryptoParams) throw new Error(`Coin "${coin.id}" has no crypto parameters configured`)
    if (!fromAddress) throw new Error(`Address for ${coin.id} not derived yet - reopen the wallet`)
    return coinTxService.send({
      coinId: coin.id,
      cryptoParams: coin.cryptoParams,
      satsPerCoin: coin.satsPerCoin ?? 100_000_000,
      mnemonic,
      fromAddress,
      toAddress,
      amountCoin,
      feeCoin,
      sendMax,
    })
  },

  async exportSecret(coin, mnemonic) {
    if (!coin.cryptoParams) throw new Error(`coin-not-supported:${coin.id}`)
    return nativeCoreService.derivePrivateKeyWif(coin.id, mnemonic, coin.cryptoParams)
  },
}
