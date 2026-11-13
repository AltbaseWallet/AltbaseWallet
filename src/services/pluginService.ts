import type { Coin } from '../types/coin'
import type { NativeCoinRoute } from '../coin-modules/types'
import { installPluginCatalog } from '../coin-modules'
import { pluginReadiness } from './pluginReadiness'

export type PluginDescriptor = {
  id: string; name: string; ticker: string; version: string; kind: 'utxo' | 'account' | 'privacy' | 'cell'
  abiVersion: number; schemaVersion: number; networkId: string; decimals: number
  capabilities: string[]; runtimeType: 'legacy' | 'plugin'; nativeRoute: NativeCoinRoute
  testOnly: boolean; coin: Coin
}
export type PluginCatalog = {
  modules: PluginDescriptor[]; diagnostics: Array<{ file: string; error: string }>; directory: string
}
export type ModuleUpdateStatus = { configured: boolean; changed: boolean; lastChecked: string | null; error: string | null }
let current: PluginCatalog = { modules: [], diagnostics: [], directory: '' }
const bridge = () => {
  if (!window.altbaseWallet?.plugins) throw new Error('Open Altbase Wallet in the desktop application to load coin modules.')
  return window.altbaseWallet.plugins
}
export const pluginService = {
  async checkUpdates() {
    const response = await bridge().updates()
    if (!response.ok || !response.result) throw new Error(response.error || 'Could not check module updates')
    return response.result
  },
  current: () => current,
  async load(refresh = false) {
    const response = await bridge().catalog(refresh)
    if (!response.ok || !response.result) throw new Error(response.error || 'Could not load coin modules')
    current = installPluginCatalog(response.result)
    pluginReadiness.reset()
    return current
  },
  async request<T>(coin: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await bridge().request({ coin, method, params })
    if (!response.ok) throw new Error(response.error || 'Coin module request failed')
    return response.result as T
  },
  async openDirectory() {
    const result = await bridge().openDirectory()
    if (!result.ok) throw new Error(result.error || 'Could not open the modules folder')
  },
}
