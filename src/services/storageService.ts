// Share the released wallet's keys. Older working-copy keys are imported once,
// without combining two populated wallets or deleting the encrypted originals.
const PREFIX = 'altbase_wallet:'
const LEGACY_PREFIXES = ['altbase_fullnode:', 'altcoin_wallet_mock:']
const MIGRATED = 'altbase-profile-namespace-migrated-v1'

const migrateNamespace = () => {
  if (localStorage.getItem(MIGRATED) === '1') return
  const created: string[] = []
  try {
    if (localStorage.getItem(`${PREFIX}wallet-meta`) === null) {
      const selected = LEGACY_PREFIXES.find(prefix => localStorage.getItem(`${prefix}wallet-meta`) !== null)
      if (selected) {
        const keys = typeof localStorage.key === 'function'
          ? Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => key !== null)
          : Object.keys(localStorage)
        for (const key of new Set([...keys, `${selected}wallet-meta`, `${selected}wallet-addresses`])) {
          if (!key.startsWith(selected)) continue
          const target = PREFIX + key.slice(selected.length), value = localStorage.getItem(key)
          if (value !== null && localStorage.getItem(target) === null) {
            localStorage.setItem(target, value)
            created.push(target)
          }
        }
      }
    }
    localStorage.setItem(MIGRATED, '1')
  } catch {
    for (const key of created) localStorage.removeItem(key)
    throw new Error('Could not open the existing wallet profile. Its original data was retained.')
  }
}

export const storageService = {
  get<T>(key: string, fallback: T): T {
    migrateNamespace()
    try {
      const raw = localStorage.getItem(`${PREFIX}${key}`)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },

  set<T>(key: string, value: T) {
    migrateNamespace()
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value))
  },

  /** Keep profile metadata and its address map together if storage is full. */
  setMany(values: Record<string, unknown>) {
    migrateNamespace()
    const entries = Object.entries(values).map(([key, value]) => [`${PREFIX}${key}`, JSON.stringify(value)] as const)
    const before = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]))
    try {
      for (const [key, value] of entries) localStorage.setItem(key, value)
    } catch (error) {
      // Remove new values first to free the space needed by the old profile.
      for (const [key] of entries) localStorage.removeItem(key)
      for (const [key, value] of before) if (value !== null) localStorage.setItem(key, value)
      throw error
    }
  },

  remove(key: string) {
    migrateNamespace()
    localStorage.removeItem(`${PREFIX}${key}`)
  },

  /**
   * Remove every key that starts with `${PREFIX}${prefix}` — including the
   * unscoped key and ALL per-wallet scoped variants (`<key>:wf-<hash>`).
   * Used when switching/restoring wallets so a previous seed's cached data
   * (transactions, balances, reservations) can never bleed into the new wallet.
   */
  removeByPrefix(prefix: string) {
    migrateNamespace()
    const full = `${PREFIX}${prefix}`
    Object.keys(localStorage)
      .filter((key) => key === full || key.startsWith(`${full}:`))
      .forEach((key) => localStorage.removeItem(key))
  },

  clear() {
    migrateNamespace()
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => localStorage.removeItem(key))
  },
}
