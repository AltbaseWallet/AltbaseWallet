import { useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, Copy, Loader2, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { QRCodeBox } from '../../components/ui/QRCodeBox'
import { Toast } from '../../components/ui/Toast'
import { CoinIcon } from '../../components/wallet/CoinIcon'
import { TransactionRow } from '../../components/wallet/TransactionRow'
import { walletService } from '../../services/walletService'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useTransactionStore } from '../../store/transactionStore'
import { copyToClipboard } from '../../utils/clipboard'
import { formatAmount, formatUsd } from '../../utils/formatAmount'
import { useT } from '../../utils/i18n'
import { hasLoadedHistoryPage } from '../../utils/historyPagination'
import { isPrivacyCoin } from '../../utils/privacyCoins'

export default function CoinDetails() {
  const t = useT()
  const { coinId } = useParams()
  const { coins, loadCoins, rescanPrivacyCoin } = useCoinStore()
  const { transactions, loadTransactions, loadAllTransactions, allHistoryLoaded, allHistoryLoading } = useTransactionStore()
  const hideBalances = useSettingsStore((state) => state.settings.hideBalances)
  const [toast, setToast] = useState<string | null>(null)
  const [txPage, setTxPage] = useState(1)
  const [rescanHeight, setRescanHeight] = useState('')
  const [rescanBusy, setRescanBusy] = useState(false)
  const [rescanError, setRescanError] = useState('')
  const txPageSize = 8
  const coin = coins.find((item) => item.id === coinId)
  const effectiveAddress = coin ? walletService.getWalletAddresses()[coin.id] ?? coin.address : ''
  const privacyCoin = isPrivacyCoin(coin)
  const coinTx = useMemo(() => transactions.filter((tx) => tx.coinId === coinId), [coinId, transactions])
  const visibleCoinTx = coinTx.slice((txPage - 1) * txPageSize, txPage * txPageSize)
  const txPagePending = visibleCoinTx.length === 0 && !allHistoryLoaded && allHistoryLoading
  const txNextDisabled = !hasLoadedHistoryPage(coinTx.length, txPage, txPageSize)
  const canDeriveAddresses = walletService.hasStoredSeedPhrase()

  // Load this coin's first page fast, then pull the FULL history for every coin
  // in the background so pagination is purely client-side and nothing vanishes.
  useEffect(() => {
    window.setTimeout(() => setTxPage(1), 0)
    void loadTransactions({
      page: 1,
      pageSize: txPageSize,
      force: true,
      silent: true,
      onlyCoinIds: coinId ? [coinId] : undefined,
      skipAllHistorySideload: true,
    }).finally(() => {
      void loadCoins({
        forceBalances: true,
        onlyCoinIds: coinId ? [coinId] : undefined,
        skipHistoryRefresh: true,
      })
    })
    void loadAllTransactions()
  }, [coinId, loadCoins, loadTransactions, loadAllTransactions])

  useEffect(() => {
    window.setTimeout(() => {
      setRescanHeight('')
      setRescanError('')
      setRescanBusy(false)
    }, 0)
  }, [coinId])

  // Once all history is in, never sit on a now-empty page.
  useEffect(() => {
    if (!allHistoryLoaded) return
    const maxPage = Math.max(1, Math.ceil(coinTx.length / txPageSize))
    if (txPage > maxPage) window.setTimeout(() => setTxPage(maxPage), 0)
  }, [allHistoryLoaded, coinTx.length, txPage])

  // Keep the open coin responsive even when another module makes the global
  // refresh slow. This targeted poll is intentionally serialized and never
  // requests the all-coin snapshot.
  useEffect(() => {
    if (!coinId) return undefined

    let stopped = false
    let inFlight = false
    const refreshOpenCoin = async () => {
      if (stopped || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      try {
        await loadTransactions({
          page: 1,
          pageSize: txPageSize,
          force: true,
          silent: true,
          onlyCoinIds: [coinId],
          skipAllHistorySideload: true,
        })
        await loadCoins({
          forceBalances: true,
          onlyCoinIds: [coinId],
          skipHistoryRefresh: true,
        })
      } catch {
        // A later tick retries; keep the last known balance visible meanwhile.
      } finally {
        inFlight = false
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshOpenCoin()
    }
    const interval = window.setInterval(() => { void refreshOpenCoin() }, 5_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      stopped = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [coinId, loadCoins, loadTransactions])

  const goTxPage = (nextPage: number) => setTxPage(Math.max(1, nextPage))

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }

  const copyAddress = async () => {
    if (!effectiveAddress) {
      showToast(t('addressNotReceived'))
      return
    }
    await copyToClipboard(effectiveAddress)
    showToast(t('addressCopied'))
  }

  const rescanPrivacy = async () => {
    if (!coin || !privacyCoin || rescanBusy) return
    const height = Number(rescanHeight.trim())
    if (!Number.isFinite(height) || height < 0 || !Number.isInteger(height)) {
      setRescanError(t('privacyRescanInvalidHeight'))
      return
    }
    setRescanBusy(true)
    setRescanError('')
    try {
      await rescanPrivacyCoin(coin.id as 'zano' | 'epic', height)
      void loadTransactions({ page: 1, pageSize: txPageSize, force: true, silent: true })
      showToast(t('privacyRescanStarted'))
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : t('privacyRescanFailed'))
    } finally {
      setRescanBusy(false)
    }
  }

  if (!coin) return <Card>{t('coinNotFound')}</Card>

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-4">
            <CoinIcon ticker={coin.ticker} className="h-14 w-14 text-sm" />
            <div>
              <h1 className="text-2xl font-bold text-white">{coin.name}</h1>
              <p className="text-slate-500">
                {coin.ticker} - {coin.status}
              </p>
            </div>
          </div>
          <div className="min-w-0 text-left md:text-right">
            <p className="break-all text-2xl font-bold text-white sm:text-3xl">{hideBalances ? '\u2022\u2022\u2022\u2022' : formatAmount(coin.balance, coin.ticker)}</p>
            <p className="text-slate-500">{hideBalances ? '\u2022\u2022\u2022\u2022' : formatUsd(coin.fiatValue)}</p>
          </div>
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_230px]">
          <div className="rounded-2xl border border-white/10 bg-white/7 p-4">
            <p className="text-sm text-slate-500">{t('walletAddress')}</p>
            <p className="mt-2 break-all font-mono text-sm text-white">{effectiveAddress || t('addressNotReceived')}</p>
            {!effectiveAddress && !privacyCoin && (
              <p className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
                {canDeriveAddresses ? t('addressUnlockHint') : t('addressOldBuildShort')}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {effectiveAddress ? (
                <Button onClick={copyAddress} icon={<Copy size={17} />}>
                  {t('copyAddressShort')}
                </Button>
              ) : !privacyCoin ? (
                <Link to="/restore">
                  <Button variant="secondary">{t('restoreFromSeedBtn')}</Button>
                </Link>
              ) : (
                <Button variant="secondary" disabled>{t('addressNotReceived')}</Button>
              )}
              <Link to={`/app/send?coin=${coin.id}`}>
                <Button variant="secondary">{t('send')}</Button>
              </Link>
              <Link to={`/app/receive?coin=${coin.id}`}>
                <Button variant="secondary">{t('receive')}</Button>
              </Link>
            </div>
            {privacyCoin && (
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Input
                  label={t('privacyRescanFromHeight')}
                  type="number"
                  min={0}
                  step={1}
                  value={rescanHeight}
                  onChange={(event) => {
                    setRescanHeight(event.target.value)
                    setRescanError('')
                  }}
                  error={rescanError}
                  placeholder="3695000"
                />
                <Button
                  variant="secondary"
                  onClick={rescanPrivacy}
                  disabled={rescanBusy || !rescanHeight.trim()}
                  icon={rescanBusy ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                >
                  {t('privacyRescan')}
                </Button>
              </div>
            )}
          </div>
          <QRCodeBox value={effectiveAddress} />
        </div>
      </Card>
      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-white">{t('txHistory')}</h2>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <button
              type="button"
              className="rounded-xl border border-white/10 px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
              disabled={txPage === 1}
              onClick={() => goTxPage(1)}
              title="First"
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 px-4 py-2 transition hover:bg-white/10 disabled:opacity-40"
              disabled={txPage === 1}
              onClick={() => goTxPage(txPage - 1)}
            >
              {t('back')}
            </button>
            <span className="min-w-20 rounded-xl border border-white/10 px-3 py-2 text-center text-slate-300">
              {t('pageLabel', { page: txPage })}
            </span>
            <button
              type="button"
              className="rounded-xl border border-white/10 px-4 py-2 transition hover:bg-white/10 disabled:opacity-40"
              disabled={txNextDisabled}
              onClick={() => goTxPage(txPage + 1)}
            >
              {t('next')}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {txPagePending && (
            <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-white/15">
              <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
            </div>
          )}
          {!txPagePending && visibleCoinTx.map((tx) => <TransactionRow key={tx.id} tx={tx} coin={coin} />)}
          {!txPagePending && visibleCoinTx.length === 0 && <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-slate-400">{t('noTxForCoin')}</p>}
        </div>
      </Card>
      <Toast message={toast} />
    </div>
  )
}
