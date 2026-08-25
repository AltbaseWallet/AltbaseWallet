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
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'altbase:user-activity']
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

  useEffect(() => {
    routeRef.current = location.pathname
  }, [location.pathname])

  useEffect(() => {
    if (!isUnlocked) return undefined

    let inFlight = false
    let historyInFlight = false
    let standardPending = false
    let xgrBalanceInFlight = false
    let xgrHistoryInFlight = false
    const shouldDeferStandardRefresh = () => (
      routeRef.current === '/app/send'
      || useTransactionStore.getState().sending
    )
    const shouldDeferPrivacyRefresh = () => useTransactionStore.getState().sending
    const refresh = () => {
      if (inFlight || shouldDeferStandardRefresh()) return
      // loadCoins discards an older result when a newer load starts. Keep the
      // dedicated XGR poll from continuously invalidating the slower all-coin
      // snapshot, otherwise every legacy coin can remain stuck on an old
      // balance while XGR itself appears healthy.
      if (xgrBalanceInFlight || useCoinStore.getState().refreshing) {
        standardPending = true
        return
      }
      standardPending = false
      inFlight = true
      quaiDebugLog('autoRefresh.start', {
        storeQuai: useCoinStore.getState().coins
          .filter((coin) => coin.id === 'quai')
          .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
      })
      if (!historyInFlight) {
        historyInFlight = true
        void useTransactionStore.getState()
          .loadTransactions({
            page: 1,
            force: true,
            silent: false,
            skipPrivacy: true,
            // The matching full balance request is already running below. A
            // history-triggered targeted load would bump the shared load
            // generation and discard that complete snapshot.
            skipBalanceRefresh: true,
          })
          .catch((error) => quaiDebugLogError('autoRefresh.tx.error', error))
          .finally(() => {
            historyInFlight = false
            quaiDebugLog('autoRefresh.tx.done', {
              storeQuai: useCoinStore.getState().coins
                .filter((coin) => coin.id === 'quai')
                .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
            })
          })
      }
      // Balance snapshots and history are independent gateway requests. Run
      // them together so a slow history backend cannot hold a confirmed
      // incoming balance hostage for another complete refresh cycle.
      const coinRefresh = useCoinStore.getState().loadCoins()
        .catch((error) => quaiDebugLogError('autoRefresh.coins.error', error))
      // History can take minutes on one lagging explorer. It must not hold the
      // 15-second balance poll lock: the snapshot already carries verified
      // mempool/UTXO rows used to expose an incoming balance safely.
      void coinRefresh
        .finally(() => {
          quaiDebugLog('autoRefresh.done', {
            storeQuai: useCoinStore.getState().coins
              .filter((coin) => coin.id === 'quai')
              .map((coin) => ({ balance: coin.balance, spendableBalance: coin.spendableBalance, status: coin.status })),
          })
          inFlight = false
          if (standardPending) {
            standardPending = false
            window.setTimeout(refresh, 0)
          }
        })
    }

    const interval = window.setInterval(refresh, 15_000)

    // Privacy coins (Zano/Epic) confirm via a local block scan rather than a
    // mempool peek, so they lag the 16 UTXO coins. Poll their scan on a faster,
    // dedicated tick so an incoming transfer surfaces sooner — without adding
    // extra request load to the UTXO coins on the main 15s loop.
    const privacyInterval = window.setInterval(() => {
      if (shouldDeferPrivacyRefresh()) return
      void useCoinStore.getState().refreshPrivacyBalances()
    }, 8_000)
    if (!shouldDeferPrivacyRefresh()) void useCoinStore.getState().refreshPrivacyBalances()

    const refreshXgr = () => {
      if (useTransactionStore.getState().sending) return
      // XGR's RPC is substantially slower than the other public nodes. Its
      // balance must not wait for the all-coin refresh or for history: doing so
      // used to turn a confirmed incoming transfer into a two-minute UI delay.
      if (!xgrBalanceInFlight && !inFlight && !standardPending && !useCoinStore.getState().refreshing) {
        xgrBalanceInFlight = true
        void useCoinStore.getState().loadCoins({
          forceBalances: true,
          onlyCoinIds: ['xgr'],
          skipHistoryRefresh: true,
          skipIncomingHistoryFetch: true,
        }).catch((error) => quaiDebugLogError('autoRefresh.xgr.balance.error', error))
          .finally(() => {
            xgrBalanceInFlight = false
            if (standardPending) window.setTimeout(refresh, 0)
          })
      }
      if (!xgrHistoryInFlight) {
        xgrHistoryInFlight = true
        void useTransactionStore.getState().loadTransactions({
          page: 1,
          force: true,
          silent: false,
          skipPrivacy: true,
          skipBalanceRefresh: true,
          onlyCoinIds: ['xgr'],
        }).catch((error) => quaiDebugLogError('autoRefresh.xgr.history.error', error))
          .finally(() => { xgrHistoryInFlight = false })
      }
    }
    const xgrInterval = window.setInterval(refreshXgr, 5_000)
    refreshXgr()

    return () => {
      window.clearInterval(interval)
      window.clearInterval(privacyInterval)
      window.clearInterval(xgrInterval)
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
