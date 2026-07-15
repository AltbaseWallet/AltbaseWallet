import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { TransactionRow } from '../../components/wallet/TransactionRow'
import { useCoinStore } from '../../store/coinStore'
import { useTransactionStore } from '../../store/transactionStore'
import type { Transaction, TransactionStatus, TransactionType } from '../../types/transaction'
import { useT } from '../../utils/i18n'
import { hasLoadedHistoryPage } from '../../utils/historyPagination'

export default function History() {
  const t = useT()
  const { coins, loadCoins } = useCoinStore()
  const { transactions, loadTransactions, loadAllTransactions, allHistoryLoaded, allHistoryLoading } = useTransactionStore()
  const [coinId, setCoinId] = useState('all')
  const [type, setType] = useState<TransactionType | 'all'>('all')
  const [status, setStatus] = useState<TransactionStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const pageSize = 12

  // Load the first page fast, then pull EVERY coin's full history in the
  // background so pagination/filtering is purely client-side and reliable
  // (no coin's transactions can go missing, and filtered views never snap back).
  useEffect(() => {
    window.setTimeout(() => setPage(1), 0)
    let refreshInFlight = false
    const refreshLatest = () => {
      if (refreshInFlight || document.visibilityState === 'hidden') return
      refreshInFlight = true
      void loadTransactions({ page: 1, pageSize, force: true })
        .finally(() => loadCoins({ forceBalances: true }))
        .finally(() => { refreshInFlight = false })
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshLatest()
    }
    refreshLatest()
    void loadAllTransactions()
    const interval = window.setInterval(refreshLatest, 15_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadCoins, loadTransactions, loadAllTransactions])

  const matchesFilters = useCallback((tx: Transaction) => {
    if (coinId !== 'all' && tx.coinId !== coinId) return false
    if (type !== 'all' && tx.type !== type) return false
    if (status !== 'all' && tx.status !== status) return false
    return true
  }, [coinId, status, type])

  const filtered = useMemo(
    () => transactions.filter(matchesFilters),
    [matchesFilters, transactions],
  )
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Once all history is loaded, never sit on a now-empty page.
  useEffect(() => {
    if (!allHistoryLoaded) return
    const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
    if (page > maxPage) window.setTimeout(() => setPage(maxPage), 0)
  }, [allHistoryLoaded, filtered.length, page])

  const pagePending = visible.length === 0 && !allHistoryLoaded && allHistoryLoading
  const nextDisabled = !hasLoadedHistoryPage(filtered.length, page, pageSize)
  const goPage = (nextPage: number) => setPage(Math.max(1, nextPage))

  return (
    <Card>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('history')}</h1>
          <p className="text-sm text-slate-500">{t('allCoinsHistory')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="h-11 rounded-2xl border border-white/10 bg-white/7 px-3 text-sm text-slate-100" value={coinId} onChange={(event) => { setCoinId(event.target.value); setPage(1) }}>
            <option value="all">{t('allCoins')}</option>
            {coins.map((coin) => <option key={coin.id} value={coin.id}>{coin.ticker}</option>)}
          </select>
          <select className="h-11 rounded-2xl border border-white/10 bg-white/7 px-3 text-sm text-slate-100" value={type} onChange={(event) => { setType(event.target.value as TransactionType | 'all'); setPage(1) }}>
            <option value="all">{t('allTypes')}</option>
            <option value="incoming">{t('txTypeIncoming')}</option>
            <option value="outgoing">{t('txTypeOutgoing')}</option>
          </select>
          <select className="h-11 rounded-2xl border border-white/10 bg-white/7 px-3 text-sm text-slate-100" value={status} onChange={(event) => { setStatus(event.target.value as TransactionStatus | 'all'); setPage(1) }}>
            <option value="all">{t('allStatuses')}</option>
            <option value="pending">{t('txStatusPending')}</option>
            <option value="confirmed">{t('txStatusConfirmed')}</option>
            <option value="failed">{t('txStatusFailed')}</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        {pagePending && (
          <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-white/15">
            <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
          </div>
        )}
        {!pagePending && visible.map((tx) => <TransactionRow key={tx.id} tx={tx} coin={coins.find((coin) => coin.id === tx.coinId)} />)}
        {!pagePending && visible.length === 0 && <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">{t('noTxForFilter')}</p>}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2 text-sm text-slate-400">
        <button
          type="button"
          className="rounded-xl border border-white/10 px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
          disabled={page === 1}
          onClick={() => goPage(1)}
          title="First"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/10 px-4 py-2 transition hover:bg-white/10 disabled:opacity-40"
          disabled={page === 1}
          onClick={() => goPage(page - 1)}
        >
          {t('back')}
        </button>
        <span className="min-w-20 rounded-xl border border-white/10 px-3 py-2 text-center text-slate-300">
          {t('pageLabel', { page })}
          {allHistoryLoading && !allHistoryLoaded ? '...' : ''}
        </span>
        <button
          type="button"
          className="rounded-xl border border-white/10 px-4 py-2 transition hover:bg-white/10 disabled:opacity-40"
          disabled={nextDisabled}
          onClick={() => goPage(page + 1)}
        >
          {t('next')}
        </button>
      </div>
    </Card>
  )
}
