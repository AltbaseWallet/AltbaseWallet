import type { CoinStatus } from '../../types/coin'
import { useT } from '../../utils/i18n'

export const useCoinStatusLabel = () => {
  const t = useT()
  return (status: CoinStatus) =>
    status === 'active'
      ? t('coinStatusActive')
      : status === 'recovering'
        ? t('coinStatusRecovering')
      : status === 'preparing'
        ? t('coinStatusPreparing')
      : status === 'maintenance'
        ? t('coinStatusMaintenance')
        : status
}
