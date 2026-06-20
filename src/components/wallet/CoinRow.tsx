import { Eye, EyeOff, Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Coin } from '../../types/coin'
import { formatAmount, formatUsd, formatUsdPrice } from '../../utils/formatAmount'
import { Button } from '../ui/Button'
import { CoinIcon } from './CoinIcon'
import { CoinStatusBadge } from './CoinStatusBadge'
import { useSettingsStore } from '../../store/settingsStore'
import { useT } from '../../utils/i18n'

type CoinRowProps = {
  coin: Coin
  compact?: boolean
  onFavorite?: (id: string) => void
  onHide?: (id: string) => void
  onSelect?: (id: string) => void
}

export function CoinRow({ coin, compact, onFavorite, onHide, onSelect }: CoinRowProps) {
  const t = useT()
  const hideBalances = useSettingsStore((state) => state.settings.hideBalances)

  return (
    <div className={`grid grid-cols-[1fr_auto] items-center gap-4 rounded-[18px] border border-white/10 px-3 py-3 transition md:grid-cols-[1.4fr_1fr_1fr_auto] ${
      coin.enabled === false
        ? 'bg-white/3 opacity-60 hover:opacity-80'
        : 'bg-white/6 hover:bg-white/9'
    }`}>
      <Link to={`/app/coin/${coin.id}`} className="flex min-w-0 items-center gap-3" onClick={() => onSelect?.(coin.id)}>
        <CoinIcon ticker={coin.ticker} className={compact ? 'h-9 w-9' : ''} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{coin.name}</p>
          <p className="text-sm text-slate-500">
            {coin.ticker}
            {typeof coin.priceUsd === 'number' && (
              <> · <span className="text-slate-400">{formatUsdPrice(coin.priceUsd)}</span></>
            )}
          </p>
        </div>
      </Link>

      <div className="hidden md:block">
        <p className="text-sm font-medium text-white">{hideBalances ? '••••' : formatAmount(coin.balance, coin.ticker)}</p>
        <p className="text-xs text-slate-500">{hideBalances ? '••••' : formatUsd(coin.fiatValue)}</p>
      </div>

      <CoinStatusBadge status={coin.status} recoveryProgress={coin.recoveryProgress} className="hidden md:inline-flex" />

      <div className="flex items-center gap-1">
        {onFavorite && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 rounded-xl p-0"
            aria-label={t('ariaAddFavorite')}
            title={t('ariaAddFavorite')}
            onClick={() => onFavorite(coin.id)}
          >
            <Star size={17} className={coin.favorite ? 'fill-amber-300 text-amber-300' : ''} />
          </Button>
        )}
        {onHide && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 rounded-xl p-0"
            aria-label={t('ariaHideCoin')}
            title={t('ariaHideCoin')}
            onClick={() => onHide(coin.id)}
          >
            {coin.enabled ? (
              <Eye size={17} className="text-slate-300" />
            ) : (
              <EyeOff size={17} className="text-rose-300" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
