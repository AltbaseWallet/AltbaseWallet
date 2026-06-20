import { Link } from 'react-router-dom'
import type { Coin } from '../../types/coin'
import type { Transaction } from '../../types/transaction'
import { formatAddress } from '../../utils/formatAddress'
import { useT } from '../../utils/i18n'
import { StatusBadge } from '../ui/StatusBadge'
import { CoinIcon } from './CoinIcon'

export function TransactionRow({ tx, coin }: { tx: Transaction; coin?: Coin }) {
  const t = useT()
  const statusLabel = tx.status === 'confirmed'
    ? t('txStatusConfirmed')
    : tx.status === 'failed'
      ? t('txStatusFailed')
      : t('txStatusPending')
  const typeLabel = tx.type === 'incoming' ? t('txTypeIncoming') : t('txTypeOutgoing')

  return (
    <Link to={`/app/tx/${tx.txHash}`} className="block rounded-[18px] border border-white/10 bg-white/6 px-3 py-3 transition hover:bg-white/9">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CoinIcon ticker={coin?.ticker ?? 'NA'} />
          <div className="min-w-0">
            <p className="truncate font-semibold capitalize text-white">{typeLabel}</p>
            <p className="truncate text-sm text-slate-500">
              {coin?.ticker ?? tx.coinId} · {formatAddress(tx.txHash, 7)}
            </p>
          </div>
        </div>
        <StatusBadge status={tx.status} label={statusLabel} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <p className={tx.type === 'incoming' ? 'truncate text-emerald-300' : 'truncate text-rose-300'}>
          {tx.type === 'incoming' ? '+' : '-'}
          {tx.amount} {coin?.ticker}
        </p>
        <p className="truncate text-right text-sm text-slate-400">{new Date(tx.createdAt).toLocaleString()}</p>
      </div>
    </Link>
  )
}
