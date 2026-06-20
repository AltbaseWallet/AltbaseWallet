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
    <header className="z-20 shrink-0 border-b border-white/10 bg-ink/85 px-4 py-4 backdrop-blur lg:px-5 xl:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('totalBalance')}</p>
          <h1 className="text-2xl font-bold text-white">{settings.hideBalances ? '••••••' : formatUsd(total)}</h1>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={settings.hideBalances ? <Eye size={16} /> : <EyeOff size={16} />}
            onClick={() => updateSettings({ hideBalances: !settings.hideBalances })}
          >
            {settings.hideBalances ? t('showBalance') : t('hideBalance')}
          </Button>
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
            <ShieldCheck size={16} />
            {t('localVault')}
          </div>
        </div>
      </div>
    </header>
  )
}
