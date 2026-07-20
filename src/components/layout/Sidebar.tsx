import { Link, useLocation } from 'react-router-dom'
import { ArrowDownToLine, Coins, History, Home, Lock, Pickaxe, Repeat2, Send, Settings } from 'lucide-react'
import { Button } from '../ui/Button'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { translate, type TranslationKey } from '../../utils/i18n'
import logoUrl from '../../assets/logo.png'

const navItems = [
  { to: '/app', labelKey: 'portfolio', icon: Home },
  { to: '/app/send', labelKey: 'send', icon: Send },
  { to: '/app/receive', labelKey: 'receive', icon: ArrowDownToLine },
  { to: '#', labelKey: 'swap', icon: Repeat2, disabled: true },
  { to: '/app/mining', labelKey: 'mining', icon: Pickaxe },
  { to: '/app/history', labelKey: 'history', icon: History },
  { to: '/app/settings/coins', labelKey: 'coins', icon: Coins },
  { to: '/app/settings', labelKey: 'settings', icon: Settings },
] satisfies Array<{ to: string; labelKey: TranslationKey; icon: typeof Home; disabled?: boolean }>

export function Sidebar() {
  const lock = useAuthStore((state) => state.lock)
  const language = useSettingsStore((state) => state.settings.language)
  const { pathname } = useLocation()

  const isActive = (to: string) => {
    if (to === '/app') return pathname === '/app'
    if (to === '/app/settings/coins') return pathname === '/app/settings/coins'
    if (to === '/app/settings') return pathname === '/app/settings' || (pathname.startsWith('/app/settings/') && pathname !== '/app/settings/coins')
    return pathname === to || pathname.startsWith(`${to}/`)
  }

  return (
    <aside className="hidden h-full min-h-0 w-64 shrink-0 border-r border-white/10 bg-[#0d1420]/82 p-4 backdrop-blur lg:flex lg:flex-col">
      <Link to="/app" className="mb-8 flex items-center gap-3 px-2">
        <img src={logoUrl} alt="Altbase Wallet" draggable={false} className="pointer-events-none h-11 w-11 select-none rounded-2xl object-cover" />
        <div>
          <p className="text-base font-bold text-white">Altbase Wallet</p>
          <p className="text-xs text-slate-500">Your assets. Your control.</p>
        </div>
      </Link>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {navItems.map(({ to, labelKey, icon: Icon, disabled }) =>
          disabled ? (
            <button
              key={labelKey}
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-slate-600"
              title={`${translate(language, labelKey)} ${translate(language, 'soon')}`}
            >
              <Icon size={18} />
              <span className="flex-1">{translate(language, labelKey)}</span>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-600">{translate(language, 'soon')}</span>
            </button>
          ) : (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                isActive(to) ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/7 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {translate(language, labelKey)}
            </Link>
          ),
        )}
      </nav>

      <div className="shrink-0 pt-4">
        <Button variant="secondary" className="w-full" icon={<Lock size={17} />} onClick={lock}>
          {translate(language, 'lockWallet')}
        </Button>
      </div>
    </aside>
  )
}
