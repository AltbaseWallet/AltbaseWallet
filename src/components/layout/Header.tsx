import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Button } from '../ui/Button'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import { formatUsd } from '../../utils/formatAmount'
import { useT } from '../../utils/i18n'

export function Header() {
  const t = useT()
  const coins = useCoinStore((state) => state.coins)
  const { settings, updateSettings } = useSettingsStore()
  const total = coins.filter((coin) => coin.enabled).reduce((sum, coin) => sum + (coin.fiatValue ?? 0), 0)

  return (
    <header className="z-20 shrink-0 border-b border-white/10 bg-ink/95 px-3 py-3 sm:px-4 lg:px-5 xl:px-6">
      <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('totalBalance')}</p>
          <h1 className="truncate text-xl font-bold text-white sm:text-2xl">{settings.hideBalances ? '••••••' : formatUsd(total)}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={settings.hideBalances ? <Eye size={16} /> : <EyeOff size={16} />}
            onClick={() => updateSettings({ hideBalances: !settings.hideBalances })}
          >
            <span className="hidden md:inline">{settings.hideBalances ? t('showBalance') : t('hideBalance')}</span>
          </Button>
          <div className="flex h-9 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 text-sm text-emerald-200 sm:px-3">
            <ShieldCheck size={16} />
            <span className="hidden sm:inline">{t('localVault')}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
