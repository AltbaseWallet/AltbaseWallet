export type PluginReadiness = 'unknown' | 'ready' | 'syncing' | 'balance-unavailable' | 'error'
let revision = 0
const states = new Map<string, PluginReadiness>()
const listeners = new Set<() => void>()
export const pluginReadiness = {
  revision: () => revision,
  get: (id: string) => states.get(id) ?? 'unknown',
  set(id: string, state: PluginReadiness, expectedRevision = revision) {
    if (revision !== expectedRevision || states.get(id) === state) return
    states.set(id, state); for (const listener of listeners) listener()
  },
  reset() { revision++; states.clear(); for (const listener of listeners) listener() },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
}
