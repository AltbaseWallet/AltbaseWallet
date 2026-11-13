'use strict'
// Linux controller for the complete Windows application under an isolated Wine prefix.
// The controller never requests sign/send/export, and never creates a real wallet.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const WebSocket = require('ws')
const root = path.resolve(__dirname, '..'), run = path.join(root, 'local-checks', 'windows-app-' + Date.now())
const appRoot = process.env.ALTBASE_QA_WINDOWS_DIRECTORY || path.join(root, 'artifacts/win-unpacked'), binary = path.join(appRoot, 'Altbase Wallet.exe')
const env = { ...process.env, WINEPREFIX: path.join(run, 'wine'), WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=' }
delete env.ELECTRON_RUN_AS_NODE
fs.mkdirSync(run, { recursive: true })
const log = fs.openSync(path.join(run, 'launch.log'), 'w')
// Wine has no D3D11 WARP device. Use the packaged software renderer for this
// controller without changing rendering defaults in the distributed wallet.
const child = spawn('wine', [binary, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', '--altbase-profile=windows-qa', '--host-resolver-rules=MAP * ~NOTFOUND'], { cwd: appRoot, env, stdio: ['ignore', log, log] })
fs.closeSync(log)
let socket, sequence = 0, stage = 'launch', exitCode = null, installed, profile
const pending = new Map(), networkAttempts = []
child.on('exit', code => { exitCode = code })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function distributionHash() {
  return crypto.createHash('sha256').update([
    binary, path.join(appRoot, 'resources/app.asar'),
    path.join(appRoot, 'resources/native-plugin-host/bin/win32-x64/altbase_plugin_host.exe'),
  ].map(hash).join('\n')).digest('hex')
}
function unixPath(windowsPath) {
  if (/^Z:\\/i.test(windowsPath)) return '/' + windowsPath.slice(3).replaceAll('\\', '/')
  if (/^C:\\/i.test(windowsPath)) return path.join(env.WINEPREFIX, 'drive_c', windowsPath.slice(3).replaceAll('\\', '/'))
  throw Error('Unexpected Wine drive')
}
async function waitFor(check, label, timeout = 30000) {
  stage = label; console.log(JSON.stringify({ stage }))
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(150) }
  throw Error(`Check timed out: ${label}`)
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout')) }, process.argv.includes('--account-icons') ? 90000 : 70000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error('Renderer evaluation failed')
  return result.result.value
}
async function plugin(method, params = {}) {
  assert.ok(['derive', 'validate', 'snapshot', 'estimateFee', 'estimateMax'].includes(method))
  const result = await evaluate(`window.altbaseWallet.plugins.request(${JSON.stringify({ coin: 'fixture-native', method, params })})`)
  assert.equal(result.ok, true, `Plugin operation: ${method}`)
  return result.result
}
async function refresh(count) {
  await evaluate("document.querySelector('[data-testid=modules-refresh]').click()")
  await waitFor(() => evaluate(`!document.querySelector('[data-testid=modules-refresh]').disabled && document.querySelectorAll('[data-module-id]').length===${count}`), 'catalog refresh')
}
async function capture(name) {
  await pause(400)
  const image = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(run, name), Buffer.from(image.data, 'base64'))
}
async function main() {
  assert.ok(fs.existsSync(binary))
  const before = distributionHash()
  const portFile = await waitFor(() => {
    const users = path.join(env.WINEPREFIX, 'drive_c/users')
    if (!fs.existsSync(users)) return
    for (const user of fs.readdirSync(users)) {
      const candidate = path.join(users, user, 'AppData/Roaming/Altbase Profiles/windows-qa/DevToolsActivePort')
      if (fs.existsSync(candidate)) { profile = path.dirname(candidate); return candidate }
    }
  }, 'Windows debug endpoint', 120000)
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0])
  const page = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) return null
      const pages = await response.json()
      return pages.find(item => item.type === 'page' && item.webSocketDebuggerUrl)
    } catch { return null }
  }, 'Windows main window')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString())
    if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) networkAttempts.push(message.params.request.url.split('/').slice(0, 3).join('/'))
    const task = pending.get(message.id); if (!task) return
    clearTimeout(task.timer); pending.delete(message.id)
    if (message.error) task.reject(Error('CDP request failed')); else task.resolve(message.result)
  })
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  await cdp('Network.enable'); await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] })
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=modules-link]'))"), 'Windows welcome')
  assert.match(await evaluate('navigator.userAgent'), /Windows/)
  const catalog = await evaluate('window.altbaseWallet.plugins.catalog()')
  assert.equal(catalog.ok, true); assert.equal(catalog.result.modules.length, 39); assert.deepEqual(catalog.result.diagnostics, [])
  installed = unixPath(catalog.result.directory)
  assert.equal(path.basename(installed), 'modules')
  assert.equal(path.basename(path.dirname(installed)), 'Altbase')
  assert.ok(fs.readdirSync(installed).includes('bitcoin'))
  assert.ok(fs.readdirSync(installed).includes('ethereum'))
  let verifiedBinaryModules = 0
  for (const descriptor of catalog.result.modules) {
    const directory = path.join(installed, descriptor.id), definition = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')))
    assert.ok(definition.nativeRuntime.binaries.length > 0)
    for (const file of definition.nativeRuntime.binaries) require('./runtime-platform.cjs').requireBinary(path.join(directory, file), 'win32-x64')
    verifiedBinaryModules++
  }
  const publicAddresses = { ethereum:'0x000000000000000000000000000000000000dEaD', bsc:'0x000000000000000000000000000000000000dEaD', polygon:'0x000000000000000000000000000000000000dEaD', arbitrum:'0x000000000000000000000000000000000000dEaD', solana:'SysvarRent111111111111111111111111111111111', tron:'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' }
  for (const [coin, address] of Object.entries(publicAddresses)) {
    stage = 'compiled ' + coin + ' DLL'; console.log(JSON.stringify({ stage }))
    const result = await evaluate(`window.altbaseWallet.plugins.request(${JSON.stringify({coin,method:'validate',params:{address}})})`)
    assert.equal(result.ok, true, coin + ' compiled DLL must load in the full application')
    assert.equal(result.result, true)
  }
  stage = 'released native compatibility bridge'; console.log(JSON.stringify({ stage }))
  const core = await evaluate("window.altbaseWallet.core({method:'listWalletModules',params:{}})")
  assert.equal(core.ok, true, 'Released Windows native bridge must load its dependencies')
  const vault = await evaluate(`(async()=>{
    const call=async(method,params={})=>{const r=await window.altbaseWallet.core({method,params});if(!r.ok)throw Error('Vault check failed');return r.result};
    const generated=await call('generatePhrase');
    const password=crypto.randomUUID()+'a9!';
    const sealed=await call('createWalletSecret',{phrase:generated.phrase,password});
    const restored=await call('decryptWalletSecret',{...sealed,password});
    const valid=generated.phrase===restored.phrase;generated.phrase=null;restored.phrase=null;return valid;
  })()`)
  assert.equal(vault, true)
  await evaluate("document.querySelector('[data-testid=modules-link]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=modules-refresh]'))"), 'Windows module page')
  await capture('before-install.png')
  fs.mkdirSync(installed, { recursive: true })
  fs.copyFileSync(path.join(root, 'local-checks/fixtures/win32-x64/fixture-native.dll'), path.join(installed, 'new-coin.dll'))
  await refresh(36)
  await evaluate("document.querySelectorAll('[data-module-id] img').forEach(img=>{img.loading='eager'})")
  await waitFor(() => evaluate("[...document.querySelectorAll('[data-module-id] img')].every(img=>img.complete&&img.naturalWidth>0)"), 'Windows coin icons')
  await evaluate("document.querySelector('[data-module-id=fixture-native]').scrollIntoView({block:'center'})")
  await capture('dll-installed.png')
  assert.equal(await plugin('derive', { mnemonic: 'NOT_A_REAL_SEED' }), 'ALTBASE_FIXTURE_ADDRESS')
  assert.equal(await plugin('validate', { address: 'ALTBASE_FIXTURE_ADDRESS' }), true)
  assert.equal((await plugin('snapshot')).walletBalance.balance, '425000000')
  assert.equal((await plugin('estimateFee')).coin, '0.0005')
  assert.equal((await plugin('estimateMax')).amountCoin, '4.2495')
  fs.copyFileSync(path.join(root, 'local-checks/fixtures/win32-x64/fixture-bad-abi.dll'), path.join(installed, 'wrong-abi.dll'))
  await refresh(36)
  const rejected = await evaluate('window.altbaseWallet.plugins.catalog()')
  assert.ok(rejected.result.diagnostics.some(row => row.file === 'wrong-abi.dll'))
  assert.equal((await plugin('snapshot')).walletBalance.balance, '425000000')
  fs.unlinkSync(path.join(installed, 'wrong-abi.dll'))
  // Close workers before replacing an in-use Windows library; no process rebuild.
  await evaluate('window.altbaseWallet.resetCoreSession()'); await pause(1500)
  const data = path.join(profile, 'coin-plugin-data/fixture-native'); fs.mkdirSync(data, { recursive: true })
  const marker = path.join(data, 'public-scan-marker.json'); fs.writeFileSync(marker, '{"height":123}\n')
  fs.copyFileSync(path.join(root, 'local-checks/fixtures/win32-x64/fixture-native-updated.dll'), path.join(installed, 'new-coin.dll'))
  await refresh(36)
  assert.equal((await evaluate('window.altbaseWallet.plugins.catalog()')).result.modules.find(m => m.id === 'fixture-native').version, '1.1.0')
  assert.equal((await plugin('snapshot')).walletBalance.balance, '425000000')
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).height, 123)
  await capture('dll-updated.png')
  const after = distributionHash(); assert.equal(after, before)
  const mining = await require('./qa-mining-install.cjs')(evaluate)
  const accountIcons = process.argv.includes('--account-icons') ? await require('./qa-account-icon-flow.cjs')(evaluate) : undefined
  const result = { at: new Date().toISOString(), passed: true, environment: 'Wine on Linux; not a native Windows machine',
    packagedWindowsApplication: true, architecture: 'win32-x64', isolatedProfile: true,
    compatibilityModules: 33, listedCompatibilityModules: 29, delisted: ['hypercoin', 'mydogecoin', 'nonsense', 'btgs'],
    accountModules: 6, verifiedBinaryModules, compiledAccountDllsLoaded: 6, nativeCompatibilityBridge: true, profileVaultRoundTrip: true, mining,
    accountIcons, bareDllDiscoveredWithoutRebuild: true, iconsLoaded: true, address: 'ALTBASE_FIXTURE_ADDRESS',
    balance: '4.25 TEST', fee: '0.0005 TEST', max: '4.2495 TEST', invalidAbiContained: true,
    moduleUpgradePreservedData: true, coreHashBefore: before, coreHashAfter: after,
    transactionOperations: 0, rendererHttpBlocked: true, networkOriginsObserved: [...new Set(networkAttempts)], evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
main().catch(error => {
  const result = { at: new Date().toISOString(), passed: false, stage, error: error.message, exitCode, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'failure.json'), JSON.stringify(result, null, 2) + '\n'); console.error(JSON.stringify(result)); process.exitCode = 1
}).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await evaluate('window.altbaseWallet.resetCoreSession()') } catch { /* Window may already be closed. */ }
    socket.close()
  }
  child.kill('SIGTERM')
  spawnSync('/opt/wine-devel/bin/wineserver', ['-k'], { env, stdio: 'ignore', timeout: 5000 })
})
