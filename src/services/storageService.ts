// localStorage wrapper with namespaced keys.
//
// The early scaffolding used the prefix "altcoin_wallet_mock:" because back
// then the data layer was a stub. We dropped the "mock" word from everything
// user-facing, but existing installs still have keys under the old prefix.
// On first load we transparently migrate them so no wallet is lost.

const PREFIX = 'altbase_wallet:'
const LEGACY_PREFIX = 'altcoin_wallet_mock:'

const migrate = () => {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(`${PREFIX}__migrated`)) return
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key?.startsWith(LEGACY_PREFIX)) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    const newKey = PREFIX + key.slice(LEGACY_PREFIX.length)
    if (localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, value)
    }
  }
  // Second pass: remove all legacy keys
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (key?.startsWith(LEGACY_PREFIX)) localStorage.removeItem(key)
  }
  localStorage.setItem(`${PREFIX}__migrated`, '1')
}

migrate()

export const storageService = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`${PREFIX}${key}`)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },

  set<T>(key: string, value: T) {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value))
  },

  remove(key: string) {
    localStorage.removeItem(`${PREFIX}${key}`)
  },

  /**
   * Remove every key that starts with `${PREFIX}${prefix}` — including the
   * unscoped key and ALL per-wallet scoped variants (`<key>:wf-<hash>`).
   * Used when switching/restoring wallets so a previous seed's cached data
   * (transactions, balances, reservations) can never bleed into the new wallet.
   */
  removeByPrefix(prefix: string) {
    const full = `${PREFIX}${prefix}`
    Object.keys(localStorage)
      .filter((key) => key === full || key.startsWith(`${full}:`))
      .forEach((key) => localStorage.removeItem(key))
  },

  clear() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => localStorage.removeItem(key))
  },
}
