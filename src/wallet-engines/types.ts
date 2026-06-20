import type { Coin, CoinWalletEngine } from '../types/coin'
import type { AddressVariant } from '../types/crypto'

export type WalletEngineKind = 'utxo' | 'privacy' | 'account'

export type WalletFeeEstimate = {
  satoshis: number
  coin: string
}

export type WalletFeeOptions = {
  force?: boolean
  fromAddress?: string
  toAddress?: string
  amountCoin?: string
}

export type WalletMaxSendResult = {
  amountCoin: string
  feeCoin: string
  feeSatoshis?: number
  inputCount?: number
}

export type WalletSendParams = {
  coin: Coin
  mnemonic: string
  fromAddress?: string
  toAddress: string
  amountCoin: string
  feeCoin?: string
  sendMax?: boolean
  memo?: string
}

export type WalletSendResult = {
  txid: string
  amountCoin?: string
  feeCoin?: string
  fee?: string
}

export type WalletEngine = {
  id: CoinWalletEngine
  kind: WalletEngineKind
  deriveAddress?: (coin: Coin, mnemonic: string) => Promise<string | undefined>
  getAddressVariants: (coin: Coin, address: string) => Promise<AddressVariant[]>
  validateAddress: (coin: Coin, address: string) => Promise<boolean>
  estimateFee: (coin: Coin, options?: WalletFeeOptions) => Promise<WalletFeeEstimate | null>
  estimateMinimumFee?: (coin: Coin, options?: WalletFeeOptions) => Promise<WalletFeeEstimate | null>
  estimateMaxSend?: (coin: Coin, address: string, feeCoin?: string, toAddress?: string) => Promise<WalletMaxSendResult>
  send: (params: WalletSendParams) => Promise<WalletSendResult>
  exportSecret?: (coin: Coin, mnemonic: string) => Promise<string>
}
