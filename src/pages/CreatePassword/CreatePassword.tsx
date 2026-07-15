import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { useAuthStore } from '../../store/authStore'
import { walletService } from '../../services/walletService'
import { getPasswordStrength, passwordPairSchema, passwordValidationKeys } from '../../utils/validatePassword'
import { useT, type TranslationKey } from '../../utils/i18n'

export default function CreatePassword() {
  const t = useT()
  const navigate = useNavigate()
  const createWallet = useAuthStore((state) => state.createWallet)
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [errors, setErrors] = useState<{ password?: string; repeatPassword?: string; form?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const strength = getPasswordStrength(password)
  const passwordErrorText = (message: string) =>
    passwordValidationKeys.has(message) ? t(message as TranslationKey) : t('passwordMinHint')

  useEffect(() => {
    walletService.warmNativeCore()
  }, [])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    const parsed = passwordPairSchema.safeParse({ password, repeatPassword })
    if (!parsed.success) {
      const nextErrors: typeof errors = {}
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0]
        if (field === 'password' || field === 'repeatPassword') nextErrors[field] = passwordErrorText(issue.message)
      })
      setErrors(nextErrors)
      return
    }

    submittingRef.current = true
    setErrors({})
    setSubmitting(true)
    try {
      await createWallet(password)
      navigate('/generate-seed')
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : t('createFailed') })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      <Card className="w-full max-w-lg">
        <h1 className="text-2xl font-bold text-white">{t('createPasswordTitle')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('createPasswordNote')}</p>

        <form className="mt-6 space-y-5" onSubmit={onSubmit}>
          <div className="rounded-[20px] border border-white/10 bg-white/6 p-4">
            <PasswordInput
              autoFocus
              autoComplete="new-password"
              label={t('password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
              disabled={submitting}
            />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={`h-2 rounded-full ${index < strength ? 'bg-[var(--accent)]' : 'bg-white/10'}`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">{t('passwordMinHint')}</p>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-white/6 p-4">
            <PasswordInput
              autoComplete="new-password"
              label={t('repeatPassword')}
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              error={errors.repeatPassword}
              disabled={submitting}
            />
          </div>
          <div className="flex gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
            <ShieldAlert size={18} className="shrink-0" />
            {t('passwordWarning')}
          </div>
          {errors.form && <p className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">{errors.form}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? t('creatingWallet') : t('continue')}
          </Button>
          <Button type="button" variant="secondary" className="w-full" disabled={submitting} onClick={() => navigate('/welcome')}>
            {t('back')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
