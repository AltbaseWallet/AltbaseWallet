import { NavLink } from 'react-router-dom'
import { ArrowDownToLine, History, Home, Send, Settings } from 'lucide-react'

const items = [
  { to: '/app', label: 'Home', icon: Home },
  { to: '/app/send', label: 'Send', icon: Send },
  { to: '/app/receive', label: 'Receive', icon: ArrowDownToLine },
  { to: '/app/history', label: 'History', icon: History },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export function BottomActions() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 border-t border-white/10 bg-[#0d1420]/95 px-2 py-2 backdrop-blur lg:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/app'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] ${isActive ? 'text-[var(--accent)]' : 'text-slate-500'}`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
