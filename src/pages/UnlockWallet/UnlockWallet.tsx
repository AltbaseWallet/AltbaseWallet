import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { WalletLoadProgressView } from '../../components/wallet/WalletLoadProgress'
import { useAuthStore } from '../../store/authStore'
import type { WalletLoadProgress } from '../../types/walletLoadProgress'
import { useT } from '../../utils/i18n'
import logoUrl from '../../assets/logo.png'

export default function UnlockWallet() {
  const t = useT()
  const navigate = useNavigate()
  const { unlock, lockedUntil, attempts, clearWallet } = useAuthStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [loadProgress, setLoadProgress] = useState<WalletLoadProgress | null>(null)
  const [confirmNewOpen, setConfirmNewOpen] = useState(false)
  const secondsLeft = lockedUntil && now ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0

  useEffect(() => {
    if (!lockedUntil) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 300)
    return () => window.clearInterval(timer)
  }, [lockedUntil])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (lockedUntil && Date.now() < lockedUntil) {
      setError(t('blockedTemp'))
      return
    }
    setSubmitting(true)
    setLoadProgress(null)
    try {
      const ok = await unlock(password, setLoadProgress)
      if (ok) navigate('/app')
      else {
        setLoadProgress(null)
        setError(secondsLeft > 0 ? t('blockedFor', { n: secondsLeft }) : t('wrongPassword'))
      }
    } catch (error) {
      setLoadProgress(null)
      setError(error instanceof Error ? error.message : t('walletDataLoadFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const createNewWallet = () => {
    setConfirmNewOpen(false)
    clearWallet()
    window.setTimeout(() => navigate('/create-password', { replace: true }), 0)
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src={logoUrl} alt="Altbase Wallet" draggable={false} className="pointer-events-none mx-auto mb-3 h-14 w-14 select-none rounded-[20px] object-cover" />
          <h1 className="text-2xl font-bold text-white">{t('unlockTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('unlockNote')}</p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <PasswordInput label={t('password')} value={password} onChange={(event) => setPassword(event.target.value)} error={error} disabled={secondsLeft > 0 || submitting} />
          {attempts > 0 && <p className="text-sm text-slate-500">{t('attempts', { n: attempts })}</p>}
          {submitting && <WalletLoadProgressView progress={loadProgress} />}
          <Button
            className="w-full"
            size="lg"
            disabled={secondsLeft > 0 || submitting}
            icon={submitting ? <Loader2 size={18} className="animate-spin" /> : undefined}
          >
            {submitting
              ? t('appLoading')
              : secondsLeft > 0
                ? t('blockedSeconds', { n: secondsLeft })
                : t('unlockBtn')}
          </Button>
        </form>
        <Link to="/restore" className="mt-4 block text-center text-sm text-slate-400 hover:text-white">
          {t('restoreFromSeedLink')}
        </Link>
        <button type="button" className="mt-3 block w-full text-center text-sm text-rose-300 hover:text-rose-200" onClick={() => setConfirmNewOpen(true)}>
          {t('createNewLink')}
        </button>
      </Card>
      <ConfirmDialog
        open={confirmNewOpen}
        title={t('createNewLink')}
        confirmText={t('createWallet')}
        danger
        onCancel={() => setConfirmNewOpen(false)}
        onConfirm={createNewWallet}
      >
        {t('createNewConfirm')}
      </ConfirmDialog>
    </div>
  )
}
