import type { CoinCryptoParams } from '../types/crypto'
import { nativeCoreService } from '../services/nativeCoreService'

export const walletAddressSetFromLegacy = async (
  coinId: string,
  baseAddress: string,
  params?: CoinCryptoParams,
  options: { includeAliases?: boolean } = {},
) => {
  const addresses = new Set<string>()
  if (baseAddress) addresses.add(baseAddress)
  if (!baseAddress || !params) return addresses

  try {
    const variants = await nativeCoreService.addressVariantsFromLegacy(coinId, baseAddress, params)
    for (const variant of variants) {
      if (variant.aliasOfLegacy && options.includeAliases === false) continue
      addresses.add(variant.address)
    }
  } catch {
    // Keep the base address; callers can still compare exact legacy matches.
  }
  return addresses
}

export const isWalletAddressVariant = async (
  coinId: string,
  address: string | undefined,
  baseAddress: string,
  params?: CoinCryptoParams,
) => {
  if (!address) return false
  const addresses = await walletAddressSetFromLegacy(coinId, baseAddress, params)
  return addresses.has(address)
}
