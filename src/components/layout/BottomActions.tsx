import { NavLink } from 'react-router-dom'
import { ArrowDownToLine, History, Home, Repeat2, Send, Settings } from 'lucide-react'
import { useT, type TranslationKey } from '../../utils/i18n'

const items = [
  { to: '/app', labelKey: 'portfolio', icon: Home },
  { to: '/app/send', labelKey: 'send', icon: Send },
  { to: '/app/receive', labelKey: 'receive', icon: ArrowDownToLine },
  { to: '#', labelKey: 'swap', icon: Repeat2, disabled: true },
  { to: '/app/history', labelKey: 'history', icon: History },
  { to: '/app/settings', labelKey: 'settings', icon: Settings },
] satisfies { to: string; labelKey: TranslationKey; icon: typeof Home; disabled?: boolean }[]

export function BottomActions() {
  const t = useT()
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-6 border-t border-white/10 bg-[#0d1420]/95 px-1 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
      {items.map(({ to, labelKey, icon: Icon, disabled }) => disabled ? (
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
    </nav>
  )
}
