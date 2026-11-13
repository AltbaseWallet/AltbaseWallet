'use strict'
const { app, BrowserWindow, ipcMain, protocol, shell, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const { registerPluginIpc } = require('../electron/plugins/ipc.cjs')
const { stopAllNativeCoreChildren } = require('../electron/native-core-client.cjs')
const root = path.resolve(__dirname, '..'), run = path.join(root, 'local-checks', 'gui-' + Date.now())
fs.mkdirSync(run, { recursive: true }); app.setPath('userData', path.join(run, 'profile'))
protocol.registerSchemesAsPrivileged([{ scheme: 'altbase-coin', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.disableHardwareAcceleration()
let window, manager, stage = 'startup', sendCalls = 0, failSnapshots = false
const operations = {}, errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = expression => window.webContents.executeJavaScript(expression, true)
async function capture(name) {
  // React DOM readiness can precede Chromium's next composited frame.
  await pause(350)
  fs.writeFileSync(path.join(run, name), (await window.webContents.capturePage()).toPNG())
}
async function waitFor(expression, label, timeout = 30000) {
  stage = label
  console.log(JSON.stringify({ stage: label }))
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100) }
  throw Error(`GUI check timed out: ${label}`)
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const distributionHash = () => {
  const files = fs.readdirSync(path.join(root, 'dist/assets')).filter(x => /\.(js|css)$/.test(x)).sort().map(x => path.join(root, 'dist/assets', x))
  files.push(path.join(root, 'dist/index.html'), path.join(root, 'electron/main.cjs'), path.join(root, 'native-plugin-host/bin/linux-x64/altbase_plugin_host'))
  return crypto.createHash('sha256').update(files.map(f => hash(f)).join('\n')).digest('hex')
}
const watchdog = setTimeout(() => { console.error(JSON.stringify({ passed: false, stage, error: 'GUI watchdog timeout' })); manager?.closeSessions(); stopAllNativeCoreChildren(); app.exit(1) }, 150000)

app.whenReady().then(async () => {
  const installed = path.join(run, 'installed'); fs.mkdirSync(installed)
  const compatibilityRoot = path.join(run, 'compatibility'); fs.mkdirSync(compatibilityRoot)
  for (const entry of fs.readdirSync(path.join(root, 'coin-plugins'))) {
    const source = path.join(root, 'coin-plugins', entry), metadata = path.join(source, 'manifest.json')
    if (fs.existsSync(metadata) && JSON.parse(fs.readFileSync(metadata, 'utf8')).runtime?.type === 'legacy') fs.cpSync(source, path.join(compatibilityRoot, entry), { recursive: true })
  }
  manager = new PluginManager({ bundledRoot: compatibilityRoot, installedRoots: [installed],
    dataRoot: path.join(run, 'plugin-data'), hostPath: path.join(root, 'native-plugin-host/bin/linux-x64/altbase_plugin_host') })
  const request = manager.request.bind(manager)
  manager.request = async (id, method, params) => {
    operations[method] = (operations[method] || 0) + 1
    if (method === 'send') { sendCalls++; throw Error('GUI QA forbids sends') }
    if (method === 'snapshot' && failSnapshots) throw Error('Simulated module read failure')
    return request(id, method, params)
  }
  await manager.discover()
  assert.equal(manager.catalog().modules.length, 33)
  const native = require('../electron/vault.cjs')
  const allowed = new Set(['health', 'generatePhrase', 'validatePhrase', 'createWalletSecret', 'verifyWalletPassword', 'decryptWalletSecret'])
  ipcMain.handle('core:request', async (_event, r) => {
    if (!allowed.has(r.method)) return { ok: false, error: 'Native operation unavailable in isolated GUI QA' }
    try { return { ok: true, result: await native.request(r.method, r.params || {}) } }
    catch { return { ok: false, error: 'Isolated native wallet check failed' } }
  })
  ipcMain.handle('core:reset-session', async () => { manager.closeSessions(); return { ok: true } })
  for (const name of ['app:debug-log', 'app:notify', 'app:open-external']) ipcMain.handle(name, async () => ({ ok: true }))
  ipcMain.handle('mining:request', async () => ({ ok: false, error: 'Mining is disabled in GUI QA' }))
  ipcMain.handle('coin-sdk:request', async () => ({ ok: false, error: 'Compatibility SDKs are disabled in GUI QA' }))
  registerPluginIpc({ ipcMain, getPluginManager: () => manager, isTrustedIpcEvent: e => e.sender === window?.webContents, shell })
  protocol.handle('altbase-coin', async req => {
    const url = new URL(req.url), icon = manager.icon(url.pathname.slice(1))
    return icon ? new Response(fs.readFileSync(icon.file), { headers: { 'Content-Type': icon.mime } }) : new Response('', { status: 404 })
  })
  // No real node or backend can receive data during this check.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }))
  window = new BrowserWindow({ width: 1240, height: 900, show: true, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
    backgroundThrottling: false,
  } })
  window.webContents.on('render-process-gone', () => errors.push('renderer-process-gone'))
  window.webContents.on('console-message', details => {
    if (/Uncaught|Unhandled|React error/.test(details.message || '')) errors.push('renderer-exception')
  })
  await window.loadFile(path.join(root, 'dist/index.html'))
  await waitFor("document.querySelector('[data-testid=modules-link]')", 'welcome')
  await evaluate("document.querySelector('[data-testid=modules-link]').click()")
  await waitFor("document.querySelectorAll('[data-module-id]').length===29", '29 listed compatibility descriptors')
  assert.ok(await evaluate("!document.querySelector('[data-module-id=hypercoin]') && !document.querySelector('[data-module-id=mydogecoin]') && !document.querySelector('[data-module-id=nonsense]') && !document.querySelector('[data-module-id=btgs]')"))
  await waitFor("document.querySelector('[data-testid=delisting-notice]')?.innerText.includes('older version of the wallet')", 'delisting notice')
  assert.ok(await evaluate("document.querySelector('[data-testid=delisting-notice]').innerText.includes('Nonsense (NNN)') && document.querySelector('[data-testid=delisting-notice]').innerText.includes('Bitcoin Gold (BTGS)')"))
  assert.ok(await evaluate("getComputedStyle(document.querySelector('.delisting-track')).animationName==='delisting-scroll'"))
  await evaluate("document.querySelector('[data-testid=delisting-pause]').click()")
  await waitFor("getComputedStyle(document.querySelector('.delisting-track')).animationPlayState==='paused'", 'notice pause')
  await evaluate("document.querySelector('[data-testid=delisting-pause]').click()")
  await waitFor("getComputedStyle(document.querySelector('.delisting-track')).animationPlayState==='running'", 'notice resume')
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await waitFor("getComputedStyle(document.querySelector('.delisting-track')).animationName==='none' && getComputedStyle(document.querySelectorAll('.delisting-copy')[1]).display==='none'", 'reduced motion notice')
  window.setSize(400, 760)
  await waitFor("innerWidth < 450 && document.documentElement.scrollWidth <= innerWidth", 'narrow notice without horizontal overflow')
  await capture('delisting-mobile-reduced-motion.png')
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  window.webContents.debugger.detach()
  window.setSize(1240, 900)
  await evaluate("document.querySelectorAll('[data-module-id] img').forEach(img => { img.loading='eager' })")
  await waitFor("[...document.querySelectorAll('[data-module-id] img')].every(i=>i.complete&&i.naturalWidth>0)", 'module icons')
  await capture('catalog.png')
  const before = distributionHash()
  manager.bundledRoot = null
  await evaluate("document.querySelector('[data-testid=modules-refresh]').click()")
  await waitFor("document.querySelectorAll('[data-module-id]').length===0", 'empty catalog without core coin list')
  fs.copyFileSync(path.join(root, 'local-checks/fixtures/linux-x64/fixture-native.so'), path.join(installed, 'new-coin.so'))
  await evaluate("document.querySelector('[data-testid=modules-refresh]').click()")
  await waitFor("document.querySelector('[data-module-id=fixture-native]')", 'drop-in native module')
  await evaluate("document.querySelectorAll('[data-module-id] img').forEach(img => { img.loading='eager' })")
  await waitFor("document.querySelector('[data-module-id=fixture-native] img')?.naturalWidth>0", 'embedded native icon')
  await capture('installed-native-module.png')
  // Generate an ephemeral test phrase in memory. Never print or report it.
  const generated = await native.request('generatePhrase', {})
  const phrase = generated.phrase
  assert.equal(typeof phrase, 'string')
  const password = crypto.randomBytes(16).toString('hex') + 'Qa9!'
  await evaluate("location.hash='#/restore'")
  await waitFor("document.querySelectorAll('input[autocomplete=off]').length===12", 'restore form')
  await evaluate(`(() => { const data=new DataTransfer(); data.setData('text',${JSON.stringify(phrase)}); document.querySelector('input[autocomplete=off]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data})); return true })()`)
  generated.phrase = null
  await evaluate(`(() => { for (const input of document.querySelectorAll('input[type=password]')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(password)}); input.dispatchEvent(new Event('input',{bubbles:true})); } document.querySelector('input[type=checkbox]').click(); return true })()`)
  await waitFor("!document.querySelector('button[type=submit]').disabled", 'restore readiness')
  await evaluate("document.querySelector('button[type=submit]').click()")
  await waitFor("location.hash==='#/app' && document.body.innerText.includes('4.25 TEST')", 'plugin balance in portfolio', 45000)
  assert.ok(await evaluate("Boolean(document.querySelector('[data-testid=delisting-notice]'))"))
  await capture('portfolio.png')
  await evaluate("location.hash='#/app/receive?coin=fixture-native'")
  await waitFor("document.body.innerText.includes('ALTBASE_FIXTURE_ADDRESS')", 'plugin receive address')
  await evaluate("location.hash='#/app/send?coin=fixture-native'")
  await waitFor("document.querySelector('input[name=to]') && document.querySelector('button[title=MAX]')", 'plugin send form')
  await evaluate("(() => {const input=document.querySelector('input[name=to]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'ALTBASE_FIXTURE_RECIPIENT');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()")
  await waitFor("!document.querySelector('button[title=MAX]').disabled", 'MAX available')
  await evaluate("document.querySelector('button[title=MAX]').click()")
  await waitFor("document.querySelector('input[name=amount]').value==='4.2495'", 'native module MAX result')
  await capture('max-preview.png')
  failSnapshots = true
  await evaluate("location.hash='#/modules'")
  await waitFor("document.querySelector('[data-testid=modules-refresh]')", 'module failure refresh')
  await evaluate("document.querySelector('[data-testid=modules-refresh]').click()")
  await waitFor("!document.querySelector('[data-testid=modules-refresh]').disabled", 'failed read completed')
  await pause(200)
  await evaluate("location.hash='#/app'")
  await waitFor("document.body.innerText.includes('Current balance not verified')", 'unavailable read stays unverified')
  assert.ok(await evaluate("document.body.innerText.includes('4.25 TEST')"))
  await capture('unavailable-preserves-balance.png')
  await evaluate("location.hash='#/app/send?coin=fixture-native'")
  await waitFor("document.querySelector('button[title=MAX]')?.disabled", 'send preparation blocked on unavailable balance')
  assert.equal(sendCalls, 0)
  assert.equal(distributionHash(), before)
  assert.deepEqual(errors, [])
  const report = { at: new Date().toISOString(), passed: true, compatibilityModules: 33,
    listedCompatibilityModules: 29, delistedCoinsHidden: true, delistingNoticePauseResume: true,
    delistingReducedMotion: true, delistingMobileNoOverflow: true,
    dropInNativeWithoutRebuild: true, emptyCatalogSupported: true, iconsLoaded: true,
    isolatedWalletRestored: true, balance: '4.25 TEST', max: '4.2495 TEST', fee: '0.0005 TEST',
    coreDistributionHashBefore: before, coreDistributionHashAfter: distributionHash(),
    guiSendCalls: sendCalls, realNetworkRequestsAllowed: false, unavailableReadPreservesBalance: true,
    unavailableReadBlocksSendPreparation: true, rendererExceptions: errors.length, operations }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, evidence: path.relative(root, run) }))
  clearTimeout(watchdog); manager.closeSessions(); stopAllNativeCoreChildren(); window.destroy(); app.exit(0)
}).catch(async error => {
  // Report only the failed check, not renderer contents or wallet inputs.
  fs.writeFileSync(path.join(run, 'failure.json'), JSON.stringify({ passed: false, stage, errorType: error.name, sends: sendCalls }) + '\n')
  if (stage === 'module icons') console.error(JSON.stringify(await evaluate("[...document.querySelectorAll('[data-module-id]')].map(e=>({id:e.dataset.moduleId,src:e.querySelector('img')?.getAttribute('src'),width:e.querySelector('img')?.naturalWidth})).filter(e=>!e.width)")))
  console.error(JSON.stringify({ passed: false, stage, errorType: error.name, evidence: path.relative(root, run) }))
  clearTimeout(watchdog); manager?.closeSessions(); stopAllNativeCoreChildren(); app.exit(1)
})
