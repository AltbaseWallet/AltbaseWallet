import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { WalletLoadProgressView } from '../../components/wallet/WalletLoadProgress'
import { useAuthStore } from '../../store/authStore'
import { useCoinStore } from '../../store/coinStore'
import { useTransactionStore } from '../../store/transactionStore'
import { walletService } from '../../services/walletService'
import { buildWalletLoadProgress, type WalletLoadProgress } from '../../types/walletLoadProgress'
import { useT } from '../../utils/i18n'

const pickSeedPositions = (count: number, max: number) => {
  const picked = new Set<number>()
  const cryptoSource = globalThis.crypto
  while (picked.size < count) {
    const bytes = new Uint32Array(1)
    cryptoSource.getRandomValues(bytes)
    picked.add((bytes[0] % max) + 1)
  }
  return Array.from(picked).sort((a, b) => a - b)
}

export default function ConfirmSeed() {
  const t = useT()
  const navigate = useNavigate()
  const seed = useAuthStore((state) => state.generatedSeed)
  const cancelWalletSetup = useAuthStore((state) => state.cancelWalletSetup)
  const [values, setValues] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [formError, setFormError] = useState('')
  const [warmingUp, setWarmingUp] = useState(false)
  const [loadProgress, setLoadProgress] = useState<WalletLoadProgress | null>(null)
  const warmingUpRef = useRef(false)
  const words = useMemo(() => seed?.split(' ') ?? [], [seed])
  const positions = useMemo(() => pickSeedPositions(3, words.length || 12), [words.length])

  const confirm = async () => {
    if (!seed || warmingUpRef.current) return

    const nextErrors: Record<number, string> = {}
    positions.forEach((position) => {
      if ((values[position] ?? '').trim().toLowerCase() !== words[position - 1]) {
        nextErrors[position] = t('wordWrong', { n: position })
      }
    })
    setErrors(nextErrors)
    setFormError('')
    if (Object.keys(nextErrors).length === 0) {
      warmingUpRef.current = true
      setWarmingUp(true)
      setLoadProgress(buildWalletLoadProgress('addresses'))
      useAuthStore.setState({ sessionMnemonic: seed })
      try {
        await walletService.finalizeWalletSetup(seed)
        await walletService.preparePublicAddresses(seed)
        walletService.warmPrivacyAddresses()
        useTransactionStore.getState().resetTransactions()
        await useCoinStore.getState().resetCoinsForCurrentWallet()
      } catch (error) {
        setLoadProgress(null)
        setFormError(error instanceof Error ? error.message : t('walletDataLoadFailed'))
        warmingUpRef.current = false
        setWarmingUp(false)
        return
      }
      useAuthStore.setState({ isUnlocked: false, sessionMnemonic: seed })
      await useCoinStore.getState().loadSendReadyState(setLoadProgress)
      setLoadProgress(buildWalletLoadProgress('history'))
      void useTransactionStore.getState()
        .loadTransactions({ page: 1, force: true, silent: true, startup: true })
        .catch(() => undefined)
      useAuthStore.setState({ isUnlocked: true })
      setLoadProgress(buildWalletLoadProgress('ready'))
      navigate('/app', { replace: true })
      useAuthStore.getState().clearGeneratedSeed()
    }
  }

  const cancelSetup = () => {
    cancelWalletSetup()
    navigate('/welcome', { replace: true })
  }

  if (!seed && !warmingUp) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink p-4">
        <Card>{t('seedCleared')}</Card>
      </div>
    )
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      <Card className="w-full max-w-lg">
        <h1 className="text-2xl font-bold text-white">{t('confirmSeedTitle')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('confirmSeedNote')}</p>
        <div className="mt-6 space-y-5">
          <div className="space-y-4">
            {positions.map((position) => (
              <Input
                key={position}
                label={t('wordPosition', { n: position })}
                value={values[position] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [position]: event.target.value }))}
                error={errors[position]}
                disabled={warmingUp}
              />
            ))}
          </div>
          {Object.keys(errors).length > 1 && <p className="text-sm text-rose-300">{t('checkOrder')}</p>}
          {formError && <p className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">{formError}</p>}
          {warmingUp && <WalletLoadProgressView progress={loadProgress} />}
          <Button
            size="lg"
            className="w-full"
            onClick={confirm}
            disabled={warmingUp}
            icon={warmingUp ? <Loader2 size={18} className="animate-spin" /> : undefined}
          >
            {warmingUp ? t('appLoading') : t('finishCreate')}
          </Button>
          <Button type="button" variant="secondary" className="w-full" disabled={warmingUp} onClick={cancelSetup}>
            {t('back')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
