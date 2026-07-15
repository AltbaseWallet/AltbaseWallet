import { quaiDebugLog } from './quaiDebugLog'

const APP_NOTIFICATION_TITLE = 'Altbase Wallet'
const DEDUPE_WINDOW_MS = 12_000
const recentlyShown = new Map<string, number>()

const showWebNotificationFallback = async (body: string, title: string) => {
  if (!('Notification' in window)) return
  let permission = Notification.permission
  if (permission === 'default') permission = await Notification.requestPermission()
  if (permission === 'granted') {
    new Notification(title, { body })
  }
}

export const showSystemNotification = (body: string, title = APP_NOTIFICATION_TITLE) => {
  const normalizedBody = body.replace(/\s+/g, ' ').trim()
  if (!normalizedBody) return
  const now = Date.now()
  const key = `${title}:${normalizedBody}`
  const lastShownAt = recentlyShown.get(key) ?? 0
  const isQuai = /\bquai\b/i.test(normalizedBody)
  if (now - lastShownAt < DEDUPE_WINDOW_MS) {
    if (isQuai) quaiDebugLog('toast.system.dedupe', { title, body: normalizedBody, lastShownAt, now })
    return
  }
  recentlyShown.set(key, now)
  for (const [seenKey, seenAt] of recentlyShown) {
    if (now - seenAt > DEDUPE_WINDOW_MS) recentlyShown.delete(seenKey)
  }
  void (async () => {
    const result = await window.altbaseWallet?.notify?.({ title, body: normalizedBody })
    if (isQuai) quaiDebugLog('toast.system.notifyResult', { title, body: normalizedBody, result })
    if (result?.ok) return
    await showWebNotificationFallback(normalizedBody, title)
    if (isQuai) quaiDebugLog('toast.system.webFallback', { title, body: normalizedBody })
  })()
}
