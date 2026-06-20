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
        onCoreProgress: (callback: (payload: unknown) => void) => () => void
      }
    }
  }
