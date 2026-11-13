import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '../ui/Button'
import { accountRequest, isAccountModule, type AccountInventory } from '../../services/accountAssetsService'
import { walletService } from '../../services/walletService'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useAccountLabels } from './accountLabels'
import { TokenIcon } from './TokenIcon'

export function AccountAssets({ coinId }: { coinId: string }) {
  const text = useAccountLabels(), coin = useCoinStore(s => s.coins.find(c => c.id === coinId))
  const hideBalances = useSettingsStore(s => s.settings.hideBalances)
  const [inventory, setInventory] = useState<AccountInventory | null>(null), [error, setError] = useState('')
  const [contract, setContract] = useState(''), [showHidden, setShowHidden] = useState(false), [busy, setBusy] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const owner = walletService.getWalletAddresses()[coinId] || coin?.address || ''
  useEffect(() => {
    if (!owner) return
    let disposed = false, loading = false
    const update = async () => {
      if (loading) return
      loading = true
      try {
        const response = await accountRequest<AccountInventory>(coinId, 'assets', { owner })
        if (!disposed) { setInventory(response); setError('') }
      } catch { if (!disposed) setError(text.stale) }
      finally { loading = false; if (!disposed) setClock(Date.now()) }
    }
    void update()
    const timer = window.setInterval(() => { void update() }, 5000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [coinId, owner, text.stale])
  const action = async (method: string, params: Record<string, unknown>) => {
    const revision = walletService.getSessionRevision()
    setBusy(true); setError('')
    try {
      const result = await accountRequest<AccountInventory>(coinId, method, { owner, ...params })
      if (revision === walletService.getSessionRevision()) { setInventory(result); if (method === 'importAsset') setContract('') }
    } catch (e) { if (revision === walletService.getSessionRevision()) setError(e instanceof Error ? e.message : text.stale) }
    finally { setBusy(false) }
  }
  if (!coin) return null
  const tokens = inventory?.tokens.filter(t => showHidden || t.visible) || []
  const hiddenCount = inventory?.tokens.filter(t => !t.visible).length || 0
  const networkUnavailable = inventory?.discovery.reason === 'network-unavailable'
  return <section id={`coin-tokens-${coinId}`} aria-label={`${text.tokens}: ${coin.name}`} data-testid={`account-assets-${coinId}`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium text-slate-300">{text.tokens}</span>
      <div className="flex gap-3 text-sm"><Link to={`/app/receive?coin=${coinId}`}>{text.receive}</Link><Link to={`/app/send?coin=${coinId}`}>{text.send}</Link>
        <button disabled={busy || !owner || inventory?.updating} aria-busy={inventory?.updating || busy} onClick={() => { void action('assets', { force: true }) }}>{inventory?.updating ? text.ready : text.refresh}</button></div></div>
    {(hiddenCount > 0 || showHidden) && <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />{text.hidden} ({hiddenCount})</label>}
    <div className="divide-y divide-white/10">{tokens.map(token => <div key={token.id} data-token-id={token.id} className="py-3">
      <div className="flex items-center gap-3"><TokenIcon network={coinId} contract={token.id} symbol={token.symbol} icon={token.icon} />
        <div className="min-w-0 flex-1"><p className="break-words">{token.name} <span className="text-slate-400">{token.symbol}</span></p><p className="break-all text-xs text-slate-400">{token.id}</p></div>
        <p className="max-w-[40%] break-all text-right">{hideBalances ? '••••' : token.amount}</p></div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs"><div className="text-amber-200">
        {token.assessment.classification === 'spam' && <p>{text.spam}</p>}
        {(error || token.status === 'unavailable' || clock - token.verifiedAt > 120000) && <p>{text.stale}</p>}
        {token.status === 'partial' && <p>{text.partial}</p>}</div>
        <div className="flex gap-3">{token.visible && <Link to={`/app/send?coin=${coinId}&asset=${encodeURIComponent(token.id)}`}>{text.send}</Link>}
          <button disabled={busy} onClick={() => { void action('setAssetVisibility', { asset: token.id, visibility: token.visible ? 'hide' : 'show' }) }}>{token.visible ? text.hide : text.show}</button></div></div>
    </div>)}{!tokens.length && inventory && !inventory.updating && !networkUnavailable && !error && <p className="mt-3 text-sm text-slate-400">{text.empty}</p>}</div>
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void action('importAsset', { asset: contract.trim() }) }}>
      <input className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm" value={contract} onChange={e => setContract(e.target.value)} placeholder={text.contract} aria-label={text.contract} />
      <Button type="submit" size="sm" disabled={busy || !owner || !contract.trim()}>{text.import}</Button></form>
    {(error || networkUnavailable) && <p className="mt-3 text-sm text-red-300" role="alert">{error || text.stale}</p>}
    {inventory?.receipts.map(row => <p key={row.txid} className="mt-2 break-all text-xs">{row.status === 'confirmed' ? text.confirmed : row.status === 'failed' ? text.failed : row.status === 'unknown' ? text.pending : text.submitted} {row.txid}</p>)}
  </section>
}
export function AccountTokensDisclosure({ coinId }: { coinId: string }) {
  const text = useAccountLabels()
  const [open, setOpen] = useState(false)
  if (!isAccountModule(coinId)) return null
  return <div className="rounded-lg border border-white/10 bg-white/6 px-3 py-3">
    <button type="button" className="flex w-full items-center justify-between gap-3 text-sm font-medium" aria-expanded={open} aria-controls={`coin-tokens-${coinId}`} onClick={() => setOpen(value => !value)}>
      {text.tokens}<ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="mt-3 border-t border-white/10 pt-3"><AccountAssets coinId={coinId} /></div>}
  </div>
}
