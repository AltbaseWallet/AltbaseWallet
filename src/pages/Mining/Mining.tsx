import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCoinStore } from '../../store/coinStore'
import { walletService } from '../../services/walletService'
import { useSettingsStore } from '../../store/settingsStore'

type MiningMessage = {
  source?: string
  type?: string
  requestId?: string
  request?: {
    method?: string
    params?: Record<string, unknown>
  }
  url?: string
}

export default function Mining() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [searchParams] = useSearchParams()
  const coins = useCoinStore((state) => state.coins)
  const theme = useSettingsStore((state) => state.settings.theme)
  const requestedCoinId = searchParams.get('coin')?.toLowerCase() || null
  const moduleUrl = useMemo(() => {
    const params = new URLSearchParams({ embedded: '1' })
    if (requestedCoinId && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(requestedCoinId)) {
      params.set('coin', requestedCoinId)
      params.set('entry', 'coin')
    }
    return `altbase-module://mining/index.html?${params.toString()}`
  }, [requestedCoinId])
  const walletCoinsRef = useRef(coins)
  const moduleContext = useMemo(() => ({
    source: 'altbase-wallet',
    type: 'context',
    schemaVersion: 1,
    selectedCoinId: requestedCoinId,
    entryMode: requestedCoinId ? 'coin' : 'general',
    theme,
    coins: coins.map(({ id, name, ticker, status }) => ({ id, name, ticker, status })),
  }), [coins, requestedCoinId, theme])
  const contextRef = useRef(moduleContext)

  useEffect(() => {
    walletCoinsRef.current = coins
    contextRef.current = moduleContext
    frameRef.current?.contentWindow?.postMessage(moduleContext, '*')
  }, [coins, moduleContext])

  useEffect(() => {
    const sendToModule = (payload: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage(payload, '*')
    }
    const sendContext = () => sendToModule(contextRef.current)
    const respond = (requestId: string, response: unknown) => {
      sendToModule({ source: 'altbase-wallet', type: 'response', schemaVersion: 1, requestId, response })
    }
    const onMessage = (event: MessageEvent<MiningMessage>) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== 'null') return
      if (event.data?.source !== 'altbase-mining') return
      if (event.data.type === 'ready') sendContext()
      if (event.data.type === 'activity') window.dispatchEvent(new Event('altbase:user-activity'))
      if (event.data.type === 'request') {
        const requestId = String(event.data.requestId || '')
        const method = String(event.data.request?.method || '')
        const params = event.data.request?.params
        if (!/^[A-Za-z0-9-]{1,96}$/.test(requestId) || !method) return
        if (method === 'getMiningIdentity') {
          const coinId = String(params?.coinId || '').toLowerCase()
          const algorithm = String(params?.algorithm || '').toLowerCase()
          const coin = walletCoinsRef.current.find((entry) => entry.id === coinId)
          if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(coinId) || !/^[a-z0-9][a-z0-9._/-]{0,63}$/.test(algorithm)) {
            respond(requestId, { ok: false, error: 'Invalid mining identity request' })
          } else {
            const respondWithAddress = (address: string) => respond(requestId, {
              ok: true,
              result: {
                coinId,
                algorithm,
                kind: coinId === 'qubic' ? 'public-identity' : 'payout-address',
                value: address,
                source: 'wallet-host',
              },
            })
            const existingAddress = walletService.getWalletAddresses()[coinId] ?? coin?.address
            if (existingAddress) {
              respondWithAddress(existingAddress)
              return
            }
            void walletService.ensurePublicAddress(coinId)
              .then((derivedAddress) => {
                const currentCoin = useCoinStore.getState().coins.find((entry) => entry.id === coinId)
                const address = derivedAddress
                  ?? walletService.getWalletAddresses()[coinId]
                  ?? currentCoin?.address
                  ?? coin?.address
                if (!address) {
                  respond(requestId, { ok: false, error: `${currentCoin?.name || coin?.name || coinId} wallet identity is still preparing` })
                  return
                }
                respondWithAddress(address)
              })
              .catch((error) => respond(requestId, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }))
          }
          return
        }
        void window.altbaseWallet?.mining.request({ method, params })
          .then((response) => respond(requestId, response))
          .catch((error) => respond(requestId, { ok: false, error: error instanceof Error ? error.message : String(error) }))
        return
      }
      if (event.data.type === 'open-external') {
        const requestId = String(event.data.requestId || '')
        if (!/^[A-Za-z0-9-]{1,96}$/.test(requestId)) return
        void window.altbaseWallet?.openExternal(String(event.data.url || ''))
          .then((response) => respond(requestId, response))
          .catch((error) => respond(requestId, { ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
    }
    const removeMiningListener = window.altbaseWallet?.mining.onEvent((payload) => {
      sendToModule({ source: 'altbase-wallet', type: 'event', schemaVersion: 1, payload })
    })
    window.addEventListener('message', onMessage)
    sendToModule({ source: 'altbase-wallet', type: 'host-ready', schemaVersion: 1 })
    sendContext()
    return () => {
      window.removeEventListener('message', onMessage)
      removeMiningListener?.()
    }
  }, [])

  return (
    <iframe
      key={moduleUrl}
      ref={frameRef}
      src={moduleUrl}
      title="Altbase Mining"
      className="block h-full min-h-0 w-full border-0 bg-[#0b0f17]"
      sandbox="allow-scripts allow-modals"
      onLoad={() => frameRef.current?.contentWindow?.postMessage({ source: 'altbase-wallet', type: 'host-ready' }, '*')}
    />
  )
}
