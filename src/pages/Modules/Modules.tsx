import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, RefreshCw, ArrowLeft, Puzzle } from 'lucide-react'
import { pluginService } from '../../services/pluginService'
import { walletService } from '../../services/walletService'
import { coinService } from '../../services/coinService'
import { useAuthStore } from '../../store/authStore'
import { useCoinStore } from '../../store/coinStore'
import { useTransactionStore } from '../../store/transactionStore'
import { useModuleLabels } from './labels'
import { CoinIcon } from '../../components/wallet/CoinIcon'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { reloadInstalledModules } from '../../services/moduleReloadService'
import { DelistingNotice } from '../../components/wallet/DelistingNotice'

export default function Modules() {
  const text = useModuleLabels()
  const [catalog, setCatalog] = useState(pluginService.current())
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [updateStatus, setUpdateStatus] = useState('')
  useEffect(() => {
    const update = () => setCatalog(pluginService.current())
    window.addEventListener('altbase:modules-changed', update)
    return () => window.removeEventListener('altbase:modules-changed', update)
  }, [])
  const checkUpdates = async () => {
    setBusy(true); setError('')
    try {
      const status = await pluginService.checkUpdates()
      setUpdateStatus(status.error || (status.configured ? `Checked: ${status.lastChecked}` : 'Automatic delivery is not configured. Set the owner catalog URL and public key in module-catalog.json.'))
      if (status.changed) await reloadInstalledModules()
      setCatalog(pluginService.current())
    } catch { setError('Could not check module updates') }
    finally { setBusy(false) }
  }
  const unlocked = useAuthStore(s => s.isUnlocked)
  const sending = useTransactionStore(s => s.sending)
  const refresh = async () => {
    setBusy(true); setError('')
    try {
      const next = await pluginService.load(true)
      setCatalog(next)
      if (unlocked) await Promise.all(next.modules.filter(m => m.runtimeType === 'plugin').map(m => walletService.ensurePublicAddress(m.id, true).catch(() => undefined)))
      const coins = await coinService.getCoins()
      useCoinStore.setState({ coins, sendReadyLoadedAt: 0 })
      if (unlocked) void useCoinStore.getState().loadCoins({ forceBalances: true }).catch(() => {})
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not refresh modules') }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-ink p-4 text-slate-100 sm:p-8" data-testid="modules-page">
    <div className="mx-auto max-w-5xl space-y-5">
      <DelistingNotice />
      <Link className="inline-flex items-center gap-2 text-sm text-slate-400" to={unlocked ? '/app' : '/'}><ArrowLeft size={16} />{text[3]}</Link>
      <Card>
        <h1 className="flex items-center gap-3 text-2xl font-bold"><Puzzle />{text[0]}</h1>
        <p className="mt-3 text-sm text-slate-400">{text[9]}</p>
        <p className="mt-3 break-all font-mono text-xs text-slate-400" data-testid="modules-directory">{catalog.directory}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => { void pluginService.openDirectory().catch(e => setError(e.message)) }} icon={<FolderOpen size={16} />} data-testid="modules-open-directory">{text[1]}</Button>
          <Button disabled={busy || sending} onClick={() => { void refresh() }} icon={<RefreshCw size={16} />} data-testid="modules-refresh">{text[2]}</Button>
          <Button disabled={busy || sending} variant="secondary" onClick={() => { void checkUpdates() }} data-testid="modules-updates">Check module updates</Button>
        </div>
        {error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
        {updateStatus && <p role="status" className="mt-4 text-sm text-slate-300">{updateStatus}</p>}
      </Card>
      <h2 className="font-semibold" data-testid="modules-count">{text[4]}: {catalog.modules.length}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {catalog.modules.map(module => <Card key={module.id} data-module-id={module.id}>
          <div className="flex items-center gap-3"><CoinIcon ticker={module.ticker} coinId={module.id} /><div className="min-w-0"><h3 className="truncate font-semibold">{module.name} <span className="text-slate-400">{module.ticker}</span></h3><p className="text-xs text-slate-400">v{module.version} · {module.runtimeType === 'legacy' ? text[5] : text[6]}</p></div></div>
          {module.testOnly && <p className="mt-3 text-xs text-amber-300">{text[7]}</p>}
        </Card>)}
        {catalog.modules.length === 0 && <p className="text-slate-400">{text[8]}</p>}
      </div>
      {catalog.diagnostics.length > 0 && <Card><h2 className="font-semibold">{text[10]}</h2>{catalog.diagnostics.map((item, i) => <p key={i} role="alert" className="mt-2 break-words text-sm text-amber-300">{item.file}: {item.error}</p>)}</Card>}
    </div>
  </main>
}
