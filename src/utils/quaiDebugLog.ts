type DebugFields = Record<string, unknown>

const logKeyForCoin = (coin: string) => `${coin}-gui-debug-lines`
const MAX_LINES = 200

const safeJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (typeof item === 'bigint') return item.toString()
  if (item instanceof Error) return { message: item.message, stack: item.stack }
  return item
})

const readStoredLines = (coin: string) => {
  try {
    const raw = localStorage.getItem(`altbase_wallet:${logKeyForCoin(coin)}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((line) => typeof line === 'string') : []
  } catch {
    return []
  }
}

const writeStoredLine = (coin: string, line: string) => {
  try {
    const lines = [...readStoredLines(coin), line].slice(-MAX_LINES)
    localStorage.setItem(`altbase_wallet:${logKeyForCoin(coin)}`, JSON.stringify(lines))
  } catch {
    // Debug logging must never break wallet state updates.
  }
}

export const coinDebugLog = (coin: string, event: string, fields: DebugFields = {}) => {
  const normalizedCoin = coin.toLowerCase()
  const payload = {
    at: new Date().toISOString(),
    event,
    ...fields,
  }
  const line = `[${normalizedCoin.toUpperCase()}-GUI-DEBUG] ${safeJson(payload)}`
  try {
    console.info(line)
  } catch {
    // Console can be unavailable in some embedded contexts.
  }
  writeStoredLine(normalizedCoin, line)
  void window.altbaseWallet?.debugLog?.({ coin: normalizedCoin, line }).catch(() => undefined)
}

export const coinDebugLogError = (coin: string, event: string, error: unknown, fields: DebugFields = {}) => {
  coinDebugLog(coin, event, {
    ...fields,
    error: error instanceof Error ? error.message : String(error),
  })
}

export const quaiDebugLog = (event: string, fields: DebugFields = {}) =>
  coinDebugLog('quai', event, fields)

export const quaiDebugLogError = (event: string, error: unknown, fields: DebugFields = {}) => {
  coinDebugLogError('quai', event, error, fields)
}
