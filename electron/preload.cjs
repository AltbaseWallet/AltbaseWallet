const { contextBridge, ipcRenderer } = require('electron')

// Block dragging images/icons out of the window (onto the desktop / file
// explorer), which would otherwise copy the bundled asset and expose its path.
// Capture-phase so it wins regardless of any element's own handlers.
window.addEventListener(
  'dragstart',
  (event) => {
    const el = event.target
    const name = el && el.nodeName ? String(el.nodeName).toUpperCase() : ''
    const isImageLike =
      name === 'IMG' ||
      name === 'PICTURE' ||
      name === 'SVG' ||
      (el && typeof el.closest === 'function' && el.closest('img, picture, svg'))
    if (isImageLike) event.preventDefault()
  },
  true,
)

contextBridge.exposeInMainWorld('altbaseWallet', {
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  debugLog: (payload) => ipcRenderer.invoke('app:debug-log', payload),
  core: (request) => ipcRenderer.invoke('core:request', request),
  mining: {
    request: (request) => ipcRenderer.invoke('mining:request', request),
    onEvent: (callback) => {
      const listener = (_, payload) => callback(payload)
      ipcRenderer.on('mining:event', listener)
      return () => ipcRenderer.removeListener('mining:event', listener)
    },
  },
  onCoreProgress: (callback) => {
    const listener = (_, payload) => callback(payload)
    ipcRenderer.on('core:progress', listener)
    return () => ipcRenderer.removeListener('core:progress', listener)
  },
})
