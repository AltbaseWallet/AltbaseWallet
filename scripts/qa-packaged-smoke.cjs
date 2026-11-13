'use strict'
// Launch the actual packaged application with a new, empty profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const WebSocket = require('ws')
const root = path.resolve(__dirname, '..'), run = process.env.ALTBASE_QA_RUN_DIRECTORY || path.join(root, 'local-checks', 'packaged-' + Date.now())
const binary = path.join(process.env.ALTBASE_QA_LINUX_DIRECTORY || path.join(root, 'artifacts/linux-unpacked'), 'altcoinwallet')
fs.mkdirSync(run, { recursive: true })
const profile = path.join(run, 'config/Altbase Profiles/qa')
const log = fs.openSync(path.join(run, 'launch.log'), 'w')
const child = spawn(binary, ['--remote-debugging-port=0', '--altbase-profile=qa', '--host-resolver-rules=MAP * ~NOTFOUND'], {
  cwd: root, env: { ...process.env, XDG_CONFIG_HOME: path.join(run, 'config') }, stdio: ['ignore', log, log],
})
fs.closeSync(log)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, sequence = 0, stage = 'launch', exited = false
child.on('exit', () => { exited = true })
child.on('error', () => { exited = true })
const pending = new Map()
async function waitFor(check, label, timeout = 30000) {
  stage = label
  const deadline = Date.now() + timeout
  while (Date.now() < deadline && !exited) { const result = await check(); if (result) return result; await pause(150) }
  throw Error(`Packaged application check failed: ${label}`)
}
function cdp(method, params = {}, timeoutMs = process.argv.includes('--account-icons') ? 90000 : 10000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression, timeoutMs) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
  if (response.exceptionDetails) throw Error('Packaged renderer evaluation failed: ' + (response.exceptionDetails.exception?.description || response.exceptionDetails.text))
  return response.result.value
}
async function rendererSandbox(port, browserPath) {
  const processes = await new Promise((resolve, reject) => {
    const browser = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`)
    const timer = setTimeout(() => { browser.terminate(); reject(Error('Sandbox inspection timeout')) }, 10000)
    const finish = (error, result) => { clearTimeout(timer); browser.close(); if (error) reject(error); else resolve(result) }
    browser.once('error', error => finish(error))
    browser.once('open', () => browser.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' })))
    browser.on('message', bytes => {
      const response = JSON.parse(bytes.toString())
      if (response.id === 1) finish(response.error ? Error('Sandbox process inspection failed') : null, response.result?.processInfo)
    })
  })
  const renderers = processes.filter(row => row.type === 'renderer')
  assert.ok(renderers.length > 0)
  const records = renderers.map(row => {
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0)
    const status = fs.readFileSync(`/proc/${row.id}/status`, 'utf8')
    const seccomp = Number(status.match(/^Seccomp:\s+(\d+)/m)?.[1])
    const noNewPrivs = Number(status.match(/^NoNewPrivs:\s+(\d+)/m)?.[1])
    assert.equal(seccomp, 2, 'Renderer must have kernel seccomp filtering')
    assert.equal(noNewPrivs, 1, 'Renderer must prohibit new privileges')
    return { seccomp, noNewPrivs }
  })
  return { inspectedRenderers: records.length, records }
}
async function main() {
  const activePort = path.join(profile, 'DevToolsActivePort')
  await waitFor(() => fs.existsSync(activePort), 'debug endpoint')
  const port = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0])
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return pages.find(item => item.type === 'page' && item.webSocketDebuggerUrl)
  }, 'main window')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.on('message', data => {
    const message = JSON.parse(data.toString()), task = pending.get(message.id)
    if (!task) return
    clearTimeout(task.timer); pending.delete(message.id)
    if (message.error) task.reject(Error('CDP command failed')); else task.resolve(message.result)
  })
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  await cdp('Network.enable')
  await cdp('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] })
  if (process.argv.includes('--existing-profile')) {
    await waitFor(() => evaluate("Boolean(document.querySelector('input[type=password]'))"), 'released profile login')
    const check = await evaluate(`(async()=>{
      const meta=JSON.parse(localStorage.getItem('altbase_wallet:wallet-meta'));
      if(!meta?.isCreated) return {visible:false};
      const password=${JSON.stringify(process.env.ALTBASE_QA_PROFILE_PASSWORD)};
      const verified=await window.altbaseWallet.core({method:'verifyWalletPassword',params:{password,verifyHash:meta.verifyHash,verifySalt:meta.verifySalt}});
      const decrypted=await window.altbaseWallet.core({method:'decryptWalletSecret',params:{password,...meta.encryptedMnemonic}});
      if(!decrypted.ok) return {visible:true,passwordAccepted:false};
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(decrypted.result.phrase)))].map(v=>v.toString(16).padStart(2,'0')).join('');
      decrypted.result.phrase=null;
      return {visible:true,passwordAccepted:verified.result?.isValid==='true',samePhrase:digest===${JSON.stringify(process.env.ALTBASE_QA_PHRASE_DIGEST)}};
    })()`)
    assert.equal(check.visible, true); assert.equal(check.passwordAccepted, true); assert.equal(check.samePhrase, true)
    const sandbox = await rendererSandbox(port, fs.readFileSync(activePort, 'utf8').split('\n')[1].trim())
    const result = { at: new Date().toISOString(), passed: true, existingReleasedProfileVisible: true,
      passwordAccepted: true, sameRecoveryPhraseWithoutRestore: true, sandbox, isolatedProfile: true,
      realTransfers: 0, evidence: path.relative(root, run) }
    fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result)); return
  }
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=modules-link]'))"), 'packaged welcome')
  const catalog = await evaluate('window.altbaseWallet.plugins.catalog()')
  assert.equal(catalog.ok, true); assert.equal(catalog.result.modules.length, 39)
  assert.equal(catalog.result.directory, path.join(run, 'config/Altbase/modules'))
  assert.ok(fs.readdirSync(catalog.result.directory).includes('bitcoin'))
  assert.ok(fs.readdirSync(catalog.result.directory).includes('ethereum'))
  let verifiedBinaryModules = 0
  for (const descriptor of catalog.result.modules) {
    const directory = path.join(catalog.result.directory, descriptor.id)
    const definition = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')))
    assert.ok(definition.nativeRuntime.binaries.length > 0, descriptor.id)
    for (const file of definition.nativeRuntime.binaries) require('./runtime-platform.cjs').requireBinary(path.join(directory, file), 'linux-x64')
    verifiedBinaryModules++
  }
  const native = await evaluate("window.altbaseWallet.core({method:'listWalletModules',params:{}})")
  assert.equal(native.ok, true)
  let nativeMappingsVerified = false
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const command = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0')[0]
      if (command !== path.join(catalog.result.directory, '_core/altbase_core_bridge')) continue
      const maps = fs.readFileSync(`/proc/${entry}/maps`, 'utf8')
      assert.ok(maps.includes(catalog.result.directory + '/bitcoincashii/altbase_bitcoincashii_wallet.so'))
      assert.ok(!maps.includes('/resources/native-core/'))
      nativeMappingsVerified = true
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error }
  }
  assert.equal(nativeMappingsVerified, true)
  const wasm = await evaluate("(async()=>{const response=await fetch('altbase-coin://runtime/kaspa/kaspa_bg.wasm');return {ok:response.ok,header:Array.from(new Uint8Array(await response.arrayBuffer()).slice(0,4))}})()")
  assert.equal(wasm.ok, true); assert.deepEqual(wasm.header, [0, 97, 115, 109])
  const compiledAccount = await evaluate("window.altbaseWallet.plugins.request({coin:'tron',method:'validate',params:{address:'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'}})")
  assert.equal(compiledAccount.ok, true); assert.equal(compiledAccount.result, true)
  let liveTron
  if (process.argv.includes('--live-tron')) {
    const at = Date.now()
    const response = await evaluate("window.altbaseWallet.plugins.request({coin:'tron',method:'snapshot',params:{addresses:['T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'],includeHistory:false}})", 60000)
    assert.equal(response.ok, true); assert.equal(response.result.network.ok, true)
    assert.ok(response.result.balances['T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'])
    liveTron = { at: new Date().toISOString(), height: response.result.network.blocks, publicSystemAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', balanceAtomic: response.result.balances['T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'].balance, elapsedMs: Date.now() - at }
  }
  let modulesFolderOpened = false
  if (process.argv.includes('--open-modules-folder')) {
    const opened = await evaluate('window.altbaseWallet.plugins.openDirectory()', 30000)
    assert.equal(opened.ok, true)
    assert.equal(opened.directory, catalog.result.directory)
    modulesFolderOpened = true
  }
  const health = await evaluate("window.altbaseWallet.core({method:'health',params:{}})")
  assert.equal(health.ok, true)
  assert.equal(health.result.service, 'altbase-vault')
  const sourceVault = await evaluate(`(async()=>{
    const call=async(method,params={})=>{const r=await window.altbaseWallet.core({method,params});if(!r.ok)throw Error('Offline native vault check failed');return r.result};
    const generated=await call('generatePhrase'), password=crypto.randomUUID()+'Offline9!';
    const checked=await call('validatePhrase',{phrase:generated.phrase});
    const sealed=await call('createWalletSecret',{phrase:generated.phrase,password});
    const verified=await call('verifyWalletPassword',{...sealed,password});
    const rejected=await call('verifyWalletPassword',{...sealed,password:password+'wrong'});
    const restored=await call('decryptWalletSecret',{...sealed,password});
    const match=restored.phrase===generated.phrase;
    const scopes=[];for(const coin of ['zano','epic']){const result=await call('privacyScope',{coin,phrase:generated.phrase});scopes.push(['scope','enginePassword','payload'].every(key=>typeof result[key]==='string'&&result[key].length>0));}
    generated.phrase=null;restored.phrase=null;
    return {generatedAndValidated:checked.isValid==='true',passwordAccepted:verified.isValid==='true',wrongPasswordRejected:rejected.isValid==='false',roundTrip:match,privacyScopes:scopes.every(Boolean)};
  })()`)
  assert.ok(Object.values(sourceVault).every(value => value === true))
  let sourceVaultMapped = false
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const command = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0')[0]
      if (command !== path.join(catalog.result.directory, '_core/altbase_vault_bridge')) continue
      const maps = fs.readFileSync(`/proc/${entry}/maps`, 'utf8')
      sourceVaultMapped = maps.includes(catalog.result.directory + '/_core/libaltbase_wallet_vault.so')
    } catch (error) { if (!['ENOENT','EACCES'].includes(error.code)) throw error }
  }
  assert.equal(sourceVaultMapped, true)
  const sandbox = await rendererSandbox(port, fs.readFileSync(activePort, 'utf8').split('\n')[1].trim())
  fs.mkdirSync(catalog.result.directory, { recursive: true })
  fs.copyFileSync(path.join(root, 'local-checks/fixtures/linux-x64/fixture-native.so'), path.join(catalog.result.directory, 'smoke-fixture.so'))
  await evaluate("document.querySelector('[data-testid=modules-link]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=modules-refresh]'))"), 'module page')
  await evaluate("document.querySelector('[data-testid=modules-refresh]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('[data-module-id]').length===36"), 'packaged native discovery')
  const snapshot = await evaluate("window.altbaseWallet.plugins.request({coin:'fixture-native',method:'snapshot',params:{addresses:['ALTBASE_FIXTURE_ADDRESS']}})")
  assert.equal(snapshot.ok, true); assert.equal(snapshot.result.walletBalance.balance, '425000000')
  await evaluate("document.querySelectorAll('[data-module-id] img').forEach(img=>{img.loading='eager'})")
  await waitFor(() => evaluate("[...document.querySelectorAll('[data-module-id] img')].every(img=>img.complete&&img.naturalWidth>0)"), 'packaged icons')
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(run, 'modules.png'), Buffer.from(screenshot.data, 'base64'))
  const mining = await require('./qa-mining-install.cjs')(evaluate)
  const accountIcons = process.argv.includes('--account-icons') ? await require('./qa-account-icon-flow.cjs')(evaluate) : undefined
  const result = { at: new Date().toISOString(), passed: true, packagedMain: true, isolatedProfile: true,
    normalSandboxedLaunch: true, sandbox, modulesFolderOpened, commonModulesDirectory: true, compatibilityModules: 33, listedCompatibilityModules: 29, delisted: ['hypercoin', 'mydogecoin', 'nonsense', 'btgs'],
    accountModules: 6, verifiedBinaryModules, nativeMappingsVerified, moduleWasmLoaded: true, compiledAccountLibraryLoaded: true, liveTron, installedFixtureDiscovered: true, packagedNativeHostLoaded: true, mining,
    accountIcons, iconsLoaded: true, vaultHealth: true, sourceVault, sourceVaultMapped, realTransactions: 0, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
main().catch(error => {
  const result = { passed: false, stage, errorType: error.name, error: error.message, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'failure.json'), JSON.stringify(result) + '\n'); console.error(JSON.stringify(result)); process.exitCode = 1
}).finally(async () => {
  socket?.close(); child.kill('SIGTERM')
  await pause(500); if (!exited) child.kill('SIGKILL')
})
