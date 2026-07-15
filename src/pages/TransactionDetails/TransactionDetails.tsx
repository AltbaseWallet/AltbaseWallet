import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { useLocation, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Toast } from '../../components/ui/Toast'
import { useCoinStore } from '../../store/coinStore'
import { useTransactionStore } from '../../store/transactionStore'
import type { Transaction } from '../../types/transaction'
import { copyToClipboard } from '../../utils/clipboard'
import { useT } from '../../utils/i18n'

export default function TransactionDetails() {
  const t = useT()
  const { txId } = useParams()
  const location = useLocation()
  const { coins, loadCoins } = useCoinStore()
  const { transactions, loadTransactions, loading } = useTransactionStore()
  const routeTransaction = (location.state as { transaction?: Transaction } | null)?.transaction
  const [localTransaction] = useState<Transaction | null>(
    routeTransaction && (routeTransaction.txHash === txId || routeTransaction.id === txId) ? routeTransaction : null,
  )
  const [toast, setToast] = useState<string | null>(null)
  // Match by txHash (preferred — stable blockchain identifier) or by id (legacy/local entries)
  const storedTx = transactions.find((item) => item.txHash === txId || item.id === txId)
  const tx = storedTx ?? localTransaction
  const coin = coins.find((item) => item.id === tx?.coinId)

  useEffect(() => {
    void loadTransactions({ silent: true }).finally(() => loadCoins({ forceBalances: true }))
  }, [loadCoins, loadTransactions])

  const copyHash = async () => {
    if (!tx) return
    await copyToClipboard(tx.txHash)
    setToast(t('hashCopied'))
    window.setTimeout(() => setToast(null), 2200)
  }

  if (!tx && loading) return <Card>{t('loading')}</Card>
  if (!tx) return <Card>{t('txNotFound')}</Card>
  const statusLabel = tx.status === 'confirmed'
    ? t('txStatusConfirmed')
    : tx.status === 'failed'
      ? t('txStatusFailed')
      : t('txStatusPending')

  return (
    <Card className="w-full">
      <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">{t('txDetailsTitle')}</h1>
          <p className="text-sm text-slate-500">{coin?.ticker ?? tx.coinId}</p>
        </div>
        <StatusBadge status={tx.status} label={statusLabel} />
      </div>
      <div className="grid gap-3 text-sm lg:grid-cols-2">
        {[
          [t('txHash'), tx.txHash],
          [t('txFrom'), tx.from ?? '—'],
          [t('txTo'), tx.to ?? '—'],
          [t('txAmount'), `${tx.amount} ${coin?.ticker ?? ''}`],
          [t('txFee'), tx.fee ? `${tx.fee} ${coin?.ticker ?? ''}` : '—'],
          [t('txDate'), new Date(tx.createdAt).toLocaleString()],
          ...(tx.blockHeight ? [['block height', String(tx.blockHeight)]] : []),
          [t('txConfirmations'), String(tx.confirmations ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/7 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
            <p className="mt-1 break-all text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={copyHash} icon={<Copy size={17} />}>
          {t('copyHash')}
        </Button>
      </div>
      <Toast message={toast} />
    </Card>
  )
}
