import { create } from 'zustand'
import { walletService } from '../services/walletService'
import { storageService } from '../services/storageService'
import { buildWalletLoadProgress, type WalletLoadProgressHandler } from '../types/walletLoadProgress'
import { useCoinStore } from './coinStore'
import { useTransactionStore } from './transactionStore'

const LOCK_STATE_KEY = 'auth-lock-state'
const MAX_ATTEMPTS = 5
const LOCK_LADDER_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000]

type LockState = {
  attempts: number
  lockedUntil: number | null
  lockLevel: number
}

const defaultLockState: LockState = { attempts: 0, lockedUntil: null, lockLevel: 0 }

const readLockState = (): LockState => storageService.get<LockState>(LOCK_STATE_KEY, defaultLockState)
const writeLockState = (state: LockState) => storageService.set<LockState>(LOCK_STATE_KEY, state)
const resetLockState = () => writeLockState(defaultLockState)

const nextLockDuration = (level: number) => LOCK_LADDER_MS[Math.min(level, LOCK_LADDER_MS.length - 1)]

type AuthStore = {
  isCreated: boolean
  isUnlocked: boolean
  attempts: number
  lockedUntil: number | null
  generatedSeed: string | null
  /** Decrypted mnemonic kept in memory after unlock — cleared on lock/quit */
  sessionMnemonic: string | null
  initialize: () => void
  createWallet: (password: string) => Promise<void>
  restoreWallet: (
    seedPhrase: string,
    password: string,
    onProgress?: WalletLoadProgressHandler,
    options?: { seedSafetyAcknowledged?: boolean },
  ) => Promise<void>
  unlock: (password: string, onProgress?: WalletLoadProgressHandler) => Promise<boolean>
  lock: () => void
  clearWallet: () => void
  cancelWalletSetup: () => void
  clearGeneratedSeed: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  isCreated: false,
  isUnlocked: false,
  attempts: 0,
  lockedUntil: null,
  generatedSeed: null,
  sessionMnemonic: null,

  initialize: () => {
    const lock = readLockState()
    set({
      isCreated: walletService.walletExists(),
      isUnlocked: false,
      attempts: lock.attempts,
      lockedUntil: lock.lockedUntil,
    })
  },

  createWallet: async (password) => {
    set({ isUnlocked: false, sessionMnemonic: null })
    await walletService.lockWallet()
    useTransactionStore.getState().resetTransactions()
    await useCoinStore.getState().resetCoinsForCurrentWallet()
    const { seedPhrase } = await walletService.createWallet(password)
    resetLockState()
    set({
      isCreated: true,
      isUnlocked: false,
      generatedSeed: seedPhrase,
      attempts: 0,
      lockedUntil: null,
    })
  },

  restoreWallet: async (seedPhrase, password, onProgress, options) => {
    set({ isUnlocked: false, sessionMnemonic: null })
    await walletService.lockWallet()
    useTransactionStore.getState().resetTransactions()
    await useCoinStore.getState().resetCoinsForCurrentWallet()
    await walletService.restoreWallet(seedPhrase, password, onProgress, options)
    useTransactionStore.getState().resetTransactions()
    await useCoinStore.getState().resetCoinsForCurrentWallet()
    resetLockState()
    // Cache mnemonic in memory so subsequent sends don't need to re-prompt for password
    const sessionMnemonic =
      walletService.getSessionMnemonic() ?? (await walletService.getSeedPhrase(password).catch(() => null))
    set({
      isCreated: true,
      isUnlocked: false,
      attempts: 0,
      lockedUntil: null,
      generatedSeed: null,
      sessionMnemonic,
    })
    walletService.warmPrivacyAddresses()

    await useCoinStore.getState().loadSendReadyState(onProgress)
    onProgress?.(buildWalletLoadProgress('history'))
    void useTransactionStore.getState()
      .loadTransactions({ page: 1, force: true, silent: true, startup: true })
      .catch(() => undefined)
    set({ isUnlocked: true })
    onProgress?.(buildWalletLoadProgress('ready'))
  },

  unlock: async (password, onProgress) => {
    const persisted = readLockState()
    if (persisted.lockedUntil && Date.now() < persisted.lockedUntil) {
      set({ attempts: persisted.attempts, lockedUntil: persisted.lockedUntil })
      return false
    }

    onProgress?.(buildWalletLoadProgress('password'))
    const previousScope = walletService.getWalletStorageScope()
    const ok = await walletService.unlockWallet(password, onProgress)
    if (ok) {
      resetLockState()
      const nextScope = walletService.getWalletStorageScope()
      if (previousScope !== nextScope) {
        useTransactionStore.getState().resetTransactions()
        await useCoinStore.getState().resetCoinsForCurrentWallet()
      }

      // Cache mnemonic for the rest of the session (in memory only, never persisted).
      const sessionMnemonic =
        walletService.getSessionMnemonic() ?? (await walletService.getSeedPhrase(password).catch(() => null))
      set({ sessionMnemonic, attempts: 0, lockedUntil: null })
      walletService.warmPrivacyAddresses()

      await useCoinStore.getState().loadSendReadyState(onProgress)
      onProgress?.(buildWalletLoadProgress('history'))
      void useTransactionStore.getState()
        .loadTransactions({ page: 1, force: true, silent: true, startup: true })
        .catch(() => undefined)
      set({ isUnlocked: true })
      onProgress?.(buildWalletLoadProgress('ready'))
      return true
    }

    const attempts = persisted.attempts + 1
    const reachedThreshold = attempts >= MAX_ATTEMPTS
    const lockLevel = reachedThreshold ? persisted.lockLevel + 1 : persisted.lockLevel
    const lockedUntil = reachedThreshold ? Date.now() + nextLockDuration(persisted.lockLevel) : null

    const nextState: LockState = {
      attempts: reachedThreshold ? 0 : attempts,
      lockedUntil,
      lockLevel,
    }
    writeLockState(nextState)
    set({ attempts: nextState.attempts, lockedUntil: nextState.lockedUntil })
    return false
  },

  lock: () => {
    walletService.lockWallet()
    set({ isUnlocked: false, sessionMnemonic: null })
  },

  clearWallet: () => {
    walletService.clearWallet()
    useTransactionStore.getState().resetTransactions()
    void useCoinStore.getState().resetCoinsForCurrentWallet()
    resetLockState()
    set({
      isCreated: false,
      isUnlocked: false,
      generatedSeed: null,
      sessionMnemonic: null,
      attempts: 0,
      lockedUntil: null,
    })
  },

  cancelWalletSetup: () => {
    useTransactionStore.getState().resetTransactions()
    void useCoinStore.getState().resetCoinsForCurrentWallet()
    walletService.discardWalletSetup()
    resetLockState()
    set({
      isCreated: false,
      isUnlocked: false,
      generatedSeed: null,
      sessionMnemonic: null,
      attempts: 0,
      lockedUntil: null,
    })
  },

  clearGeneratedSeed: () => {
    set({ generatedSeed: null })
  },
}))
