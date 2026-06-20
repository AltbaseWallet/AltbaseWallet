import { Badge } from './Badge'

const statusStyles: Record<string, { badge: string; dot: string }> = {
  confirmed: { badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200', dot: 'bg-emerald-300' },
  pending: { badge: 'border-amber-400/40 bg-amber-400/10 text-amber-200', dot: 'bg-amber-300' },
  failed: { badge: 'border-rose-400/40 bg-rose-400/10 text-rose-200', dot: 'bg-rose-300' },
  active: { badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200', dot: 'bg-emerald-300' },
  syncing: { badge: 'border-sky-400/40 bg-sky-400/10 text-sky-200', dot: 'bg-sky-300' },
  preparing: { badge: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200', dot: 'bg-cyan-300' },
  recovering: { badge: 'border-yellow-400/45 bg-yellow-400/10 text-yellow-200', dot: 'bg-yellow-300' },
  offline: { badge: 'border-slate-400/30 bg-slate-400/10 text-slate-300', dot: 'bg-slate-400' },
  maintenance: { badge: 'border-amber-400/40 bg-amber-400/10 text-amber-200', dot: 'bg-amber-300' },
}

export function StatusBadge({
  status,
  label,
  className,
  progressPercent,
}: {
  status: string
  label?: string
  className?: string
  progressPercent?: number
}) {
  const style = statusStyles[status] ?? { badge: 'border-slate-400/30 bg-slate-400/10 text-slate-300', dot: 'bg-slate-400' }
  const clampedProgress = typeof progressPercent === 'number'
    ? Math.max(0, Math.min(100, progressPercent))
    : undefined

  return (
    <Badge className={`relative min-w-0 max-w-full shrink overflow-hidden whitespace-nowrap capitalize ${style.badge} ${className ?? ''}`}>
      {clampedProgress !== undefined && (
        <span
          className="absolute inset-y-0 left-0 bg-current/10"
          style={{ width: `${clampedProgress}%` }}
        />
      )}
      <span className={`relative mr-1.5 h-1.5 w-1.5 rounded-full ${style.dot}`} />
      <span className="relative min-w-0 truncate">{label ?? status}</span>
    </Badge>
  )
}
