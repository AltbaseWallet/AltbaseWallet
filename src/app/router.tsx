import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { Card } from '../components/ui/Card'
import { useAuthStore } from '../store/authStore'
import { useT } from '../utils/i18n'

const Welcome = lazy(() => import('../pages/Welcome/Welcome'))
const CreatePassword = lazy(() => import('../pages/CreatePassword/CreatePassword'))
const GenerateSeed = lazy(() => import('../pages/GenerateSeed/GenerateSeed'))
const ConfirmSeed = lazy(() => import('../pages/ConfirmSeed/ConfirmSeed'))
const RestoreWallet = lazy(() => import('../pages/RestoreWallet/RestoreWallet'))
const UnlockWallet = lazy(() => import('../pages/UnlockWallet/UnlockWallet'))
const Dashboard = lazy(() => import('../pages/Dashboard/Dashboard'))
const CoinDetails = lazy(() => import('../pages/CoinDetails/CoinDetails'))
const Send = lazy(() => import('../pages/Send/Send'))
const Receive = lazy(() => import('../pages/Receive/Receive'))
const History = lazy(() => import('../pages/History/History'))
const TransactionDetails = lazy(() => import('../pages/TransactionDetails/TransactionDetails'))
const Settings = lazy(() => import('../pages/Settings/Settings'))

function Loader() {
  const t = useT()
  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      <Card className="w-full max-w-sm text-center text-slate-300">{t('appLoading')}</Card>
    </div>
  )
}

function RootRedirect() {
  const { isCreated, isUnlocked } = useAuthStore()
  if (!isCreated) return <Navigate to="/welcome" replace />
  return <Navigate to={isUnlocked ? '/app' : '/unlock'} replace />
}

function PublicOnly() {
  const { isCreated, isUnlocked } = useAuthStore()
  const location = useLocation()
  if (location.pathname === '/restore') return <Outlet />
  if (isCreated && isUnlocked) return <Navigate to="/app" replace />
  return <Outlet />
}

function Protected() {
  const { isCreated, isUnlocked } = useAuthStore()
  if (!isCreated) return <Navigate to="/welcome" replace />
  if (!isUnlocked) return <Navigate to="/unlock" replace />
  return <Outlet />
}

export function AppRouter() {
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route element={<PublicOnly />}>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/create-password" element={<CreatePassword />} />
          <Route path="/generate-seed" element={<GenerateSeed />} />
          <Route path="/confirm-seed" element={<ConfirmSeed />} />
          <Route path="/restore" element={<RestoreWallet />} />
          <Route path="/unlock" element={<UnlockWallet />} />
        </Route>
        <Route element={<Protected />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="coin/:coinId" element={<CoinDetails />} />
            <Route path="send" element={<Send />} />
            <Route path="receive" element={<Receive />} />
            <Route path="history" element={<History />} />
            <Route path="tx/:txId" element={<TransactionDetails />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:section" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  )
}
