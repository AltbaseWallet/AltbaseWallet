import { useEffect, useState } from 'react'
import { ChevronsLeft, Loader2, RefreshCw } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { BalanceCard } from '../../components/wallet/BalanceCard'
import { CoinList } from '../../components/wallet/CoinList'
import { TransactionRow } from '../../components/wallet/TransactionRow'
import { useCoinStore } from '../../store/coinStore'
import { useTransactionStore } from '../../store/transactionStore'
import { useT } from '../../utils/i18n'
import { hasLoadedHistoryPage } from '../../utils/historyPagination'

export default function Dashboard() {
  const t = useT()
  const { coins, loading, refreshing, loadCoins, toggleFavorite, toggleEnabled, selectCoin, resetFavorites } = useCoinStore()
  const { transactions, loadTransactions, loadAllTransactions, allHistoryLoaded, allHistoryLoading } = useTransactionStore()
  const [refreshTapped, setRefreshTapped] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const historyPageSize = 8
  const visibleTransactions = transactions.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize)
  const historyPagePending = visibleTransactions.length === 0 && !allHistoryLoaded && allHistoryLoading
  const historyNextDisabled = !hasLoadedHistoryPage(transactions.length, historyPage, historyPageSize)

  useEffect(() => {
    if (coins.length === 0) void loadCoins()
  }, [coins.length, loadCoins])

  // First page fast, then the full history for every coin in the background so
  // the list is complete and pagination is reliable client-side slicing.
  useEffect(() => {
    window.setTimeout(() => setHistoryPage(1), 0)
    void loadTransactions({ page: 1, pageSize: historyPageSize, force: true, silent: true })
    void loadAllTransactions()
  }, [loadTransactions, loadAllTransactions])

  // Once everything is loaded, never sit on a now-empty page.
  useEffect(() => {
    if (!allHistoryLoaded) return
    const maxPage = Math.max(1, Math.ceil(transactions.length / historyPageSize))
    if (historyPage > maxPage) window.setTimeout(() => setHistoryPage(maxPage), 0)
  }, [allHistoryLoaded, transactions.length, historyPage])

  const refreshAll = () => {
    setRefreshTapped(true)
    window.setTimeout(() => setRefreshTapped(false), 800)
    setHistoryPage(1)
    void loadTransactions({ page: 1, pageSize: historyPageSize, force: true })
      .finally(() => { void loadCoins({ forceBalances: true }) })
    void loadAllTransactions({ force: true })
  }

  const goHistoryPage = (page: number) => setHistoryPage(Math.max(1, page))

  const refreshSpinning = refreshing || refreshTapped

  return (
    <div className="space-y-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:gap-6 xl:space-y-0">
      <div className="xl:shrink-0">
        <BalanceCard />
      </div>
      <section className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1fr_380px] xl:gap-6">
        <Card className="xl:flex xl:min-h-0 xl:flex-col">
          <CoinList
            coins={coins}
            loading={loading}
            header={(
              <div className="mr-1 flex h-9 shrink-0 items-center gap-2">
                <div className="leading-tight">
                  <h2 className="text-sm font-semibold text-white">{t('coins')}</h2>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 rounded-xl p-0"
                  aria-label={t('refreshCoinsStatus')}
                  title={t('refreshCoinsStatus')}
                  disabled={refreshing}
                  onClick={refreshAll}
                >
                  <RefreshCw size={15} className={refreshSpinning ? 'animate-spin' : ''} />
                </Button>
              </div>
            )}
            onFavorite={toggleFavorite}
            onHide={toggleEnabled}
            onSelect={selectCoin}
            onResetFavorites={resetFavorites}
            scrollable
          />
        </Card>
        <Card className="xl:flex xl:min-h-0 xl:flex-col">
          <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-white">{t('recentHistory')}</h2>
            <div className="flex max-w-full items-center gap-1.5 text-xs text-slate-400 sm:gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 px-2.5 py-2 transition hover:bg-white/10 disabled:opacity-40"
                disabled={historyPage === 1}
                onClick={() => goHistoryPage(1)}
                title="First"
              >
                <ChevronsLeft size={14} />
              </button>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
                disabled={historyPage === 1}
                onClick={() => goHistoryPage(historyPage - 1)}
              >
                {t('back')}
              </button>
              <span className="min-w-16 rounded-xl border border-white/10 px-2.5 py-2 text-center text-slate-300">
                {t('pageLabel', { page: historyPage })}
              </span>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
                disabled={historyNextDisabled}
                onClick={() => goHistoryPage(historyPage + 1)}
              >
                {t('next')}
              </button>
            </div>
          </div>
          <div className="space-y-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
            {historyPagePending && (
              <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-white/15">
                <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
              </div>
            )}
            {!historyPagePending && visibleTransactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} coin={coins.find((coin) => coin.id === tx.coinId)} />
            ))}
            {!historyPagePending && visibleTransactions.length === 0 && <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-slate-400">{t('noHistory')}</p>}
          </div>
        </Card>
      </section>
    </div>
  )
}
