import { useEffect } from 'react'
import { useTransactionStore } from '../../store/transactionStore'
import { useT } from '../../utils/i18n'
import { quaiDebugLog } from '../../utils/quaiDebugLog'
import { showSystemNotification } from '../../utils/systemNotification'

/**
 * Watches incoming transaction events and forwards them to OS notifications.
 */
export function GlobalToast() {
  const t = useT()
  const notif = useTransactionStore((s) => s.pendingNotification)
  const clear = useTransactionStore((s) => s.clearNotification)

  useEffect(() => {
    if (!notif) return
    const message = t(notif.kind === 'received-confirmed' ? 'receivedConfirmedToast' : 'receivedToast', {
      amount: notif.amount,
      ticker: notif.coinTicker,
    })
    if (notif.coinTicker.toLowerCase() === 'quai') {
      quaiDebugLog('toast.global.show', { notif, message })
    }
    showSystemNotification(message)
    clear()
  }, [notif, clear, t])

  return null
}
