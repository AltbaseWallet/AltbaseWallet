import { ArrowLeft } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomActions } from './BottomActions'
import { useT } from '../../utils/i18n'

const backTargetFor = (pathname: string) => {
  if (pathname.startsWith('/app/settings/')) return '/app/settings'
  if (pathname.startsWith('/app/tx/')) return '/app/history'
  return '/app'
}

export function AppLayout() {
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const showBack = location.pathname !== '/app'

  return (
    <div className="h-dvh min-h-0 overflow-hidden bg-ink text-slate-100">
      <div className="flex h-full min-h-0">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Header />
          {showBack && (
            <div className="shrink-0 border-b border-white/10 px-3 py-2 sm:px-4 lg:px-5 xl:px-6">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-300 transition hover:bg-white/8 hover:text-white"
                onClick={() => navigate(backTargetFor(location.pathname))}
              >
                <ArrowLeft size={18} />
                {t('back')}
              </button>
            </div>
          )}
          <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 lg:px-5 xl:px-6">
            <Outlet />
          </main>
        </div>
      </div>
      <BottomActions />
    </div>
  )
}
