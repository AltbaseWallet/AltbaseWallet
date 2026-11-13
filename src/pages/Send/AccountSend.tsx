import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { accountRequest, type AccountInventory, type TransferPreview } from '../../services/accountAssetsService'
import { walletService } from '../../services/walletService'
import { useCoinStore } from '../../store/coinStore'
import { useTransactionStore } from '../../store/transactionStore'
import { useAccountLabels } from '../../components/wallet/accountLabels'
export default function AccountSend({ coinId }: { coinId: string }) {
  const text = useAccountLabels(), [query] = useSearchParams(), navigate = useNavigate()
  const coins = useCoinStore(s => s.coins), coin = coins.find(c => c.id === coinId), asset = query.get('asset') || undefined
  const [to, setTo] = useState(''), [amount, setAmount] = useState(''), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [preview, setPreview] = useState<TransferPreview | null>(null), [clock, setClock] = useState(() => Date.now())
  const [inventory, setInventory] = useState<AccountInventory | null>(null), [receipt, setReceipt] = useState<{ txid: string; status: string } | null>(null)
  const mounted = useRef(true), sending = useRef(false)
  const owner = walletService.getWalletAddresses()[coinId] || coin?.address || ''
  useEffect(() => {
    mounted.current = true
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    void accountRequest<AccountInventory>(coinId, 'assets', { owner }).then(result => { if (mounted.current) setInventory(result) }).catch(() => {})
    return () => { mounted.current = false; clearInterval(timer) }
  }, [coinId, owner])
  const token = inventory?.tokens.find(t => t.id === asset), symbol = token?.symbol || coin?.ticker || ''
  const prepare = async (max = false) => {
    const revision = walletService.getSessionRevision()
    setBusy(true); setError(''); setPreview(null); setReceipt(null)
    try {
      const result = await accountRequest<TransferPreview>(coinId, 'prepareTransfer', { owner, to: to.trim(), amount, asset, max })
      if (mounted.current && revision === walletService.getSessionRevision()) { setPreview(result); setAmount(result.amount) }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : text.stale) }
    finally { if (mounted.current) setBusy(false) }
  }
  const send = async () => {
    if (!preview || preview.expiresAt <= Date.now() || sending.current || useTransactionStore.getState().sending) return
    const mnemonic = walletService.getSessionMnemonic(), revision = walletService.getSessionRevision()
    if (!mnemonic) return
    sending.current = true; setBusy(true); useTransactionStore.setState({ sending: true })
    const reviewed = preview; setPreview(null)
    try {
      const result = await accountRequest<{ txid: string; status: string }>(coinId, 'send', { planId: reviewed.planId, confirmed: true, mnemonic })
      if (mounted.current && revision === walletService.getSessionRevision()) setReceipt(result)
    } catch { if (mounted.current) setError(text.pending) }
    finally { sending.current = false; useTransactionStore.setState({ sending: false }); if (mounted.current) setBusy(false) }
  }
  return <Card className="mx-auto max-w-2xl" data-testid="account-send">
    <Link to="/app">{text.back}</Link><h1 className="my-4 text-xl font-semibold">{text.title} · {coin?.name}</h1>
    <label className="block text-sm">{text.network}<select disabled={busy} className="my-2 block w-full rounded-xl bg-slate-800 p-3" value={coinId} onChange={e => navigate(`/app/send?coin=${e.target.value}`)}>
      {coins.filter(c => c.enabled).map(c => <option key={c.id} value={c.id}>{c.name} · {c.ticker}</option>)}</select></label>
    <p className="my-3 break-all text-xs text-slate-400">{owner}{asset && <><br />{asset}</>}</p>
    <label className="block">{text.recipient}<input name="to" className="my-2 block w-full rounded-xl bg-white/5 p-3" disabled={busy} value={to} onChange={e => { setTo(e.target.value); setPreview(null) }} /></label>
    <label className="block">{text.amount} · {symbol}<input name="amount" inputMode="decimal" className="my-2 block w-full rounded-xl bg-white/5 p-3" disabled={busy} value={amount} onChange={e => { setAmount(e.target.value); setPreview(null) }} /></label>
    <div className="my-4 flex gap-3"><Button disabled={busy || !owner || !to.trim()} title="MAX" onClick={() => { void prepare(true) }}>MAX</Button>
      <Button disabled={busy || !owner || !to.trim() || !amount} onClick={() => { void prepare() }}>{text.review}</Button></div>
    {error && <p role="alert" className="my-3 break-words text-red-300">{error}</p>}
    {preview && <div className="space-y-3 rounded-xl border border-white/20 p-4" data-testid="account-transfer-preview">
      <p className="break-all">{preview.amount} {preview.symbol} → {preview.to}</p>
      <p>{text.fee}: {preview.fee} {preview.feeSymbol}</p>{preview.rent !== '0' && <p>{text.rent}: {preview.rent} {preview.feeSymbol}</p>}
      {clock >= preview.expiresAt ? <p role="alert">{text.expired}</p> : <Button disabled={busy} data-testid="account-confirm-send" onClick={() => { void send() }}>{text.confirm}</Button>}
      <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>{text.cancel}</Button></div>}
    {receipt && <p className="mt-4 break-all">{receipt.status === 'unknown' ? text.pending : text.submitted}<br />{receipt.txid}</p>}
  </Card>
}
