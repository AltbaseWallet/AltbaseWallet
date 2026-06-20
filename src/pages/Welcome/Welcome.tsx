import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { HelpCircle, Languages } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { walletService } from '../../services/walletService'
import { SUPPORTED_LANGUAGES, useT } from '../../utils/i18n'
import type { Language } from '../../types/settings'
import logoUrl from '../../assets/logo.png'

export default function Welcome() {
  const t = useT()
  const { settings, updateSettings } = useSettingsStore()
  const { isCreated, isUnlocked } = useAuthStore()
  const [seedInfoOpen, setSeedInfoOpen] = useState(false)

  useEffect(() => {
    walletService.warmNativeCore()
  }, [])

  if (isCreated) return <Navigate to={isUnlocked ? '/app' : '/unlock'} replace />

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4 text-slate-100">
      <Card className="w-full max-w-xl">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Altbase Wallet" draggable={false} className="pointer-events-none h-12 w-12 select-none rounded-[18px] object-cover" />
            <div>
              <h1 className="text-2xl font-bold text-white">Altbase Wallet</h1>
              <p className="text-sm text-slate-500">{t('welcomeTagline')}</p>
            </div>
          </div>
        </div>

        <div className="mb-8 rounded-[22px] border border-white/10 bg-white/6 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Languages size={16} />
            {t('chooseLanguageNote')}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUPPORTED_LANGUAGES.map(({ code, native, english }) => (
              <button
                key={code}
                type="button"
                onClick={() => updateSettings({ language: code as Language })}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  settings.language === code
                    ? 'border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.18)] text-white'
                    : 'border-white/10 bg-white/7 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
                aria-pressed={settings.language === code}
              >
                <span className="block text-sm font-semibold">{native}</span>
                <span className="text-xs text-slate-500">{english}</span>
              </button>
            ))}
          </div>
          <select
            className="sr-only"
            value={settings.language}
            onChange={(event) => updateSettings({ language: event.target.value as Language })}
            aria-label={t('chooseLanguageNote')}
          >
            {SUPPORTED_LANGUAGES.map(({ code, native }) => (
              <option key={code} value={code}>{native}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-4">
          <Link to="/create-password" className="block">
            <Button size="lg" className="w-full">{t('createWallet')}</Button>
          </Link>
          <Link to="/restore" className="block">
            <Button size="lg" variant="secondary" className="w-full">{t('restoreWallet')}</Button>
          </Link>
          <button
            type="button"
            onClick={() => setSeedInfoOpen(true)}
            className="flex items-center justify-center gap-2 pt-3 text-sm text-slate-400 transition hover:text-white"
          >
            <HelpCircle size={16} />
            {t('whatIsSeed')}
          </button>
        </div>
      </Card>

      <Modal open={seedInfoOpen} title={t('seedExplainerTitle')} onClose={() => setSeedInfoOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/7 p-4 text-sm leading-relaxed text-slate-300">
            {t('seedExplainerBody')}
          </div>
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">
            {t('seedExplainerWarning')}
          </div>
          <Button className="w-full" onClick={() => setSeedInfoOpen(false)}>
            {t('ok')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
