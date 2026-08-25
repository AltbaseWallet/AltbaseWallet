import { epicPrivacyWalletService } from './privacy/epicPrivacyWalletService'
import { moneroPrivacyWalletService } from './privacy/moneroPrivacyWalletService'
import { zanoPrivacyWalletService } from './privacy/zanoPrivacyWalletService'
import type {
  NativePrivacyRecoveryProgress,
  NativeReadiness,
  PrivacyCoin,
  PrivacyCoinWalletService,
  PrivacyReadinessListener,
  PrivacyWalletResponse,
} from './privacyWalletTypes'

const zanoModule: PrivacyCoinWalletService = {
  getCachedSnapshot: (mnemonic) => zanoPrivacyWalletService.getCachedSnapshot('zano', mnemonic),
  ensureWallet: (mnemonic) => zanoPrivacyWalletService.ensureWallet('zano', mnemonic),
  warmWallet: (mnemonic) => zanoPrivacyWalletService.warmWallet('zano', mnemonic),
  getSnapshot: (mnemonic, onProgress) => zanoPrivacyWalletService.getSnapshot('zano', mnemonic, onProgress),
  rescan: (mnemonic, fromHeight, onProgress) => zanoPrivacyWalletService.rescan('zano', mnemonic, fromHeight, onProgress),
  send: (mnemonic, to, amount, fee, memo, sendMax) => (
    zanoPrivacyWalletService.send('zano', mnemonic, to, amount, fee, memo, sendMax)
  ),
  getNativeReadiness: () => zanoPrivacyWalletService.getNativeReadiness('zano'),
  onNativeReadinessChange: (listener) => zanoPrivacyWalletService.onNativeReadinessChange(listener),
  resetNativeReadiness: () => zanoPrivacyWalletService.resetNativeReadiness('zano'),
}

const privacyModules: Record<PrivacyCoin, PrivacyCoinWalletService> = {
  zano: zanoModule,
  epic: epicPrivacyWalletService,
  monero: moneroPrivacyWalletService,
}

const moduleFor = (coin: PrivacyCoin) => privacyModules[coin]

export const privacyWalletService = {
  getCachedSnapshot(coin: PrivacyCoin, mnemonic: string) {
    return moduleFor(coin).getCachedSnapshot(mnemonic)
  },

  ensureWallet(coin: PrivacyCoin, mnemonic: string) {
    return moduleFor(coin).ensureWallet(mnemonic)
  },

  warmWallet(coin: PrivacyCoin, mnemonic: string) {
    return moduleFor(coin).warmWallet(mnemonic)
  },

  getSnapshot(
    coin: PrivacyCoin,
    mnemonic?: string,
    onProgress?: (progress: NativePrivacyRecoveryProgress) => void,
  ) {
    return moduleFor(coin).getSnapshot(mnemonic, onProgress)
  },

  rescan(
    coin: PrivacyCoin,
    mnemonic: string,
    fromHeight: number,
    onProgress?: (progress: NativePrivacyRecoveryProgress) => void,
  ) {
    return moduleFor(coin).rescan(mnemonic, fromHeight, onProgress)
  },

  estimateMaxSend(coin: PrivacyCoin, mnemonic: string, fee?: string) {
    const estimate = moduleFor(coin).estimateMaxSend
    if (!estimate) throw new Error(`${coin} does not expose an exact MAX estimator`)
    return estimate(mnemonic, fee)
  },

  send(
    coin: PrivacyCoin,
    mnemonic: string,
    to: string,
    amount: string,
    fee?: string,
    memo?: string,
    sendMax?: boolean,
  ) {
    return moduleFor(coin).send(mnemonic, to, amount, fee, memo, sendMax)
  },

  getNativeReadiness(coin: PrivacyCoin) {
    return moduleFor(coin).getNativeReadiness()
  },

  onNativeReadinessChange(listener: PrivacyReadinessListener) {
    const unsubscribers = Object.values(privacyModules).map((module) => (
      module.onNativeReadinessChange(listener)
    ))
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  },

  resetNativeReadiness(coin?: PrivacyCoin) {
    if (coin) {
      moduleFor(coin).resetNativeReadiness()
      return
    }
    for (const module of Object.values(privacyModules)) module.resetNativeReadiness()
  },
}

export type {
  NativePrivacyRecoveryProgress,
  NativeReadiness,
  PrivacyCoin,
  PrivacyWalletResponse,
}
