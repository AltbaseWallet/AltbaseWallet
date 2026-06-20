import { ArrowDownToLine, Eye, EyeOff, History, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import { formatUsd } from '../../utils/formatAmount'
import { useT } from '../../utils/i18n'

export function BalanceCard() {
  const t = useT()
  const coins = useCoinStore((state) => state.coins)
  const { settings, updateSettings } = useSettingsStore()
  const hideBalances = settings.hideBalances
  const total = coins.filter((coin) => coin.enabled).reduce((sum, coin) => sum + (coin.fiatValue ?? 0), 0)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-400">{t('portfolioValue')}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-xl p-0"
              aria-label={hideBalances ? t('showBalanceAria') : t('hideBalanceAria')}
              onClick={() => updateSettings({ hideBalances: !hideBalances })}
            >
              {hideBalances ? <Eye size={16} /> : <EyeOff size={16} />}
            </Button>
          </div>
          <p className="mt-2 text-4xl font-bold text-white md:text-5xl">{hideBalances ? '••••••' : formatUsd(total)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Link to="/app/receive">
            <Button variant="secondary" className="w-full" icon={<ArrowDownToLine size={17} />}>
              {t('receive')}
            </Button>
          </Link>
          <Link to="/app/send">
            <Button className="w-full" icon={<Send size={17} />}>
              {t('send')}
            </Button>
          </Link>
          <Link to="/app/history">
            <Button variant="secondary" className="w-full" icon={<History size={17} />}>
              {t('history')}
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  )
}
