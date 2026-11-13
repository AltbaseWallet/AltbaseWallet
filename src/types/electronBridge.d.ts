import type { PluginCatalog } from '../services/pluginService'
export {}

declare global {
    interface Window {
      altbaseWallet?: {
        plugins: {
          updates: () => Promise<{ ok: boolean; result?: import('../services/pluginService').ModuleUpdateStatus; error?: string }>
          catalog: (refresh?: boolean) => Promise<{ ok: boolean; result?: PluginCatalog; error?: string }>
          request: (request: { coin: string; method: string; params: Record<string, unknown> }) => Promise<{ ok: boolean; result?: unknown; error?: string }>
          openDirectory: () => Promise<{ ok: boolean; error?: string }>
        }
        openExternal: (url: string) => Promise<{ ok: boolean }>
        notify: (payload: { title?: string; body: string }) => Promise<{ ok: boolean; error?: string }>
        debugLog?: (payload: { coin: string; line: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
        coinSdk: (request: { coin: string; method: string; params: Record<string, unknown> }) => Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string; txid?: string; uncertain?: boolean }>
        core: (request: {
          method: string
          params?: Record<string, string | number | boolean | undefined>
        }) => Promise<{
          ok: boolean
          result?: Record<string, string>
          error?: string
        }>
        resetCoreSession: () => Promise<{ ok: boolean; error?: string }>
        mining: {
          request: (request: {
            method: string
            params?: Record<string, unknown>
          }) => Promise<{
            ok: boolean
            result?: unknown
            error?: string
          }>
          onEvent: (callback: (payload: unknown) => void) => () => void
        }
        onCoreProgress: (callback: (payload: unknown) => void) => () => void
      }
    }
  }
