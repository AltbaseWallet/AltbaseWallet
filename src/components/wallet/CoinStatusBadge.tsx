import { StatusBadge } from '../ui/StatusBadge'
import { useT } from '../../utils/i18n'
import type { CoinRecoveryProgress, CoinStatus } from '../../types/coin'

/**
 * Coin-status badge with translated label.
 *
 * Keep transient states distinct so startup refresh never looks like downtime.
 */
const blockCount = (blocks: number) => {
  const value = Math.max(0, Math.floor(blocks))
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(value)
}

export function CoinStatusBadge({
  status,
  className,
  recoveryProgress,
}: {
  status: CoinStatus
  className?: string
  recoveryProgress?: CoinRecoveryProgress
}) {
  const t = useT()
  const progress = recoveryProgress
  const hasBlockProgress = Boolean(progress && progress.blocksRemaining > 0)
  const label = status === 'active'
    ? t('coinStatusActive')
    : status === 'recovering'
      ? hasBlockProgress
        ? t('coinStatusRecoveringWithBlocks', { blocks: blockCount(progress!.blocksRemaining) })
        : t('coinStatusRecovering')
    : status === 'syncing' && hasBlockProgress
      ? t('coinStatusSyncingWithBlocks', { blocks: blockCount(progress!.blocksRemaining) })
    : status === 'preparing'
      ? t('coinStatusPreparing')
    : status === 'maintenance'
      ? t('coinStatusMaintenance')
      : status
  return (
    <StatusBadge
      status={status}
      label={label}
      progressPercent={status === 'recovering' || status === 'syncing' ? recoveryProgress?.percent : undefined}
      className={className}
    />
  )
}
