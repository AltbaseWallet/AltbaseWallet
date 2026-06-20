const { app, BrowserWindow, Menu, ipcMain, Notification, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { NativeCoreClient } = require('./native-core-client.cjs')

const APP_ID = 'com.altbase.wallet'
const APP_NAME = 'Altbase Wallet'
const APP_DATA_DIR_NAME = 'Altbase'
const LEGACY_APP_DATA_DIRS = ['altcoinwallet', 'AltcoinWallet', 'Altcoin Wallet', 'Altbase Wallet']
let nativeCore = null
let mainWindow = null
const privacyNativeCores = new Map()
const activeNotifications = new Set()
const DEBUG_LOG_MAX_BYTES = 512 * 1024
const DEBUG_LOG_KEEP_LINES = 400
const DEBUG_LOG_LINE_MAX_CHARS = 4_000
const DEBUG_LOG_COINS = new Set([
  'bitcoin2',
  'bitcoincashii',
  'capstash',
  'firo',
  'kerrigan',
  'litecoinii',
  'pepecoin',
  'scash',
  'neoxa',
  'terracoin',
  'junkcoin',
  'raptoreum',
  'pearl',
  'quai',
  'zano',
  'epic',
])

const getNativeCore = () => {
  nativeCore ??= new NativeCoreClient(app)
  return nativeCore
}

const getPrivacyNativeCore = (coin = 'privacy') => {
  const key = String(coin || 'privacy').toLowerCase()
  if (!privacyNativeCores.has(key)) {
    privacyNativeCores.set(key, new NativeCoreClient(app))
  }
  return privacyNativeCores.get(key)
}

const nativeCoreForRequest = (method, params = {}) =>
  method === 'privacyLightWallet' ? getPrivacyNativeCore(params.coin) : getNativeCore()

const directoryHasFiles = (dir) => {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

const migrateUserDataDirectory = () => {
  const appData = app.getPath('appData')
  const target = path.join(appData, APP_DATA_DIR_NAME)
  app.setName(APP_NAME)
  app.setPath('userData', target)

  if (directoryHasFiles(target)) return

  for (const name of LEGACY_APP_DATA_DIRS) {
    const source = path.join(appData, name)
    if (source === target || !directoryHasFiles(source)) continue
    try {
      fs.mkdirSync(target, { recursive: true })
      fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false })
      return
    } catch {
      // If migration fails, Electron will still start with a clean Altbase dir.
    }
  }
}

migrateUserDataDirectory()

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
})

const windowIconPath = () => {
  if (app.isPackaged) return path.join(process.resourcesPath, 'build', 'icon.ico')
  return path.join(__dirname, '..', 'build', 'icon.ico')
}

const windowsStartMenuShortcutPath = () =>
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`)

const ensureWindowsToastRegistration = () => {
  if (process.platform !== 'win32') return { ok: true, skipped: true }
  app.setAppUserModelId(APP_ID)

  const shortcutPath = windowsStartMenuShortcutPath()
  const details = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    description: APP_NAME,
    icon: windowIconPath(),
    iconIndex: 0,
    appUserModelId: APP_ID,
  }

  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true })
    let current = null
    try {
      if (fs.existsSync(shortcutPath)) current = shell.readShortcutLink(shortcutPath)
    } catch {
      current = null
    }

    const currentTarget = current?.target ? path.normalize(current.target).toLowerCase() : ''
    const wantedTarget = path.normalize(details.target).toLowerCase()
    const alreadyRegistered =
      currentTarget === wantedTarget &&
      current?.appUserModelId === APP_ID

    if (!alreadyRegistered) {
      const operation = fs.existsSync(shortcutPath) ? 'replace' : 'create'
      if (!shell.writeShortcutLink(shortcutPath, operation, details)) {
        return { ok: false, error: 'failed to register Windows notification shortcut' }
      }
    }
    return { ok: true, shortcutPath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const safeSend = (webContents, channel, payload) => {
  try {
    if (!webContents || webContents.isDestroyed()) return
    webContents.send(channel, payload)
  } catch {
    // The window may be destroyed while native-core is still reporting progress.
  }
}

const trimNotificationText = (value, fallback, maxLength) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim() || fallback
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

const showSystemNotification = ({ title, body }) => {
  const registration = ensureWindowsToastRegistration()
  if (!registration.ok) return registration
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
    return { ok: false, error: 'system notifications are not supported' }
  }
  const notification = new Notification({
    title: trimNotificationText(title, APP_NAME, 80),
    body: trimNotificationText(body, '', 240),
    icon: windowIconPath(),
    silent: false,
  })
  activeNotifications.add(notification)
  const release = () => activeNotifications.delete(notification)
  notification.once('close', release)
  notification.once('failed', release)
  setTimeout(release, 30_000)
  notification.show()
  return { ok: true }
}

const debugLogPath = (coin = 'quai') => path.join(app.getPath('userData'), `${coin}-gui-debug.log`)

const trimDebugLogIfNeeded = (file) => {
  try {
    const stat = fs.statSync(file)
    if (stat.size <= DEBUG_LOG_MAX_BYTES) return
    const readSize = Math.min(stat.size, DEBUG_LOG_MAX_BYTES * 2)
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(readSize)
    try {
      fs.readSync(fd, buffer, 0, readSize, stat.size - readSize)
    } finally {
      fs.closeSync(fd)
    }
    const raw = buffer.toString('utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-DEBUG_LOG_KEEP_LINES)
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  } catch {
    // Best effort only.
  }
}

const trimExistingDebugLogs = () => {
  try {
    const dir = app.getPath('userData')
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('-gui-debug.log')) trimDebugLogIfNeeded(path.join(dir, name))
    }
  } catch {
    // Best effort only.
  }
}

ipcMain.handle('core:request', async (event, request = {}) => {
  try {
    const sender = event.sender
    const method = String(request.method || 'health')
    const result = await nativeCoreForRequest(method, request.params || {}).request(
      method,
      request.params || {},
      (payload) => safeSend(sender, 'core:progress', payload),
    )
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('app:notify', async (_, payload = {}) => {
  try {
    return showSystemNotification(payload)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('app:debug-log', async (_, payload = {}) => {
  try {
    const coin = String(payload.coin || '').toLowerCase()
    if (!DEBUG_LOG_COINS.has(coin)) return { ok: true }
    const line = String(payload.line || '').slice(0, DEBUG_LOG_LINE_MAX_CHARS)
    if (!line) return { ok: true }
    const file = debugLogPath(coin)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${line.replace(/\r?\n/g, ' ')}\n`, 'utf8')
    trimDebugLogIfNeeded(file)
    return { ok: true, path: file }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('app:open-external', async (_, url) => {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1440,
    minHeight: 900,
    maxWidth: 1440,
    maxHeight: 900,
    resizable: false,
    maximizable: false,
    title: 'Altbase Wallet',
    icon: windowIconPath(),
    backgroundColor: '#0B0F17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      // No DevTools in the shipped app — it would let users inspect elements and
      // read bundled asset (logo) file paths.
      devTools: !app.isPackaged,
    },
  })
  mainWindow = window

  // Replace the default Chromium context menu (which exposes "Save image as",
  // "Copy image address" and "Inspect" — all of which leak bundled logo paths)
  // with a minimal edit menu that only appears for editable inputs / selected
  // text, so users can still paste a seed or address.
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return
    Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' },
    ]).popup({ window })
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (process.platform === 'win32') {
    window.setAppDetails({
      appId: APP_ID,
      appIconPath: windowIconPath(),
      appIconIndex: 0,
      relaunchCommand: process.execPath,
      relaunchDisplayName: APP_NAME,
    })
  }

  Menu.setApplicationMenu(null)

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url)
      }
    } catch {
      // Deny malformed or non-web URLs.
    }
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  ensureWindowsToastRegistration()
  trimExistingDebugLogs()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  nativeCore?.stop()
  for (const client of privacyNativeCores.values()) client.stop()
  privacyNativeCores.clear()
})
