import type { NativePrivacyRecoveryProgress } from './nativeCoreService'

export type PrivacyCoin = 'zano' | 'epic' | 'monero'

export type PrivacyWalletResponse = {
  ok: boolean
  address?: string
  balance?: string
  spendable?: string
  transactions?: unknown[]
  restoreStartHeight?: number
  lastScannedHeight?: number
  scanState?: string
  sourceCode?: string
  verifiedSpendState?: boolean
  nativeWalletFileName?: string
  nativeWalletFileBlob?: string
  nativeWalletFileSize?: number
  txid?: string
  amount?: string
  fee?: string
  serverStatus?: string
  error?: string
  code?: string
  cacheHistoryRegression?: boolean
}

export type NativeReadiness = 'unknown' | 'syncing' | 'ready' | 'error'
export type NativeReadinessSource = 'ensure' | 'warm' | 'snapshot' | 'send'
export type PrivacyProgressListener = (progress: NativePrivacyRecoveryProgress) => void
export type PrivacyReadinessListener = (coin: PrivacyCoin, readiness: NativeReadiness) => void

export type PrivacyCoinWalletService = {
  getCachedSnapshot(mnemonic: string): Promise<PrivacyWalletResponse | null>
  ensureWallet(mnemonic: string): Promise<PrivacyWalletResponse>
  warmWallet(mnemonic: string): Promise<PrivacyWalletResponse>
  getSnapshot(mnemonic?: string, onProgress?: PrivacyProgressListener): Promise<PrivacyWalletResponse>
  rescan(mnemonic: string, fromHeight: number, onProgress?: PrivacyProgressListener): Promise<PrivacyWalletResponse>
  estimateMaxSend?(mnemonic: string, fee?: string): Promise<PrivacyWalletResponse>
  send(mnemonic: string, to: string, amount: string, fee?: string, memo?: string, sendMax?: boolean): Promise<PrivacyWalletResponse>
  getNativeReadiness(): NativeReadiness
  onNativeReadinessChange(listener: PrivacyReadinessListener): () => void
  resetNativeReadiness(): void
}

export type { NativePrivacyRecoveryProgress }
