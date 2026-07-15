const { app, BrowserWindow, Menu, ipcMain, Notification, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { NativeCoreClient } = require('./native-core-client.cjs')

const APP_ID = 'com.altbase.wallet'
const APP_NAME = 'Altbase Wallet'
const APP_DATA_DIR_NAME = 'Altbase'
const LEGACY_APP_DATA_DIRS = ['altcoinwallet', 'AltcoinWallet', 'Altcoin Wallet', 'Altbase Wallet']
const profileArgument = process.argv.find((argument) => argument.startsWith('--altbase-profile='))
const profileFromArgument = profileArgument?.slice('--altbase-profile='.length) ?? ''
const profileFromExecutable = path.basename(process.execPath).match(/^Altbase Wallet Profile-([a-z0-9_-]+)\.exe$/i)?.[1] ?? ''
const isolatedProfile = /^[a-z0-9_-]{1,32}$/i.test(profileFromArgument || profileFromExecutable)
  ? (profileFromArgument || profileFromExecutable).toLowerCase()
  : ''
let nativeCore = null
let mainWindow = null
let allowQuitAfterEpicSend = false
let epicSendQuitWait = null
const privacyNativeCores = new Map()
const nodeNativeCores = new Map()
const activeNotifications = new Set()
const NODE_NATIVE_CORE_POOL_SIZE = 4
const DEBUG_LOG_MAX_BYTES = 512 * 1024
const DEBUG_LOG_KEEP_LINES = 400
const DEBUG_LOG_LINE_MAX_CHARS = 4_000
const DEBUG_LOG_TRIM_EVERY_WRITES = 64
const debugLogWriteQueues = new Map()
const debugLogWriteCounts = new Map()
const DEBUG_LOG_COINS = new Set([
  'bitcoin',
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
  'qubic',
  'kaspa',
  'ckb',
  'zano',
  'epic',
])
const CORE_METHODS = new Set([
  'health',
  'listWalletModules',
  'coinNodeRequest',
  'validateAddress',
  'generatePhrase',
  'validatePhrase',
  'createWalletSecret',
  'verifyWalletPassword',
  'decryptWalletSecret',
  'privacyScope',
  'privacyLightWallet',
  'addressVariantsFromLegacy',
  'addressToScript',
  'deriveAddress',
  'deriveWif',
  'estimateFee',
  'planTransaction',
  'signTransaction',
])

const isTrustedIpcEvent = (event) => Boolean(
  mainWindow
  && !mainWindow.isDestroyed()
  && event.sender === mainWindow.webContents,
)

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

const getNodeNativeCore = (coin = 'node') => {
  const normalized = String(coin || 'node').toLowerCase()
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0
  }
  const key = `pool-${hash % NODE_NATIVE_CORE_POOL_SIZE}`
  if (!nodeNativeCores.has(key)) {
    nodeNativeCores.set(key, new NativeCoreClient(app))
  }
  return nodeNativeCores.get(key)
}

const nativeCoreForRequest = (method, params = {}) => {
  if (method === 'privacyLightWallet') return getPrivacyNativeCore(params.coin)
  if (method === 'coinNodeRequest') return getNodeNativeCore(params.coin)
  return getNativeCore()
}

const activeNativeClients = () => [
  nativeCore,
  ...privacyNativeCores.values(),
  ...nodeNativeCores.values(),
].filter(Boolean)

const deferQuitForEpicSend = () => {
  const clients = activeNativeClients().filter((client) => client.hasPendingEpicSend())
  if (clients.length === 0) return false
  mainWindow?.hide()
  if (!epicSendQuitWait) {
    epicSendQuitWait = Promise.all(clients.map((client) => client.waitForEpicSend()))
      .then(() => new Promise((resolve) => setTimeout(resolve, 3_000)))
      .finally(() => {
        allowQuitAfterEpicSend = true
        epicSendQuitWait = null
        app.quit()
      })
  }
  return true
}

const directoryHasFiles = (dir) => {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

const migrateUserDataDirectory = () => {
  const appData = app.getPath('appData')
  app.setName(APP_NAME)
  if (isolatedProfile) {
    app.setPath('userData', path.join(appData, `${APP_DATA_DIR_NAME} Profiles`, isolatedProfile))
    return
  }

  const target = path.join(appData, APP_DATA_DIR_NAME)
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

const WINDOW_STATE_FILE = 'window-state.json'
const WINDOW_MIN_WIDTH = 360
const WINDOW_MIN_HEIGHT = 560

const loadWindowState = () => {
  const fallback = { width: 1240, height: 820, maximized: false }
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), WINDOW_STATE_FILE), 'utf8'))
    const candidate = {
      x: Number.isFinite(stored.x) ? Math.round(stored.x) : undefined,
      y: Number.isFinite(stored.y) ? Math.round(stored.y) : undefined,
      width: Number.isFinite(stored.width) ? Math.round(stored.width) : fallback.width,
      height: Number.isFinite(stored.height) ? Math.round(stored.height) : fallback.height,
      maximized: stored.maximized === true,
    }
    const display = candidate.x === undefined || candidate.y === undefined
      ? screen.getPrimaryDisplay()
      : screen.getDisplayMatching(candidate)
    const area = display.workArea
    const width = Math.min(Math.max(candidate.width, Math.min(WINDOW_MIN_WIDTH, area.width)), area.width)
    const height = Math.min(Math.max(candidate.height, Math.min(WINDOW_MIN_HEIGHT, area.height)), area.height)
    const x = candidate.x === undefined
      ? Math.round(area.x + (area.width - width) / 2)
      : Math.min(Math.max(candidate.x, area.x), area.x + area.width - width)
    const y = candidate.y === undefined
      ? Math.round(area.y + (area.height - height) / 2)
      : Math.min(Math.max(candidate.y, area.y), area.y + area.height - height)
    return { x, y, width, height, maximized: candidate.maximized }
  } catch {
    return fallback
  }
}

const saveWindowState = (window) => {
  try {
    const bounds = window.getNormalBounds()
    const statePath = path.join(app.getPath('userData'), WINDOW_STATE_FILE)
    fs.writeFileSync(statePath, JSON.stringify({ ...bounds, maximized: window.isMaximized() }))
  } catch {
    // Window state is optional; startup must not depend on it.
  }
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

const appendDebugLogLine = (coin, line) => {
  const file = debugLogPath(coin)
  const previous = debugLogWriteQueues.get(file) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.appendFile(file, `${line.replace(/\r?\n/g, ' ')}\n`, 'utf8')
    const writeCount = (debugLogWriteCounts.get(file) ?? 0) + 1
    debugLogWriteCounts.set(file, writeCount)
    if (writeCount % DEBUG_LOG_TRIM_EVERY_WRITES === 0) trimDebugLogIfNeeded(file)
  })
  debugLogWriteQueues.set(file, current)
  const release = () => {
    if (debugLogWriteQueues.get(file) === current) debugLogWriteQueues.delete(file)
  }
  void current.then(release, release)
  return current
}

ipcMain.handle('core:request', async (event, request = {}) => {
  try {
    if (!isTrustedIpcEvent(event)) throw new Error('Untrusted IPC sender')
    const sender = event.sender
    const method = String(request.method || 'health')
    if (!CORE_METHODS.has(method)) throw new Error('Unsupported native core method')
    if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)) {
      throw new Error('Invalid native core parameters')
    }
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

ipcMain.handle('app:notify', async (event, payload = {}) => {
  try {
    if (!isTrustedIpcEvent(event)) return { ok: false }
    return showSystemNotification(payload)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('app:debug-log', async (event, payload = {}) => {
  try {
    if (!isTrustedIpcEvent(event)) return { ok: false }
    const coin = String(payload.coin || '').toLowerCase()
    if (!DEBUG_LOG_COINS.has(coin)) return { ok: true }
    const line = String(payload.line || '').slice(0, DEBUG_LOG_LINE_MAX_CHARS)
    if (!line) return { ok: true }
    await appendDebugLogLine(coin, line)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('app:open-external', async (event, url) => {
  try {
    if (!isTrustedIpcEvent(event)) return { ok: false }
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:') return { ok: false }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

const createWindow = () => {
  const windowState = loadWindowState()
  const window = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    resizable: true,
    maximizable: true,
    title: APP_NAME,
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
  if (windowState.maximized) window.maximize()

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

  window.on('close', () => saveWindowState(window))

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
      if (parsed.protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch {
      // Deny malformed or non-web URLs.
    }
    return { action: 'deny' }
  })

  const appFileUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()
  let expectedUrl = appFileUrl
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    const candidate = new URL(process.env.VITE_DEV_SERVER_URL)
    if (!['127.0.0.1', 'localhost', '::1'].includes(candidate.hostname)) {
      throw new Error('Development server must use a loopback address')
    }
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') {
      throw new Error('Development server must use HTTP or HTTPS')
    }
    expectedUrl = candidate.toString()
  }

  window.webContents.on('will-navigate', (event, url) => {
    try {
      const expected = new URL(expectedUrl)
      const target = new URL(url)
      const allowed = expected.protocol === 'file:'
        ? target.protocol === 'file:' && target.pathname === expected.pathname
        : target.origin === expected.origin
      if (allowed) return
    } catch {
      // Invalid navigation targets are denied below.
    }
    event.preventDefault()
  })

  window.on('close', (event) => {
    if (!allowQuitAfterEpicSend && deferQuitForEpicSend()) event.preventDefault()
  })

  window.loadURL(expectedUrl)
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

app.on('before-quit', (event) => {
  if (!allowQuitAfterEpicSend && deferQuitForEpicSend()) {
    event.preventDefault()
    return
  }
  nativeCore?.stop()
  for (const client of privacyNativeCores.values()) client.stop()
  privacyNativeCores.clear()
  for (const client of nodeNativeCores.values()) client.stop()
  nodeNativeCores.clear()
})
