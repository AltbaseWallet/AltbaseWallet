import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { Coin } from '../../types/coin'
import { Input } from '../ui/Input'
import { CoinRow } from './CoinRow'
import { useT } from '../../utils/i18n'
import { compareAmounts } from '../../utils/decimalAmount'

type Sort = 'name' | 'balance' | 'value'

type CoinListProps = {
  coins: Coin[]
  loading?: boolean
  header?: ReactNode
  onFavorite?: (id: string) => void
  onHide?: (id: string) => void
  onSelect?: (id: string) => void
  onResetFavorites?: () => void
  scrollable?: boolean
}

const coinFiatValue = (coin: Coin) =>
  typeof coin.fiatValue === 'number' && Number.isFinite(coin.fiatValue) ? coin.fiatValue : 0

export function CoinList({ coins, loading, header, onFavorite, onHide, onSelect, onResetFavorites, scrollable = false }: CoinListProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [hideEmpty, setHideEmpty] = useState(false)
  const [sort, setSort] = useState<Sort>('value')
  const hasFavorites = coins.some((coin) => coin.favorite)

  const filtered = useMemo(() => {
    return coins
      .filter((coin) => coin.enabled)
      .filter((coin) => `${coin.name} ${coin.ticker}`.toLowerCase().includes(query.toLowerCase()))
      .filter((coin) => (hideEmpty ? Number(coin.balance) > 0 : true))
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
        const byFavorite = Number(b.favorite) - Number(a.favorite)
        if (byFavorite !== 0) return byFavorite
        if (sort === 'name') return byName
        if (sort === 'balance') {
          const byBalance = compareAmounts(b.balance || '0', a.balance || '0')
          return byBalance || byName
        }
        const byValue = coinFiatValue(b) - coinFiatValue(a)
        return byValue || byName
      })
  }, [coins, hideEmpty, query, sort])

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {header}
        <div className="w-full min-w-[130px] sm:w-[175px]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchCoinLabel')}
            className="h-9 rounded-xl px-3 text-[13px]"
          />
        </div>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/7 px-2.5 text-[13px] text-slate-300 transition hover:bg-white/10">
          <input
            className="peer sr-only"
            type="checkbox"
            checked={hideEmpty}
            onChange={(event) => setHideEmpty(event.target.checked)}
          />
          <span className="flex h-4 w-8 shrink-0 items-center rounded-full border border-white/10 bg-white/10 p-0.5 transition peer-checked:border-[var(--accent)] peer-checked:bg-[rgba(var(--accent-rgb),0.35)]">
            <span className={`h-3 w-3 rounded-full transition ${hideEmpty ? 'translate-x-4 bg-[#f8fafc]' : 'bg-slate-400'}`} />
          </span>
          <span className="whitespace-nowrap">{t('coinListHasBalance')}</span>
        </label>
        <select className="h-9 w-[118px] rounded-xl border border-white/10 bg-white/7 px-2 text-[13px] text-slate-100 outline-none" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="value">{t('sortByValue')}</option>
          <option value="balance">{t('sortByBalance')}</option>
          <option value="name">{t('sortByName')}</option>
        </select>
        {onResetFavorites && (
          <button
            type="button"
            disabled={!hasFavorites}
            onClick={onResetFavorites}
            className="h-9 whitespace-nowrap rounded-xl border border-white/10 bg-white/7 px-2.5 text-[13px] font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title={t('resetFavoritesTitle')}
          >
            {t('resetFavoritesShort')}
          </button>
        )}
      </div>

      {/* Show coins immediately; only spin if there is literally nothing cached */}
      {loading && coins.length === 0 && (
        <p className="rounded-[18px] border border-white/10 bg-white/6 p-4 text-sm text-slate-400">{t('loadingCoins')}</p>
      )}

      {coins.length > 0 && filtered.length === 0 && (
        <div className="rounded-[20px] border border-dashed border-white/15 p-8 text-center text-slate-400">
          <Search className="mx-auto mb-3" size={22} />
          {t('nothingFound')}
        </div>
      )}

      <div className={`${scrollable ? 'min-h-0 flex-1 overflow-y-auto pr-1' : ''} space-y-2`}>
        {filtered.map((coin) => (
          <CoinRow key={coin.id} coin={coin} onFavorite={onFavorite} onHide={onHide} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
