import type { CoinCryptoParams } from './crypto'

export type CoinStatus = 'active' | 'syncing' | 'preparing' | 'recovering' | 'offline' | 'maintenance'
export type CoinWalletEngine =
  | 'bitcoin-utxo'
  | 'pearl-utxo'
  | 'zano-light'
  | 'epic-light'
  | 'quai-account'
  | 'qubic-account'
  | 'kaspa-utxo'
  | 'ckb-cell'
export type UtxoReadProfile = 'address-index' | 'scan-utxo' | 'local-index' | 'blockbook' | 'mempool-space'

export type CoinRecoveryProgress = {
  fromHeight: number
  currentHeight: number
  tipHeight: number
  totalBlocks: number
  scannedBlocks: number
  blocksRemaining: number
  percent: number
}

export type Coin = {
  id: string
  name: string
  ticker: string
  iconUrl?: string
  balance: string
  /** Amount currently unlocked/spendable. Privacy coins can have balance > spendable while incoming funds mature. */
  spendableBalance?: string
  fiatValue?: number
  address: string
  status: CoinStatus
  enabled: boolean
  favorite: boolean
  explorerUrl?: string
  networkId: string
  /** Whether this coin supports memo / destination tag fields on sends */
  supportsMemo?: boolean
  /** Address-derivation parameters (P2PKH/WIF version bytes + BIP44 path) */
  cryptoParams?: CoinCryptoParams
  /** Satoshis-per-coin multiplier (most chains use 100_000_000) */
  satsPerCoin?: number
  /** Latest USD price per coin (fetched from api.altbase.io price feed) */
  priceUsd?: number
  /** Non-Bitcoin chains use a local wallet engine instead of UTXO signing. */
  walletEngine?: CoinWalletEngine
  /** Server-side UTXO read strategy used to keep balance/history synchronized. */
  utxoReadProfile?: UtxoReadProfile
  /** Some remote nodes can only read balances through a slow UTXO scan. */
  deferStartupBalance?: boolean
  /** Local privacy-wallet recovery progress; runtime-only, not persisted. */
  recoveryProgress?: CoinRecoveryProgress
}
