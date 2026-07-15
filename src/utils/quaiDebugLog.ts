type DebugFields = Record<string, unknown>

const SENSITIVE_LOG_KEY = /(?:mnemonic|phrase|password|private|secret|seed|wif|scanState|cachedWalletState|nativeWalletFileBlob)/i
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 40
const MAX_STRING_CHARS = 2_000
const MAX_LINE_CHARS = 4_000
const FLUSH_DELAY_MS = 50
const MAX_PENDING_LINES = 100

type PendingDebugLine = { coin: string; line: string }

const pendingLines: PendingDebugLine[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

const normalizeForLog = (value: unknown, key = '', depth = 0, seen = new WeakSet<object>()): unknown => {
  if (key && SENSITIVE_LOG_KEY.test(key)) return '[redacted]'
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}...[truncated]` : value
  }
  if (value instanceof Error) return { message: value.message }
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return String(value)
  if (depth >= 5) return '[depth-limited]'
  if (seen.has(value)) return '[circular]'

  seen.add(value)
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => normalizeForLog(item, '', depth + 1, seen))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`)
    return items
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const normalized: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
    normalized[entryKey] = normalizeForLog(entryValue, entryKey, depth + 1, seen)
  }
  if (entries.length > MAX_OBJECT_KEYS) normalized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS
  return normalized
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(normalizeForLog(value))
  } catch {
    return JSON.stringify({ error: 'debug-payload-serialization-failed' })
  }
}

const scheduleFlush = () => {
  if (flushTimer || flushing || pendingLines.length === 0) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPendingLines()
  }, FLUSH_DELAY_MS)
}

const flushPendingLines = async () => {
  if (flushing) return
  flushing = true
  try {
    while (pendingLines.length > 0) {
      const batch = pendingLines.splice(0, 10)
      await Promise.all(batch.map(({ coin, line }) =>
        window.altbaseWallet?.debugLog?.({ coin, line }).catch(() => undefined),
      ))
    }
  } finally {
    flushing = false
    scheduleFlush()
  }
}

const enqueueDebugLine = (coin: string, line: string) => {
  if (!window.altbaseWallet?.debugLog) return
  pendingLines.push({ coin, line })
  if (pendingLines.length > MAX_PENDING_LINES) pendingLines.splice(0, pendingLines.length - MAX_PENDING_LINES)
  scheduleFlush()
}

export const coinDebugLog = (coin: string, event: string, fields: DebugFields = {}) => {
  const normalizedCoin = coin.toLowerCase()
  const payload = {
    at: new Date().toISOString(),
    event,
    ...fields,
  }
  const rawLine = `[${normalizedCoin.toUpperCase()}-GUI-DEBUG] ${safeJson(payload)}`
  const line = rawLine.length > MAX_LINE_CHARS ? `${rawLine.slice(0, MAX_LINE_CHARS)}...[truncated]` : rawLine
  if (import.meta.env.DEV) console.info(line)
  enqueueDebugLine(normalizedCoin, line)
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
