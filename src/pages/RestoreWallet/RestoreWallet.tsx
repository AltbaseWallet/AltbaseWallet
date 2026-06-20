import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { SeedNoShareConfirm } from '../../components/wallet/SeedConfirmToggle'
import { SeedPhraseGridInput } from '../../components/wallet/SeedPhraseGridInput'
import { WalletLoadProgressView } from '../../components/wallet/WalletLoadProgress'
import { useAuthStore } from '../../store/authStore'
import { walletService } from '../../services/walletService'
import type { WalletLoadProgress } from '../../types/walletLoadProgress'
import { passwordPairSchema, passwordValidationKeys } from '../../utils/validatePassword'
import { validateSeedPhrase } from '../../utils/validateSeedPhrase'
import { useT, type TranslationKey } from '../../utils/i18n'

export default function RestoreWallet() {
  const t = useT()
  const navigate = useNavigate()
  const restoreWallet = useAuthStore((state) => state.restoreWallet)
  const [seedPhrase, setSeedPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [errors, setErrors] = useState<{ seedPhrase?: string; password?: string; repeatPassword?: string; form?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [loadProgress, setLoadProgress] = useState<WalletLoadProgress | null>(null)
  const submittingRef = useRef(false)
  const passwordErrorText = (message: string) =>
    passwordValidationKeys.has(message) ? t(message as TranslationKey) : t('passwordMinHint')

  useEffect(() => {
    walletService.warmNativeCore()
  }, [])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    const nextErrors: typeof errors = {}
    const seed = validateSeedPhrase(seedPhrase)
    if (!seed.ok) nextErrors.seedPhrase = t('seed12Required')

    const passwordResult = passwordPairSchema.safeParse({ password, repeatPassword })
    if (!passwordResult.success) {
      passwordResult.error.issues.forEach((issue) => {
        const field = issue.path[0]
        if (field === 'password' || field === 'repeatPassword') nextErrors[field] = passwordErrorText(issue.message)
      })
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setLoadProgress(null)
    setErrors({})
    try {
      await restoreWallet(seedPhrase, password, setLoadProgress, { seedSafetyAcknowledged: understood })
      navigate('/app')
    } catch (error) {
      setLoadProgress(null)
      setErrors({ form: error instanceof Error ? error.message : t('restoreFailed') })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      <Card className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-white">{t('restoreTitle')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('restoreNote')}</p>
        <form className="mt-6 space-y-5" onSubmit={onSubmit}>
          <SeedPhraseGridInput value={seedPhrase} onChange={setSeedPhrase} error={errors.seedPhrase} />
          <div className="grid gap-4 rounded-[20px] border border-white/10 bg-white/6 p-4 md:grid-cols-2">
            <PasswordInput
              autoComplete="new-password"
              label={t('newPassword')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
              disabled={submitting}
            />
            <PasswordInput
              autoComplete="new-password"
              label={t('repeatPassword')}
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              error={errors.repeatPassword}
              disabled={submitting}
            />
          </div>
          <SeedNoShareConfirm checked={understood} onChange={setUnderstood} disabled={submitting} />
          {errors.form && <p className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">{errors.form}</p>}
          {submitting && <WalletLoadProgressView progress={loadProgress} />}
          <Button type="submit" size="lg" className="w-full" disabled={submitting || !understood}>
            {submitting ? t('restoring') : t('restoreBtn')}
          </Button>
          <Button type="button" variant="secondary" className="w-full" disabled={submitting} onClick={() => navigate('/welcome')}>
            {t('back')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
