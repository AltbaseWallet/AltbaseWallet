'use strict'
// Compiled production renderer, isolated profile/catalog, live read-only NNN API.
const { app, BrowserWindow, ipcMain, protocol, shell, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const { registerPluginIpc } = require('../electron/plugins/ipc.cjs')
const { stopAllNativeCoreChildren } = require('../electron/native-core-client.cjs')
const root = path.resolve(__dirname, '..'), run = path.join(root, 'local-checks', 'nonsense-gui-' + Date.now())
fs.mkdirSync(run, { recursive: true }); app.setPath('userData', path.join(run, 'profile')); app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'altbase-coin', privileges: { standard: true, secure: true } }])
let window, manager, stage = 'startup'
const reads = [], blocked = [], errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = code => window.webContents.executeJavaScript(code, true)
async function waitFor(code, label, timeout = 90000) {
  stage = label
  console.log(JSON.stringify({ stage }))
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await evaluate(`Boolean(${code})`)) return; await pause(200) }
  throw Error('Live NNN GUI check timed out')
}
const watchdog = setTimeout(() => { manager?.closeSessions(); stopAllNativeCoreChildren(); app.exit(1) }, 240000)
app.whenReady().then(async () => {
  const bundled = path.join(run, 'bundled'); fs.mkdirSync(bundled)
  fs.cpSync(path.join(root, 'coin-plugins/nonsense'), path.join(bundled, 'nonsense'), { recursive: true })
  manager = new PluginManager({ bundledRoot: bundled, installedRoots: [path.join(run, 'installed')], dataRoot: path.join(run, 'data'), hostPath: '/unused' })
  await manager.discover(); assert.equal(manager.catalog().modules.length, 1)
  const vault = require('../electron/vault.cjs')
  const allowed = new Set(['health', 'generatePhrase', 'validatePhrase', 'createWalletSecret', 'verifyWalletPassword', 'decryptWalletSecret'])
  ipcMain.handle('core:request', async (_event, r) => {
    if (!allowed.has(r.method)) return { ok: false, error: 'Disabled in read-only GUI check' }
    try { return { ok: true, result: await vault.request(r.method, r.params || {}) } }
    catch { return { ok: false, error: 'Isolated vault check failed' } }
  })
  ipcMain.handle('core:reset-session', async () => ({ ok: true }))
  for (const name of ['app:debug-log', 'app:notify', 'app:open-external']) ipcMain.handle(name, async () => ({ ok: true }))
  for (const name of ['mining:request', 'coin-sdk:request']) ipcMain.handle(name, async () => ({ ok: false, error: 'Disabled in read-only GUI check' }))
  registerPluginIpc({ ipcMain, getPluginManager: () => manager, isTrustedIpcEvent: e => e.sender === window?.webContents, shell })
  protocol.handle('altbase-coin', req => {
    const icon = manager.icon(new URL(req.url).pathname.slice(1))
    return icon ? new Response(fs.readFileSync(icon.file), { headers: { 'Content-Type': icon.mime } }) : new Response('', { status: 404 })
  })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (d, callback) => {
    const u = new URL(d.url)
    const permitted = u.origin === 'https://api.altbase.io' && (
      d.method === 'POST' && u.pathname === '/api/v1/wallet/snapshot'
      || ['GET', 'OPTIONS'].includes(d.method) && /^\/api\/v1\/(nonsense\/(network|address\/[^/]+\/(balance|utxos|transactions)|fee)|prices|wallet\/snapshot)$/.test(u.pathname)
    )
    ;(permitted ? reads : blocked).push({ method: d.method, path: u.pathname })
    callback({ cancel: !permitted })
  })
  window = new BrowserWindow({ width: 1240, height: 900, show: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('render-process-gone', () => errors.push('renderer-process-gone'))
  await window.loadFile(path.join(root, 'dist/index.html'))
  await waitFor("document.querySelector('[data-testid=modules-link]')", 'compiled renderer ready')
  const generated = await vault.request('generatePhrase', {}), password = crypto.randomBytes(16).toString('hex') + 'Qa9!'
  await evaluate("location.hash='#/restore'")
  await waitFor("document.querySelectorAll('input[autocomplete=off]').length===12", 'isolated restore form')
  await evaluate(`(() => {const data=new DataTransfer();data.setData('text',${JSON.stringify(generated.phrase)});document.querySelector('input[autocomplete=off]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));return true})()`)
  generated.phrase = null
  await evaluate(`(() => {for(const input of document.querySelectorAll('input[type=password]')){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(password)});input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('input[type=checkbox]').click();return true})()`)
  await waitFor("!document.querySelector('button[type=submit]').disabled", 'restore form ready')
  await evaluate("document.querySelector('button[type=submit]').click()")
  await waitFor("location.hash==='#/app' && document.querySelector('[data-coin-row=nonsense]')", 'live NNN dashboard')
  console.log(JSON.stringify({ initialRow: await evaluate("document.querySelector('[data-coin-row=nonsense]').innerText") }))
  await waitFor("/\\bactive\\b/i.test(document.querySelector('[data-coin-row=nonsense]').innerText)", 'NNN active after live backend read')
  const row = await evaluate("document.querySelector('[data-coin-row=nonsense]').innerText")
  const network = await evaluate("fetch('https://api.altbase.io/api/v1/nonsense/network').then(r=>{if(!r.ok)throw Error('Network read failed');return r.json()})")
  assert.ok(reads.some(r => r.method === 'POST' && r.path === '/api/v1/wallet/snapshot'))
  assert.equal(/maintenance|offline|syncing|Current balance not verified/i.test(row), false)
  assert.ok(await evaluate("document.querySelector('[data-coin-row=nonsense] img')?.naturalWidth>0"))
  assert.deepEqual(errors, [])
  await pause(350)
  fs.writeFileSync(path.join(run, 'nonsense-active.png'), (await window.webContents.capturePage()).toPNG())
  const result = { at: new Date().toISOString(), passed: true, compiledProductionRenderer: true, isolatedProfileAndCatalog: true, liveSnapshotRead: true, row, network, reads, blocked, realTransactions: 0, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result))
  clearTimeout(watchdog); manager.closeSessions(); stopAllNativeCoreChildren(); window.destroy(); app.exit(0)
}).catch(async error => {
  const result = { passed: false, stage, errorType: error.name, reads, blocked, evidence: path.relative(root, run) }
  if (stage === 'NNN active after live backend read') {
    result.row = await evaluate("document.querySelector('[data-coin-row=nonsense]')?.innerText").catch(() => null)
    fs.writeFileSync(path.join(run, 'nonsense-failure.png'), (await window.webContents.capturePage()).toPNG())
  }
  fs.writeFileSync(path.join(run, 'failure.json'), JSON.stringify(result, null, 2) + '\n'); console.error(JSON.stringify(result))
  clearTimeout(watchdog); manager?.closeSessions(); stopAllNativeCoreChildren(); app.exit(1)
})
