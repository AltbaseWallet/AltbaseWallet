import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomActions } from './BottomActions'

export function AppLayout() {
  return (
    <div className="h-screen overflow-hidden bg-ink text-slate-100">
      <div className="flex h-full min-h-0">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-20 lg:pb-0">
          <Header />
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-5 xl:px-6">
            <Outlet />
          </main>
        </div>
      </div>
      <BottomActions />
    </div>
  )
}
