'use strict'
const { app, BrowserWindow, ipcMain, protocol, shell, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const { registerPluginIpc } = require('../electron/plugins/ipc.cjs')
const { NETWORKS } = require('../modules/account-common/networks.cjs')
const { stopAllNativeCoreChildren } = require('../electron/native-core-client.cjs')
const root = path.resolve(__dirname, '..'), run = path.join(root, 'local-checks', 'account-gui-' + Date.now())
fs.mkdirSync(run, { recursive: true }); app.setPath('userData', path.join(run, 'profile')); app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'altbase-coin', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window, manager, stage = 'startup', sendCalls = 0, failReads = false, failTronBalance = false
const runtimes = new Map(), errors = [], operations = {}
const iconRequests = []
let localIconFailures = 1, localIconRequests = 0, iconClockOffset = 0
let imageDownloadFailures = process.argv.includes('--retry-icons') ? 2 : 0
const expectedIconRequests = process.argv.includes('--retry-icons') ? 3 : 1
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = code => window.webContents.executeJavaScript(code, true)
async function waitFor(expression, label, timeout = 45000) {
  stage = label; console.log(JSON.stringify({ stage }))
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100) }
  throw Error('GUI check timed out')
}
async function capture(name) { await pause(300); fs.writeFileSync(path.join(run, name + '.png'), (await window.webContents.capturePage()).toPNG()) }
async function input(selector, value) {
  await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
}
const watchdog = setTimeout(() => { manager?.closeSessions(); app.exit(1) }, 180000)
app.whenReady().then(async () => {
  const bundled = path.join(run, 'bundled'); fs.mkdirSync(bundled)
  for (const network of Object.keys(NETWORKS)) fs.cpSync(path.join(root, 'coin-plugins', network), path.join(bundled, network), { recursive: true })
  manager = new PluginManager({ bundledRoot: bundled, installedRoots: [path.join(run, 'installed')], dataRoot: path.join(run, 'data'), hostPath: '/unused' })
  await manager.discover(); assert.equal(manager.catalog().modules.length, 6)
  manager.request = async (id, method, params) => {
    operations[method] = (operations[method] || 0) + 1
    if (method === 'send') { sendCalls++; throw Error('GUI QA forbids sends') }
    if (!runtimes.has(id)) {
      const config = NETWORKS[id], scale = 10n ** BigInt(config.decimals)
      const adapter = { validate: value => typeof value === 'string' && value.length > 10, normalize: value => value,
        head: async () => { if (failReads) throw Error('Simulated PublicNode timeout'); return { height: 123456 } },
        balance: async () => { if (id === 'tron' && failTronBalance) throw Error('Fixture balance endpoint outage'); return (5n * scale).toString() },
        discover: async () => ({ candidates: ['TOKEN_PUBLIC_FIXTURE', 'TOKEN_SPAM_FIXTURE'], complete: false, reason: 'history-not-indexed' }),
        token: async asset => ({ id: asset, name: asset.includes('SPAM') ? 'Claim reward at example.xyz' : 'Fixture Dollar', symbol: asset.includes('SPAM') ? 'SPAM' : 'UNIT', decimals: 6, atomic: '12500000', complete: true, standard: 'fixture' }),
        prepare: async ({ max, asset }) => ({ atomic: asset ? '12500000' : (max ? 5n * scale - scale / 1000n : scale).toString(), feeAtomic: (scale / 1000n).toString(), nativeRequired: (scale / 1000n).toString(), unsigned: {} }),
        sign: async () => { throw Error('GUI QA forbids signing') } }
      // Exercise the shipped bundle factory and runtime with only the public
      // adapter replaced. No external RPC is reachable in this GUI fixture.
      const definition = JSON.parse(fs.readFileSync(path.join(bundled, id, 'manifest.json')))
      const entry = definition.runtime.binaryPlatforms[`${process.platform}-${process.arch}`]
      const runtime = await require('../electron/plugins/binary-javascript.cjs').loadBinaryJavascript(path.join(bundled, id, entry)).createPlugin({ dataDirectory: path.join(run, 'data', id), adapter, now: () => Date.now() + iconClockOffset,
        iconCache: require('../modules/account-common/icons.cjs').createIconCache(id, path.join(run, 'data', id), { fetchImpl: async (url, options) => {
          iconRequests.push(url)
          if (imageDownloadFailures > 0) { imageDownloadFailures--; throw Error('Fixture image network outage') }
          if (process.argv.includes('--live-icons')) return require('../modules/account-common/publicnode.cjs').httpsFetch(url, options)
          const { PNG } = require('pngjs'), png = new PNG({ width: 32, height: 32 }); png.data.fill(210)
          return new Response(PNG.sync.write(png), { headers: { 'Content-Type': 'image/png' } })
        } }),
        transport: { broadcast: async () => { throw Error('GUI QA forbids broadcasting') } } })
      runtimes.set(id, runtime)
    }
    return runtimes.get(id).request(method, params)
  }
  const vault = require('../electron/vault.cjs'), allowed = new Set(['health', 'generatePhrase', 'validatePhrase', 'createWalletSecret', 'verifyWalletPassword', 'decryptWalletSecret'])
  ipcMain.handle('core:request', async (_event, request) => {
    if (!allowed.has(request.method)) return { ok: false, error: 'Unavailable in GUI fixture' }
    try { return { ok: true, result: await vault.request(request.method, request.params || {}) } }
    catch { return { ok: false, error: 'Vault fixture failed' } }
  })
  ipcMain.handle('core:reset-session', async () => { for (const runtime of runtimes.values()) await runtime.close(); runtimes.clear(); return { ok: true } })
  for (const name of ['app:debug-log', 'app:notify', 'app:open-external']) ipcMain.handle(name, async () => ({ ok: true }))
  for (const name of ['mining:request', 'coin-sdk:request']) ipcMain.handle(name, async () => ({ ok: false, error: 'Disabled in account QA' }))
  registerPluginIpc({ ipcMain, getPluginManager: () => manager, isTrustedIpcEvent: e => e.sender === window?.webContents, shell })
  protocol.handle('altbase-coin', req => {
    const url = new URL(req.url), parts = url.pathname.slice(1).split('/')
    if (url.hostname === 'tokens') {
      localIconRequests++
      if (localIconFailures > 0) { localIconFailures--; return new Response('', { status: 503 }) }
    }
    const icon = url.hostname === 'tokens' ? manager.tokenIcon(parts[0], parts[1]) : manager.icon(parts[0])
    return icon ? new Response(fs.readFileSync(icon.file), { headers: { 'Content-Type': icon.mime } }) : new Response('', { status: 404 })
  })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }))
  window = new BrowserWindow({ width: 1280, height: 960, show: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('render-process-gone', () => errors.push('renderer-process-gone'))
  window.webContents.on('console-message', d => { if (/Uncaught|Unhandled|React error/.test(d.message || '')) errors.push('renderer-exception') })
  await window.loadFile(path.join(root, 'dist/index.html'))
  await waitFor("document.querySelector('[data-testid=modules-link]')", 'welcome')
  await evaluate("document.querySelector('[data-testid=modules-link]').click()")
  await waitFor("document.querySelectorAll('[data-module-id]').length===6", 'six account modules in full GUI')
  await capture('modules')
  const generated = await vault.request('generatePhrase', {}), password = crypto.randomBytes(16).toString('hex') + 'Qa9!'
  await evaluate("location.hash='#/restore'")
  await waitFor("document.querySelectorAll('input[autocomplete=off]').length===12", 'isolated restore')
  await evaluate(`(() => {const data=new DataTransfer();data.setData('text',${JSON.stringify(generated.phrase)});document.querySelector('input[autocomplete=off]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));return true})()`)
  generated.phrase = null
  await evaluate(`(() => {for(const input of document.querySelectorAll('input[type=password]')){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(password)});input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('input[type=checkbox]').click();return true})()`)
  await waitFor("!document.querySelector('button[type=submit]').disabled", 'restore readiness')
  await evaluate("document.querySelector('button[type=submit]').click()")
  await waitFor("location.hash==='#/app' && document.querySelectorAll('[data-testid^=token-toggle-]').length===6", 'six ordinary coin rows with token arrows')
  assert.ok(await evaluate("document.body.innerText.includes('Altbase Wallet') && !document.body.innerText.includes('FullNode')"))
  await waitFor("[...document.querySelectorAll('[data-coin-row] img')].length===6 && [...document.querySelectorAll('[data-coin-row] img')].every(img=>img.complete&&img.naturalWidth===128)", 'six real native network logos')
  assert.equal(await evaluate("document.querySelectorAll('[data-testid^=account-assets-]').length"), 0)
  assert.equal(await evaluate("document.querySelectorAll('[data-testid^=token-toggle-][aria-expanded=false]').length"), 6)
  assert.equal(iconRequests.length, 0)
  await capture('coin-rows-collapsed')
  await waitFor("document.querySelector('[data-coin-row=tron]').innerText.includes('5 TRX') && !document.querySelector('button[title=\"Refresh coin status\"]').disabled", 'verified Tron GUI balance')
  failTronBalance = true
  await evaluate("document.querySelector('button[title=\"Refresh coin status\"]').click()")
  await waitFor("document.querySelector('[data-coin-row=tron]').innerText.includes('Current balance not verified') && !document.querySelector('button[title=\"Refresh coin status\"]').disabled", 'balance read outage retains Tron network and previous amount')
  assert.ok(await evaluate("document.querySelector('[data-coin-row=tron]').innerText.includes('5 TRX')"))
  assert.equal(await evaluate("document.querySelector('[data-coin-row=tron]').innerText.toLowerCase().includes('offline')"), false)
  await capture('tron-balance-outage-keeps-network')
  failTronBalance = false
  await evaluate("document.querySelector('button[title=\"Refresh coin status\"]').click()")
  await waitFor("!document.querySelector('[data-coin-row=tron]').innerText.includes('Current balance not verified') && !document.querySelector('button[title=\"Refresh coin status\"]').disabled", 'Tron balance recovers on refresh')
  await evaluate("document.querySelector('[data-testid=token-toggle-ethereum]').click()")
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum] [data-token-id=TOKEN_PUBLIC_FIXTURE]')", 'automatic token discovery')
  assert.equal(await evaluate("document.querySelector('[data-testid=account-assets-ethereum]').innerText.includes('Unverified token')"), false)
  assert.equal(await evaluate("document.querySelector('[data-testid=account-assets-ethereum]').closest('[data-coin-row]').dataset.coinRow"), 'ethereum')
  assert.equal(await evaluate("document.querySelectorAll('[data-testid^=account-assets-]').length"), 1)
  assert.equal(await evaluate("location.hash"), '#/app')
  assert.equal(await evaluate("!!document.querySelector('[data-testid=account-assets-ethereum] [data-token-id=TOKEN_SPAM_FIXTURE]')"), false)
  assert.equal(await evaluate("document.querySelectorAll('[data-testid=token-discovery-incomplete]').length"), 0)
  await evaluate("document.querySelector('[data-testid=account-assets-ethereum]').scrollIntoView()")
  await capture('tokens-without-boilerplate')
  assert.equal(await evaluate("document.body.innerText.includes('N/A') || document.body.innerText.includes('PublicNode does not supply complete address history')"), false)
  const assetPanels = await evaluate("[...document.querySelectorAll('[id^=coin-tokens-]')].map(el=>el.id)")
  assert.equal(new Set(assetPanels).size, assetPanels.length)
  assert.equal(iconRequests.length, 0)
  const iconContract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  await input('[data-testid=account-assets-ethereum] form input', iconContract)
  await evaluate("document.querySelector('[data-testid=account-assets-ethereum] form button').click()")
  if (process.argv.includes('--retry-icons')) {
    await waitFor("document.querySelector('[data-testid=account-assets-ethereum] form input').value===''", 'token is added despite failed image download')
    await runtimes.get('ethereum').waitForIcons()
    assert.equal(iconRequests.length, 2)
    assert.equal(await evaluate("!!document.querySelector('[data-testid=account-assets-ethereum] [data-testid=token-downloaded-icon]')"), false)
    iconClockOffset = 31000
  }
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum] [data-testid=token-downloaded-icon]')?.naturalWidth>0", 'imported icon loads or recovers automatically without reimport')
  assert.equal(iconRequests.length, expectedIconRequests)
  assert.equal(localIconFailures, 0); assert.ok(localIconRequests >= 2)
  await capture('contract-import-downloads-icon')
  await input('[data-testid=account-assets-ethereum] form input', iconContract)
  await evaluate("document.querySelector('[data-testid=account-assets-ethereum] form button').click()")
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum] form input').value===''", 'reimport uses local icon cache')
  assert.equal(iconRequests.length, expectedIconRequests)
  await evaluate("document.querySelector('[data-testid=token-toggle-ethereum]').click()")
  await waitFor("!document.querySelector('[data-testid=account-assets-ethereum]')", 'collapse token rows')
  await evaluate("document.querySelector('[data-testid=token-toggle-ethereum]').focus()")
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum] [data-testid=token-downloaded-icon]')?.naturalWidth>0", 'keyboard expansion preserves imported tokens and icons')
  assert.equal(iconRequests.length, expectedIconRequests)
  window.setSize(580, 900)
  await pause(300)
  assert.ok(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"))
  await capture('tokens-expanded-narrow-window')
  window.setSize(1280, 960)
  await evaluate("document.querySelector('[data-testid=account-assets-ethereum] input[type=checkbox]').click()")
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum] [data-token-id=TOKEN_SPAM_FIXTURE]')", 'explicit hidden token display')
  await evaluate("document.querySelector('[data-testid=account-assets-ethereum] [data-token-id=TOKEN_SPAM_FIXTURE] button').click()")
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum] [data-token-id=TOKEN_SPAM_FIXTURE] a')", 'per-token spam override')
  await capture('spam-override')
  await evaluate("location.hash='#/app/send?coin=ethereum'")
  await waitFor("document.querySelector('[data-testid=account-send] input[name=to]')", 'account send form')
  await input('input[name=to]', '0x000000000000000000000000000000000000dEaD')
  await evaluate("document.querySelector('button[title=MAX]').click()")
  await waitFor("document.querySelector('[data-testid=account-transfer-preview]')", 'MAX preview')
  assert.equal(await evaluate("document.querySelector('input[name=amount]').value"), '4.999')
  assert.ok(await evaluate("document.querySelector('[data-testid=account-transfer-preview]').innerText.includes('0.001 ETH')"))
  await capture('native-max-preview')
  await evaluate("location.hash='#/app/send?coin=ethereum&asset=TOKEN_PUBLIC_FIXTURE'")
  await waitFor("document.querySelector('[data-testid=account-send] input[name=to]')?.value===''", 'token form resets preview')
  await input('input[name=to]', '0x000000000000000000000000000000000000dEaD')
  await evaluate("document.querySelector('button[title=MAX]').click()")
  await waitFor("document.querySelector('[data-testid=account-transfer-preview]')", 'token MAX preview')
  assert.equal(await evaluate("document.querySelector('input[name=amount]').value"), '12.5')
  assert.ok(await evaluate("document.querySelector('[data-testid=account-transfer-preview]').innerText.includes('0.001 ETH')"))
  await capture('token-max-native-fee')
  failReads = true
  await evaluate("location.hash='#/app'")
  await waitFor("document.querySelector('[data-testid=token-toggle-ethereum]')", 'return to dashboard')
  await evaluate("document.querySelector('[data-testid=token-toggle-ethereum]').click()")
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum]')", 'expand tokens after navigation')
  await evaluate("[...document.querySelectorAll('[data-testid=account-assets-ethereum] button')].find(b=>b.textContent==='Refresh').click()")
  await waitFor("document.querySelector('[data-testid=account-assets-ethereum]').innerText.includes('Current balance not verified')", 'failed reads retain amount with unavailable status')
  assert.ok(await evaluate("document.querySelector('[data-testid=account-assets-ethereum]').innerText.includes('12.5')"))
  await capture('unavailable-retains-amount')
  assert.equal(sendCalls, 0); assert.deepEqual(errors, [])
  const report = { at: new Date().toISOString(), passed: true, modules: 6, ordinaryCoinRows: true, collapsedByDefault: true, tokensInsideParentRow: true,
    brand: 'Altbase Wallet', nativeNetworkLogos: 6, noGenericUnverifiedBadge: true,
    independentExpansion: true, keyboardExpansion: true, importedTokensSurviveCollapse: true, narrowWindowNoHorizontalOverflow: true, automaticFixtureDiscovery: true,
    noPermanentDiscoveryWarning: true, noHistoryBoilerplate: true, noNaLabel: true, spamHiddenByDefault: true, explicitSpamOverride: true, nativeMax: '4.999 ETH', tokenMax: '12.5 UNIT', feeNative: '0.001 ETH',
    failurePreservesAmount: true, tronBalanceOutageKeepsVerifiedNetwork: true, tronBalanceOutageKeepsPreviousAmount: true, tronBalanceRecovery: true, compiledAccountLibraries: 6, iconRequestsBeforeImport: 0, iconRequestsAfterTwoImports: iconRequests.length, importedIconRendered: true, localIconProtocolRecovery: true, importedIconNetworkRecovery: process.argv.includes('--retry-icons'), localIconRequests, liveIcons: process.argv.includes('--live-icons'),
    confirmationsClicked: 0, signedTransactions: 0, broadcasts: 0, sendCalls, operations }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ...report, evidence: path.relative(root, run) }))
  clearTimeout(watchdog); manager.closeSessions(); stopAllNativeCoreChildren(); window.destroy(); app.exit(0)
}).catch(async () => {
  let publicTronRow
  if (stage.includes('Tron') || stage.includes('balance read outage')) {
    try { publicTronRow = await evaluate("document.querySelector('[data-coin-row=tron]')?.innerText"); await capture('failure-tron') } catch { /* A closed renderer cannot be inspected. */ }
  }
  fs.writeFileSync(path.join(run, 'failure.json'), JSON.stringify({ passed: false, stage, sendCalls, errors, publicTronRow }) + '\n')
  console.error(JSON.stringify({ passed: false, stage, sendCalls, evidence: path.relative(root, run) }))
  clearTimeout(watchdog); manager?.closeSessions(); stopAllNativeCoreChildren(); app.exit(1)
})
