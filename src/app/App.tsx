import { HashRouter, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { Providers } from './providers'
import { AppRouter } from './router'
import { GlobalToast } from '../components/wallet/GlobalToast'
import { AppUpdateNotice } from '../components/wallet/AppUpdateNotice'
import { useAuthStore } from '../store/authStore'
import { useCoinStore } from '../store/coinStore'
import { useTransactionStore } from '../store/transactionStore'
import { useSettingsStore } from '../store/settingsStore'
import { quaiDebugLog, quaiDebugLogError } from '../utils/quaiDebugLog'

function AutoLock() {
  const lock = useAuthStore((state) => state.lock)
  const isUnlocked = useAuthStore((state) => state.isUnlocked)
  const autoLockMinutes = useSettingsStore((state) => state.settings.autoLockMinutes)

  useEffect(() => {
    if (!isUnlocked || autoLockMinutes === null) return undefined

    let timer: number
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lock, autoLockMinutes * 60 * 1000)
    }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach((event) => window.addEventListener(event, reset))
    reset()
    return () => {
      window.clearTimeout(timer)
      events.forEach((event) => window.removeEventListener(event, reset))
    }
  }, [autoLockMinutes, isUnlocked, lock])

  return null
}

/**
 * Periodically refreshes coin status, balance and transaction history while the
 * wallet is unlocked. Catches up coins that were offline / mid-reindex at
 * unlock time without forcing the user to relogin.
 */
function AutoRefresh() {
  const isUnlocked = useAuthStore((state) => state.isUnlocked)
  const location = useLocation()
  const routeRef = useRef(location.pathname)
  routeRef.current = location.pathname

  useEffect(() => {
    if (!isUnlocked) return undefined

    let inFlight = false
    const shouldDeferRefresh = () => (
      routeRef.current === '/app/send'
      || useTransactionStore.getState().sending
    )
    const refresh = () => {
      if (inFlight || shouldDeferRefresh()) return
      inFlight = true
      quaiDebugLog('autoRefresh.start', {
        storeQuai: useCoinStore.getState().coins
          .filter((coin) => coin.id === 'quai')
          .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
      })
      void useTransactionStore.getState().loadTransactions({ page: 1, force: true, silent: false, skipPrivacy: true })
        .catch((error) => quaiDebugLogError('autoRefresh.tx.error', error))
        .finally(() => {
          quaiDebugLog('autoRefresh.tx.done', {
            storeQuai: useCoinStore.getState().coins
              .filter((coin) => coin.id === 'quai')
              .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
          })
          return useCoinStore.getState().loadCoins()
        })
        .catch((error) => quaiDebugLogError('autoRefresh.coins.error', error))
        .finally(() => {
          quaiDebugLog('autoRefresh.done', {
            storeQuai: useCoinStore.getState().coins
              .filter((coin) => coin.id === 'quai')
              .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
          })
          inFlight = false
        })
    }

    const interval = window.setInterval(refresh, 15_000)

    // Privacy coins (Zano/Epic) confirm via a local block scan rather than a
    // mempool peek, so they lag the 16 UTXO coins. Poll their scan on a faster,
    // dedicated tick so an incoming transfer surfaces sooner — without adding
    // extra request load to the UTXO coins on the main 15s loop.
    const privacyInterval = window.setInterval(() => {
      if (shouldDeferRefresh()) return
      void useCoinStore.getState().refreshPrivacyBalances()
    }, 8_000)
    if (!shouldDeferRefresh()) void useCoinStore.getState().refreshPrivacyBalances()

    return () => {
      window.clearInterval(interval)
      window.clearInterval(privacyInterval)
    }
  }, [isUnlocked])

  return null
}

export default function App() {
  return (
    <Providers>
      <HashRouter>
        <AutoLock />
        <AutoRefresh />
        <GlobalToast />
        <AppUpdateNotice />
        <AppRouter />
      </HashRouter>
    </Providers>
  )
}
