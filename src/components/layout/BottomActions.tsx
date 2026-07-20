import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ArrowDownToLine, History, Home, MoreHorizontal, Pickaxe, Repeat2, Send, Settings, X } from 'lucide-react'
import { useT, type TranslationKey } from '../../utils/i18n'

const primaryItems = [
  { to: '/app', labelKey: 'portfolio', icon: Home },
  { to: '/app/send', labelKey: 'send', icon: Send },
  { to: '/app/receive', labelKey: 'receive', icon: ArrowDownToLine },
  { to: '#', labelKey: 'swap', icon: Repeat2, disabled: true },
  { to: '/app/mining', labelKey: 'mining', icon: Pickaxe },
] satisfies { to: string; labelKey: TranslationKey; icon: typeof Home; disabled?: boolean }[]

const moreItems = [
  { to: '/app/history', labelKey: 'history', icon: History },
  { to: '/app/settings', labelKey: 'settings', icon: Settings },
] satisfies { to: string; labelKey: TranslationKey; icon: typeof Home; disabled?: boolean }[]

export function BottomActions() {
  const t = useT()
  const location = useLocation()
  const [moreOpenPath, setMoreOpenPath] = useState<string | null>(null)
  const moreOpen = moreOpenPath === location.pathname

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/55 lg:hidden" role="presentation" onClick={() => setMoreOpenPath(null)}>
          <div className="absolute bottom-[calc(4.6rem+env(safe-area-inset-bottom))] left-2 right-2 border border-white/10 bg-[#101827] p-2 shadow-2xl" role="menu" onClick={(event) => event.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold text-slate-300">Altbase Wallet</span>
              <button type="button" className="grid h-9 w-9 place-items-center text-slate-400" onClick={() => setMoreOpenPath(null)} aria-label="Close menu"><X size={18} /></button>
            </div>
            {moreItems.map(({ to, labelKey, icon: Icon }) => (
              <NavLink key={to} to={to} role="menuitem" onClick={() => setMoreOpenPath(null)} className={({ isActive }) => `flex h-11 items-center gap-3 px-3 text-sm ${isActive ? 'bg-white/8 text-[var(--accent)]' : 'text-slate-300'}`}>
                <Icon size={19} /><span>{t(labelKey)}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}
      <nav className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-6 border-t border-white/10 bg-[#0d1420]/95 px-1 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
      {primaryItems.map(({ to, labelKey, icon: Icon, disabled }) => disabled ? (
        <button
          key={labelKey}
          type="button"
          disabled
          aria-label={`${t(labelKey)} - ${t('soon')}`}
          className="flex min-w-0 cursor-not-allowed flex-col items-center gap-1 rounded-lg px-0.5 py-1 text-[10px] text-slate-600 sm:text-[11px]"
        >
          <Icon size={18} />
          <span className="w-full truncate text-center">{t(labelKey)}</span>
        </button>
      ) : (
        <NavLink
          key={to}
          to={to}
          end={to === '/app'}
          className={({ isActive }) =>
            `flex min-w-0 flex-col items-center gap-1 rounded-lg px-0.5 py-1 text-[10px] sm:text-[11px] ${isActive ? 'text-[var(--accent)]' : 'text-slate-500'}`
          }
        >
          <Icon size={18} />
          <span className="w-full truncate text-center">{t(labelKey)}</span>
        </NavLink>
      ))}
        <button type="button" aria-expanded={moreOpen} aria-label={t('more')} onClick={() => setMoreOpenPath((openPath) => openPath === location.pathname ? null : location.pathname)} className={`flex min-w-0 flex-col items-center gap-1 px-0.5 py-1 text-[10px] sm:text-[11px] ${moreOpen || moreItems.some(({ to }) => location.pathname.startsWith(to)) ? 'text-[var(--accent)]' : 'text-slate-500'}`}>
          <MoreHorizontal size={18} /><span className="w-full truncate text-center">{t('more')}</span>
        </button>
      </nav>
    </>
  )
}
