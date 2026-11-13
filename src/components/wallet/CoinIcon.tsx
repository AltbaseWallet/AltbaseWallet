import { clsx } from 'clsx'
import { coinModuleRegistry } from '../../coin-modules'

/** Fallback gradients for tickers that don't have a bundled PNG (e.g. BMC). */
const FALLBACK_GRADIENTS: Record<string, string> = {
  BMC:  'from-amber-300 to-rose-500',
  NOVA: 'from-cyan-300 to-blue-500',
  ZETA: 'from-violet-300 to-fuchsia-500',
  AUR:  'from-amber-300 to-rose-500',
  LUMA: 'from-teal-300 to-emerald-500',
  KAI:  'from-sky-300 to-indigo-500',
  ORB:  'from-slate-300 to-slate-500',
  FLUX: 'from-lime-300 to-cyan-500',
  ECHO: 'from-pink-300 to-orange-400',
}

export function CoinIcon({ ticker, coinId, className }: { ticker: string; coinId?: string; className?: string }) {
  const normalizedTicker = ticker.toUpperCase()
  const logo = (coinId ? coinModuleRegistry.get(coinId) : coinModuleRegistry.all().find(m => m.coin.ticker === normalizedTicker))?.coin.iconUrl
  if (logo) {
    return (
      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/5', className)}>
        <img
          src={logo}
          alt={ticker}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          className={clsx(
            'pointer-events-none select-none',
            normalizedTicker === 'ZANO'
              ? 'h-[76%] w-[76%] object-contain'
              : normalizedTicker === 'QUBIC'
                ? 'h-[72%] w-[72%] object-contain'
                : normalizedTicker === 'CKB'
                  ? 'h-[66%] w-[66%] object-contain invert'
              : 'h-full w-full rounded-full object-cover',
          )}
          loading="lazy"
          decoding="async"
        />
      </span>
    )
  }
  const gradient = FALLBACK_GRADIENTS[normalizedTicker] ?? FALLBACK_GRADIENTS.NOVA
  return (
    <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-black text-slate-950', gradient, className)}>
      {ticker.slice(0, 2)}
    </div>
  )
}
