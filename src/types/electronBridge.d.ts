export {}

declare global {
    interface Window {
      altbaseWallet?: {
        openExternal: (url: string) => Promise<{ ok: boolean }>
        notify: (payload: { title?: string; body: string }) => Promise<{ ok: boolean; error?: string }>
        debugLog?: (payload: { coin: string; line: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
        core: (request: {
          method: string
          params?: Record<string, string | number | boolean | undefined>
        }) => Promise<{
          ok: boolean
          result?: Record<string, string>
          error?: string
        }>
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
