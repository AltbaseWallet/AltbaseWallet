export type WalletState = {
  isCreated: boolean
  isUnlocked: boolean
  encryptedVaultExists: boolean
  selectedCoinId: string | null
}

export type AuthState =
  | 'not_initialized'
  | 'wallet_not_created'
  | 'creating_wallet'
  | 'restoring_wallet'
  | 'locked'
  | 'unlocked'
