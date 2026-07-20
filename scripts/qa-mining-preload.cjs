const { ipcRenderer } = require('electron')

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'altbase-mining') return
  if (event.data.type === 'request') {
    void ipcRenderer.invoke('mining:request', event.data.request)
      .then((result) => {
        window.postMessage({
          source: 'altbase-wallet',
          type: 'response',
          requestId: event.data.requestId,
          response: { ok: true, result },
        }, '*')
      })
      .catch((error) => {
        window.postMessage({
          source: 'altbase-wallet',
          type: 'response',
          requestId: event.data.requestId,
          response: { ok: false, error: error instanceof Error ? error.message : String(error) },
        }, '*')
      })
    return
  }
  if (event.data.type === 'open-external') {
    void ipcRenderer.invoke('app:open-external', event.data.url)
  }
})

window.addEventListener('DOMContentLoaded', () => {
  window.postMessage({ source: 'altbase-wallet', type: 'host-ready' }, '*')
  window.postMessage({
    source: 'altbase-wallet',
    type: 'context',
    selectedCoinId: new URLSearchParams(location.search).get('coin') || null,
    entryMode: new URLSearchParams(location.search).get('entry') === 'coin' ? 'coin' : 'general',
    coins: [],
    theme: 'dark',
  }, '*')
})
