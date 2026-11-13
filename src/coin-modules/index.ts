import type { CoinModule } from './types'
import type { PluginCatalog, PluginDescriptor } from '../services/pluginService'
import { isListedCoin } from '../utils/coinListings'

// Populated before React starts. No coin list is compiled into this registry.
export const coinModules: CoinModule[] = []
const modulesById = new Map<string, CoinModule>()
const pluginsById = new Map<string, PluginDescriptor>()
export function installPluginCatalog(catalog: PluginCatalog) {
  const listed = { ...catalog, modules: catalog.modules.filter(item => isListedCoin(item.id) && isListedCoin(item.coin.id)) }
  const next = listed.modules.map(item => ({ id: item.id, nativeRoute: item.nativeRoute, coin: { ...item.coin } }))
  coinModules.splice(0, coinModules.length, ...next)
  modulesById.clear(); pluginsById.clear()
  for (const module of next) modulesById.set(module.id, module)
  for (const descriptor of listed.modules) pluginsById.set(descriptor.id, descriptor)
  return listed
}
export const coinModuleRegistry = {
  get: (coinId: string) => modulesById.get(coinId),
  require(coinId: string) {
    const module = modulesById.get(coinId)
    if (!module) throw new Error(`Coin module is not installed: ${coinId}`)
    return module
  },
  all: () => [...coinModules],
  descriptor: (coinId: string) => pluginsById.get(coinId),
  isPlugin: (coinId: string) => pluginsById.get(coinId)?.runtimeType === 'plugin',
}
export type { CoinModule, NativeCoinRoute } from './types'
