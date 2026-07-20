const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

console.log('[mining-ui-qa] boot')

const root = path.resolve(__dirname, '..')
const frontend = path.join(root, 'modules', 'mining', 'dist', 'frontend', 'index.html')
const preload = path.join(root, 'scripts', 'qa-mining-preload.cjs')
const outputRoot = path.join(root, 'build-logs', 'mining-ui-qa')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'modules', 'mining', 'catalog', 'default-catalog.json'), 'utf8'))
const scenarios = new Map()
const withTimeout = (promise, timeoutMs, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)),
])

const activeJob = {
  id: 'qa-raptoreum-cpu',
  name: 'Raptoreum CPU',
  coinId: 'raptoreum',
  algorithm: 'gr',
  runtimeState: 'running',
  miner: { id: 'xmrig', version: '6.26.0', adapterVersion: '1.0.0' },
  pools: [{ name: 'RPlant Europe', url: 'stratum+ssl://eu.rplant.xyz:17056' }],
  devices: { mode: 'cpu', ids: ['cpu:0'], intensity: 'auto', cpuThreads: 1 },
  runtimeMetrics: {
    startedAt: Date.now() - 185_000,
    hashrateHps: 2_740,
    hashrateUnit: 'h/s',
    powerWatts: 42,
    temperatureCelsius: 61,
    acceptedShares: 4,
    rejectedShares: 0,
    staleShares: 0,
  },
}

const qubicActiveJob = {
  id: 'qa-qubic-cpu',
  name: 'Qubic CPU',
  coinId: 'qubic',
  algorithm: 'qubic-upow',
  runtimeState: 'running',
  miner: { id: 'qli-client', version: '3.6.1', adapterVersion: '1.0.0' },
  pools: [{ name: 'Qubic.li Registerless', url: 'wss://wps.qubic.li/ws' }],
  devices: { mode: 'cpu', ids: ['cpu:0'], intensity: 'auto', cpuThreads: 1 },
  runtimeMetrics: {
    startedAt: Date.now() - 185_000,
    hashrateHps: 1_320_377,
    hashrateUnit: 'it/s',
    powerWatts: null,
    temperatureCelsius: null,
    acceptedShares: 0,
    rejectedShares: 0,
    staleShares: 0,
  },
}

const miningResponse = (scenario, request) => {
  const method = String(request?.method || '')
  const params = request?.params || {}
  const runningJob = scenario.qubicActive ? qubicActiveJob : activeJob
  switch (method) {
    case 'status':
      return {
        installed: true,
        verified: true,
        installedVersion: '0.1.6',
        bundledVersion: '0.1.6',
        updateAvailable: false,
        walletApiVersion: '1.0.0',
        platform: 'windows-x64',
        runningJobs: scenario.active ? [runningJob.id] : [],
        dataBytes: 0,
        dataPath: outputRoot,
      }
    case 'catalog':
      return { ...catalog, poolDirectory: { ...catalog.poolDirectory, entries: [] } }
    case 'customPools':
      return []
    case 'listJobs':
      return scenario.active
        ? [runningJob]
        : scenario.saved
          ? [scenario.savedJob || { ...activeJob, runtimeState: 'stopped', runtimeMetrics: undefined }]
          : []
    case 'saveJob':
      scenario.savedJob = { ...params.job, runtimeState: 'stopped' }
      return scenario.savedJob
    case 'installedMiners':
      return scenario.active || scenario.saved ? [{
        id: runningJob.miner.id,
        displayName: scenario.qubicActive ? 'QLI Client' : 'XMRig',
        version: runningJob.miner.version,
        platform: 'windows-x64',
        state: 'verified',
        running: true,
        sourceUrl: 'https://github.com/xmrig/xmrig',
      }] : []
    case 'hardware':
      return {
        cpu: { model: 'QA 8-Core CPU', logicalThreads: 8, memoryBytes: 16 * 1024 ** 3 },
        gpus: [{ id: '0', vendorId: 0x10de, deviceId: 0x2684, active: true, usable: true, renderer: 'NVIDIA QA GPU' }],
      }
    case 'checkModuleUpdates':
      return { currentVersion: '0.1.6', latestVersion: '0.1.6', updateAvailable: false, installable: false }
    case 'checkMinerUpdates':
      return { miners: [] }
    case 'getMiningIdentity':
      return {
        coinId: params.coinId,
        algorithm: params.algorithm,
        kind: params.coinId === 'qubic' ? 'public-identity' : 'payout-address',
        value: params.coinId === 'qubic'
          ? 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARMID'
          : `RQA${String(params.coinId || 'coin').toUpperCase()}111111111111111111111111111`,
      }
    case 'logs':
      return scenario.qubicActive ? [
        '[2026-07-18 19:16:09.359] [INFO] E:222 | SHARES: 0/0 (R:0) | [AVX2] 1274447 it/s | 1320377 avg it/s',
      ] : scenario.active ? [
        '[2026-07-16 12:55:01] net connected to eu.rplant.xyz:17056',
        '[2026-07-16 12:55:02] cpu READY threads 1/8',
        '[2026-07-16 12:55:06] speed 2.74 kH/s accepted 4 rejected 0',
        '[2026-07-16 12:55:12] new job from eu.rplant.xyz:17056',
      ] : []
    case 'manifest':
      return { version: '0.1.6', files: Array(67).fill(null) }
    default:
      throw new Error(`Unhandled Mining UI QA request: ${method}`)
  }
}

const waitFor = async (window, expression, timeoutMs = 15_000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const diagnostics = await window.webContents.executeJavaScript(`({
    href: location.href,
    activeScreen: document.querySelector('.screen.active')?.dataset.view || null,
    dialogOpen: Boolean(document.querySelector('#quick-start-dialog')?.open),
    quickCoins: document.querySelectorAll('#quick-coin-choices .quick-coin-option').length,
    metrics: [...document.querySelectorAll('.metrics-grid .metric')].map((entry) => entry.innerText),
    jobCoin: document.querySelector('#job-coin')?.value || null,
    toast: document.querySelector('#module-toast')?.textContent || null
  })`, true)
  throw new Error(`Mining UI QA timed out waiting for ${expression}: ${JSON.stringify(diagnostics)}`)
}

const capture = async ({ name, width, height, active = false, qubicActive = false, expert = false, saved = false, surface = '' }) => {
  const quickIconAudit = surface.startsWith('quick-icons-')
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#070a10',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${name}] renderer exited: ${details.reason}`)
  })
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    console.error(`[${name}] preload failed: ${error.message}`)
  })
  const webContentsId = window.webContents.id
  scenarios.set(webContentsId, { active, qubicActive, saved })
  window.on('closed', () => scenarios.delete(webContentsId))
  const opensCoinEntry = expert || quickIconAudit || ['quick-pool', 'custom-pool'].includes(surface) || (!active && !saved && !surface)
  await window.loadFile(frontend, {
    query: opensCoinEntry
      ? { embedded: '1', coin: 'neoxa', entry: 'coin' }
      : { embedded: '1' },
  })
  console.log(`[${name}] frontend loaded`)
  await waitFor(window, "document.querySelector('[data-view=\"dashboard\"].active')")
  await waitFor(window, "document.querySelectorAll('select:not([hidden])').length === 11 && document.querySelectorAll('select.themed-select-source').length === 11 && document.querySelectorAll('.themed-select').length === 11")
  await waitFor(window, "document.body.dataset.moduleReady === 'true'")
  await waitFor(window, "document.querySelectorAll('[title]').length === 0")
  if (quickIconAudit) {
    await waitFor(window, "document.querySelector('#quick-start-dialog')?.open && document.querySelectorAll('#quick-coin-choices .quick-coin-option').length === 23")
    await waitFor(window, "[...document.querySelectorAll('#quick-coin-choices img')].length === 23 && [...document.querySelectorAll('#quick-coin-choices img')].every((image) => image.complete && image.naturalWidth > 0)")
    const audit = await window.webContents.executeJavaScript(`(() => {
      const grid = document.querySelector('#quick-coin-choices')
      grid.scrollLeft = 0
      const wheel = new WheelEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true })
      grid.dispatchEvent(wheel)
      const firstPosition = grid.scrollLeft
      const firstPrevented = wheel.defaultPrevented
      const moved = firstPosition > 0 && firstPrevented
      const maximum = grid.scrollWidth - grid.clientWidth
      grid.scrollLeft = maximum
      const boundaryWheel = new WheelEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true })
      grid.dispatchEvent(boundaryWheel)
      const releasedAtBoundary = !boundaryWheel.defaultPrevented && grid.scrollLeft === maximum
      const position = ${JSON.stringify(surface)}.endsWith('start') ? 0 : ${JSON.stringify(surface)}.endsWith('middle') ? maximum / 2 : maximum
      grid.scrollLeft = position
      return { moved, firstPosition, firstPrevented, releasedAtBoundary, position: grid.scrollLeft, maximum, icons: grid.querySelectorAll('img').length }
    })()`, true)
    if (!audit.moved || !audit.releasedAtBoundary || audit.maximum <= 0 || audit.icons !== 23) {
      throw new Error(`Quick coin wheel/icon audit failed: ${JSON.stringify(audit)}`)
    }
  } else if (surface === 'quick-pool') {
    await waitFor(window, "document.querySelector('#quick-start-dialog')?.open && document.querySelector('#quick-pool + .themed-select .themed-select-button')")
    await window.webContents.executeJavaScript("document.querySelector('#quick-pool + .themed-select .themed-select-button').click()", true)
    await waitFor(window, "document.querySelector('#themed-select-menu')?.matches(':popover-open') && document.querySelectorAll('#themed-select-menu .themed-select-option').length > 0")
    const selection = await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('#quick-pool')
      const option = [...document.querySelectorAll('#themed-select-menu .themed-select-option')]
        .find((entry) => entry.getAttribute('aria-selected') !== 'true' && !entry.disabled)
      const bounds = option?.getBoundingClientRect()
      return bounds ? {
        before: select.value,
        x: Math.round(bounds.left + bounds.width / 2),
        y: Math.round(bounds.top + bounds.height / 2)
      } : null
    })()`, true)
    if (!selection) throw new Error('Quick pool QA could not find another enabled pool')
    window.showInactive()
    window.webContents.sendInputEvent({ type: 'mouseMove', x: selection.x, y: selection.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: selection.x, y: selection.y, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: selection.x, y: selection.y, button: 'left', clickCount: 1 })
    await waitFor(window, `document.querySelector('#quick-pool')?.value !== ${JSON.stringify(selection.before)} && !document.querySelector('#themed-select-menu')?.matches(':popover-open')`)
    await window.webContents.executeJavaScript("document.querySelector('#quick-pool + .themed-select .themed-select-button').click()", true)
    await waitFor(window, "document.querySelector('#themed-select-menu')?.matches(':popover-open') && document.querySelector('#themed-select-menu')?.closest('dialog')?.id === 'quick-start-dialog'")
  } else if (surface === 'custom-pool') {
    await waitFor(window, "document.querySelector('#quick-start-dialog')?.open && document.querySelector('#quick-add-custom-pool')")
    await window.webContents.executeJavaScript("document.querySelector('#quick-add-custom-pool').click()", true)
    await waitFor(window, "document.querySelector('#custom-pool-dialog')?.open && document.querySelector('#custom-pool-coin + .themed-select .themed-select-button')")
    await window.webContents.executeJavaScript("document.querySelector('#custom-pool-coin + .themed-select .themed-select-button').click()", true)
    await waitFor(window, "document.querySelector('#themed-select-menu')?.matches(':popover-open') && document.querySelectorAll('#themed-select-menu .themed-select-option').length > 10")
  } else if (surface === 'miner-filter') {
    await window.webContents.executeJavaScript("document.querySelector('#mining-advanced-menu').open = true; document.querySelector('[data-screen=\"miners\"]').click()", true)
    await waitFor(window, "document.querySelector('[data-view=\"miners\"]')?.classList.contains('active')")
    await waitFor(window, "document.querySelectorAll('#installed-miners .empty-state').length === 1")
    await waitFor(window, "document.querySelectorAll('[data-catalog-miner] .miner-logo img').length === 4 && [...document.querySelectorAll('[data-catalog-miner] .miner-logo img')].every((image) => image.complete && image.naturalWidth > 0)")
    await window.webContents.executeJavaScript("document.querySelector('#miner-hardware-filter + .themed-select .themed-select-button').click()", true)
    await waitFor(window, "document.querySelector('#themed-select-menu')?.matches(':popover-open') && document.querySelectorAll('#themed-select-menu .themed-select-option').length === 3")
  } else if (surface === 'log-select') {
    await window.webContents.executeJavaScript("document.querySelector('#mining-advanced-menu').open = true; document.querySelector('[data-screen=\"logs\"]').click()", true)
    await waitFor(window, "document.querySelector('[data-view=\"logs\"]')?.classList.contains('active') && document.querySelector('#log-job-select + .themed-select .themed-select-button')")
    await window.webContents.executeJavaScript("document.querySelector('#log-job-select + .themed-select .themed-select-button').click()", true)
    await waitFor(window, "document.querySelector('#themed-select-menu')?.matches(':popover-open') && document.querySelectorAll('#themed-select-menu .themed-select-option').length === 1")
  } else if (surface === 'confirm') {
    await window.webContents.executeJavaScript("document.querySelector('#mining-advanced-menu').open = true; document.querySelector('[data-screen=\"settings\"]').click()", true)
    await waitFor(window, "document.querySelector('[data-view=\"settings\"]')?.classList.contains('active')")
    await window.webContents.executeJavaScript("document.querySelector('#remove-module').click()", true)
    await waitFor(window, "document.querySelector('#module-confirm-dialog')?.open && document.querySelector('#module-confirm-title')?.textContent.includes('Remove')")
  } else if (surface === 'tooltip') {
    await window.webContents.executeJavaScript("document.querySelector('#mining-advanced-menu').open = true; document.querySelector('[data-screen=\"miners\"]').click()", true)
    await waitFor(window, "document.querySelector('[data-view=\"miners\"]')?.classList.contains('active')")
    await waitFor(window, "document.querySelectorAll('#installed-miners .empty-state').length === 1")
    await window.webContents.executeJavaScript("document.querySelector('#refresh-miners').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))", true)
    await waitFor(window, "document.querySelector('#module-tooltip')?.hidden === false && document.querySelector('#module-tooltip')?.textContent === 'Check miner updates'")
  } else if (expert) {
    await waitFor(window, "document.querySelector('#quick-start-dialog')?.open && document.querySelector('#quick-start-run')?.disabled === false")
    await window.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('#quick-start-dialog')
      window.__qaDialogTransitions = []
      new MutationObserver(() => window.__qaDialogTransitions.push({ open: dialog.open, at: Date.now() }))
        .observe(dialog, { attributes: true, attributeFilter: ['open'] })
    })()`, true)
    await window.webContents.executeJavaScript("document.querySelector('#quick-start-advanced').click()", true)
    await waitFor(window, "!document.querySelector('#quick-start-dialog')?.open && document.querySelector('[data-view=\"job\"].active') && document.querySelectorAll('#job-coin-choices .coin-choice').length === 23")
    if (surface === 'expert-select') {
      await window.webContents.executeJavaScript("document.querySelector('#job-algorithm + .themed-select .themed-select-button').click()", true)
      await waitFor(window, "document.querySelector('#themed-select-menu')?.matches(':popover-open') && document.querySelectorAll('#themed-select-menu .themed-select-option').length > 0")
    }
  } else if (!active && !saved) {
    await waitFor(window, "document.querySelector('#quick-start-dialog')?.open && document.querySelectorAll('#quick-coin-choices .quick-coin-option').length === 23 && document.querySelectorAll('#quick-miner-choices .miner-logo img').length > 0 && [...document.querySelectorAll('#quick-miner-choices .miner-logo img')].every((image) => image.complete && image.naturalWidth > 0) && document.querySelector('#quick-start-run')?.disabled === false")
  } else if (active) {
    if (qubicActive) {
      await waitFor(window, "document.querySelector('#mining-mini-console')?.textContent.includes('1320377 avg it/s')")
      await waitFor(window, "document.querySelectorAll('.metrics-grid .metric')[1]?.querySelector('strong')?.textContent === '1.32 M it/s'")
    } else {
      await waitFor(window, "document.querySelector('#mining-mini-console')?.textContent.includes('speed 2.74 kH/s')")
      await waitFor(window, "document.querySelectorAll('.metrics-grid .metric')[1]?.querySelector('strong')?.textContent === '2.74 kH/s'")
    }
  } else {
    await waitFor(window, "document.querySelector('[data-job-id=\"qa-raptoreum-cpu\"] [data-job-resource=\"cpu\"]')?.value === '1'")
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[data-job-id="qa-raptoreum-cpu"] [data-job-resource="cpu"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`, true)
    await waitFor(window, "document.querySelector('[data-job-id=\"qa-raptoreum-cpu\"] [data-job-resource-value]')?.textContent === '3 / 8' && document.querySelector('#module-toast')?.textContent.includes('power saved')")
  }
  await new Promise((resolve) => setTimeout(resolve, 350))
  if (expert) {
    const dialogState = await window.webContents.executeJavaScript(`({
      open: Boolean(document.querySelector('#quick-start-dialog')?.open),
      transitions: window.__qaDialogTransitions || []
    })`, true)
    console.log(`[${name}] dialog state ${JSON.stringify(dialogState)}`)
    if (dialogState.open) {
      await window.webContents.executeJavaScript("document.querySelector('#quick-start-dialog').close()", true)
      await waitFor(window, "!document.querySelector('#quick-start-dialog')?.open && document.querySelector('[data-view=\"job\"].active')")
    }
  }
  window.showInactive()
  window.webContents.invalidate()
  await new Promise((resolve) => setTimeout(resolve, 180))
  const image = await window.webContents.capturePage()
  window.hide()
  fs.writeFileSync(path.join(outputRoot, `${name}.png`), image.toPNG())
  console.log(`[${name}] captured`)
  window.destroy()
}

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const readinessWatchdog = setTimeout(() => {
  console.error('[mining-ui-qa] Electron did not become ready')
  app.exit(2)
}, 15_000)

app.whenReady().then(async () => {
  clearTimeout(readinessWatchdog)
  console.log('[mining-ui-qa] Electron ready')
  fs.rmSync(outputRoot, { recursive: true, force: true })
  fs.mkdirSync(outputRoot, { recursive: true })
  ipcMain.handle('mining:request', (event, request) => miningResponse(scenarios.get(event.sender.id) || {}, request))
  ipcMain.handle('app:open-external', () => true)
  const keeper = new BrowserWindow({ width: 1, height: 1, show: false })
  await keeper.loadURL('about:blank')
  const requestedScenario = String(process.env.MINING_QA_SCENARIO || '').trim()
  for (const scenario of [
    { name: 'quick-start-desktop', width: 1440, height: 900 },
    { name: 'quick-start-mobile', width: 390, height: 844 },
    { name: 'quick-icons-start-desktop', width: 1440, height: 900, surface: 'quick-icons-start' },
    { name: 'quick-icons-middle-desktop', width: 1440, height: 900, surface: 'quick-icons-middle' },
    { name: 'quick-icons-end-desktop', width: 1440, height: 900, surface: 'quick-icons-end' },
    { name: 'quick-icons-start-mobile', width: 390, height: 844, surface: 'quick-icons-start' },
    { name: 'quick-icons-middle-mobile', width: 390, height: 844, surface: 'quick-icons-middle' },
    { name: 'quick-icons-end-mobile', width: 390, height: 844, surface: 'quick-icons-end' },
    { name: 'expert-coins-desktop', width: 1440, height: 900, expert: true },
    { name: 'expert-coins-mobile', width: 390, height: 844, expert: true },
    { name: 'dashboard-power-desktop', width: 1440, height: 900, saved: true },
    { name: 'dashboard-power-mobile', width: 390, height: 844, saved: true },
    { name: 'dashboard-console-desktop', width: 1440, height: 900, active: true },
    { name: 'dashboard-console-mobile', width: 390, height: 844, active: true },
    { name: 'dashboard-qubic-rate-desktop', width: 1440, height: 900, active: true, qubicActive: true },
    { name: 'dashboard-qubic-rate-mobile', width: 390, height: 844, active: true, qubicActive: true },
    { name: 'popup-quick-pool-desktop', width: 1440, height: 900, surface: 'quick-pool' },
    { name: 'popup-quick-pool-mobile', width: 390, height: 844, surface: 'quick-pool' },
    { name: 'popup-expert-algorithm-desktop', width: 1440, height: 900, expert: true, surface: 'expert-select' },
    { name: 'popup-custom-pool-desktop', width: 1440, height: 900, surface: 'custom-pool' },
    { name: 'popup-custom-pool-mobile', width: 390, height: 844, surface: 'custom-pool' },
    { name: 'popup-miner-filter-desktop', width: 1440, height: 900, surface: 'miner-filter' },
    { name: 'popup-log-select-desktop', width: 1440, height: 900, saved: true, surface: 'log-select' },
    { name: 'popup-confirm-desktop', width: 1440, height: 900, surface: 'confirm' },
    { name: 'popup-confirm-mobile', width: 390, height: 844, surface: 'confirm' },
    { name: 'popup-tooltip-desktop', width: 1440, height: 900, surface: 'tooltip' },
  ]) {
    if (requestedScenario && scenario.name !== requestedScenario) continue
    console.log(`[${scenario.name}] starting`)
    await withTimeout(capture(scenario), 30_000, scenario.name)
  }
  keeper.destroy()
  console.log(`Mining UI QA screenshots written to ${outputRoot}`)
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
