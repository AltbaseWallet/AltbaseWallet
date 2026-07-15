import type { WalletAddresses } from './walletService'
import { storageService } from './storageService'

const WALLET_KEY = 'wallet-meta'
const WALLET_ADDRESSES_KEY = 'wallet-addresses'
const textEncoder = new TextEncoder()

type ScopedWalletMeta = {
  walletFingerprint?: string
}

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from({ length: Math.ceil(bytes.length / 0x8000) }, (_, index) =>
    String.fromCharCode(...bytes.subarray(index * 0x8000, (index + 1) * 0x8000)),
  ).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const cleanScope = (value: string) =>
  value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 80)

const addressScope = () => {
  const addresses = storageService.get<WalletAddresses>(WALLET_ADDRESSES_KEY, {})
  const raw = Object.entries(addresses)
    .filter(([, address]) => Boolean(address))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([coin, address]) => `${coin}:${address}`)
    .join('|')
  if (!raw) return 'no-wallet'
  try {
    return cleanScope(btoa(raw)) || 'wallet'
  } catch {
    return cleanScope(raw) || 'wallet'
  }
}

export const walletFingerprintFromMnemonic = async (mnemonic: string) => {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(`altbase-wallet-scope-v1|${normalized}`),
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

export const getWalletStorageScope = () => {
  const meta = storageService.get<ScopedWalletMeta | null>(WALLET_KEY, null)
  const fingerprint = typeof meta?.walletFingerprint === 'string'
    ? cleanScope(meta.walletFingerprint)
    : ''
  if (fingerprint) return `wf-${fingerprint}`
  return addressScope()
}
