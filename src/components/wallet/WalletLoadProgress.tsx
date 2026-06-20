import { Check, Loader2 } from 'lucide-react'
import type { WalletLoadProgress } from '../../types/walletLoadProgress'
import { useT } from '../../utils/i18n'

type WalletLoadProgressViewProps = {
  progress: WalletLoadProgress | null
}

export function WalletLoadProgressView({ progress }: WalletLoadProgressViewProps) {
  const t = useT()
  if (!progress) return null
  const activeIndex = progress.steps.findIndex((step) => step.id === progress.activeId)
  const isReady = progress.activeId === 'ready'

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        {isReady ? (
          <Check size={16} className="shrink-0 text-emerald-300" />
        ) : (
          <Loader2 size={16} className="shrink-0 animate-spin text-[var(--accent)]" />
        )}
        <span className="shrink-0 font-semibold text-white">{t('walletLoadProgressTitle')}</span>
        <span className="truncate text-slate-300">{t(progress.activeKey)}</span>
      </div>
      <span className="shrink-0 text-xs text-slate-500">
        {Math.max(activeIndex + 1, 1)}/{progress.steps.length}
      </span>
    </div>
  )
}
