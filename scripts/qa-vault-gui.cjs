'use strict'
// Drive real application pages/buttons. Never call the cryptographic IPC APIs
// directly. Test phrases stay in renderer memory; seed screens are not saved.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process'), WebSocket = require('ws')
const root = path.resolve(__dirname, '..'), windows = process.argv.includes('--windows')
const run = process.env.ALTBASE_QA_RUN_DIRECTORY || path.join(root, 'local-checks/vault-source-2026-11-11', (windows ? 'windows-gui-' : 'linux-gui-') + Date.now())
const appRoot = process.env.ALTBASE_QA_APP_DIRECTORY || path.join(root, 'artifacts/v0.1.12-vault-fix', windows ? 'win-unpacked' : 'linux-unpacked')
fs.mkdirSync(run, { recursive: true, mode: 0o700 })
const env = { ...process.env, XDG_CONFIG_HOME: path.join(run, 'config'), WINEPREFIX: path.join(run, 'wine'), WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=;winemenubuilder.exe=d' }
delete env.ELECTRON_RUN_AS_NODE
const binary = path.join(appRoot, windows ? 'Altbase Wallet.exe' : 'altcoinwallet')
const args = ['--altbase-profile=vault-gui', '--remote-debugging-port=0', '--host-resolver-rules=MAP * ~NOTFOUND']
if (windows) args.unshift(binary, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader')
const log = fs.openSync(path.join(run, 'launch.log'), 'w')
const child = spawn(windows ? 'wine' : binary, args, { cwd: appRoot, env, stdio: ['ignore', log, log] }); fs.closeSync(log)
let socket, sequence = 0, stage = 'launch', exited = false
const pending = new Map(), checks = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms))
child.on('exit', () => { exited = true }); child.on('error', () => { exited = true })
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('UI command timed out')) }, 60000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error('UI action failed')
  return result.result.value
}
async function wait(check, name, timeout = 60000) {
  stage = name; console.log(JSON.stringify({ stage }))
  const deadline = Date.now() + timeout
  while (!exited && Date.now() < deadline) { const value = await check(); if (value) return value; await pause(150) }
  throw Error('GUI check failed: ' + name)
}
const until = (expression, name, timeout) => wait(() => evaluate(`Boolean(${expression})`), name, timeout)
const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function button(text) {
  await wait(() => evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled))`), 'button ready: ' + text, 15000)
  return evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Button unavailable');e.click();return true})()`)
}
async function capture(name) {
  assert.ok(await evaluate("!['#/generate-seed','#/confirm-seed','#/app/settings/seed','#/restore'].includes(location.hash)"), 'No screenshot may expose test phrase words')
  const shot = await command('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(run, name + '.png'), Buffer.from(shot.data, 'base64'))
}
function unixPath(value) {
  if (/^Z:\\/i.test(value)) return '/' + value.slice(3).replaceAll('\\', '/')
  if (/^C:\\/i.test(value)) return path.join(env.WINEPREFIX, 'drive_c', value.slice(3).replaceAll('\\', '/'))
  return value
}
function portFile() {
  if (!windows) return path.join(run, 'config/Altbase Profiles/vault-gui/DevToolsActivePort')
  const users = path.join(env.WINEPREFIX, 'drive_c/users')
  if (fs.existsSync(users)) for (const name of fs.readdirSync(users)) {
    const candidate = path.join(users, name, 'AppData/Roaming/Altbase Profiles/vault-gui/DevToolsActivePort')
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}
async function lock() { await button('Lock wallet'); await until("document.querySelectorAll('input[type=password]').length===1", 'wallet locked in GUI') }
async function unlock(password, accept) {
  await input('input[type=password]', password)
  await evaluate("[...document.querySelectorAll('form button')].find(b=>b.type==='submit').click()")
  if (accept) await until("location.hash==='#/app'", 'correct password unlocks in GUI')
  else {
    await until("document.body.innerText.includes('Wrong password')", 'wrong password rejected in GUI')
    assert.notEqual(await evaluate('location.hash'), '#/app')
  }
}
async function main() {
  const port = await wait(() => { const file = portFile(); return file && fs.existsSync(file) && Number(fs.readFileSync(file, 'utf8').split('\n')[0]) }, 'visible application starts', windows ? 150000 : 60000)
  const page = await wait(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page') } catch { return null }
  }, 'application window')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.on('message', bytes => {
    const result = JSON.parse(bytes.toString()), task = pending.get(result.id)
    if (!task) return
    clearTimeout(task.timer); pending.delete(result.id)
    if (result.error) task.reject(Error('UI command failed')); else task.resolve(result.result)
  })
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  await command('Network.enable'); await command('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] })
  await until("document.querySelector('[data-testid=modules-link]')", 'welcome page')
  await capture('01-welcome')
  // Only coin reads use an offline fixture. The real native vault, its source
  // binary and every wallet page remain those shipped in this application.
  const catalog = await evaluate('window.altbaseWallet.plugins.catalog()')
  assert.equal(catalog.ok, true)
  const modules = unixPath(catalog.result.directory)
  assert.ok(modules.startsWith(run + path.sep), 'GUI fixtures may only modify their own isolated module tree')
  for (const descriptor of catalog.result.modules) fs.unlinkSync(path.join(modules, descriptor.id, 'manifest.json'))
  const target = windows ? 'win32-x64' : 'linux-x64', suffix = windows ? '.dll' : '.so'
  fs.copyFileSync(path.join(root, 'local-checks/fixtures', target, 'fixture-native' + suffix), path.join(modules, 'vault-offline-coin' + suffix))
  await click('[data-testid=modules-link]'); await until("document.querySelector('[data-testid=modules-refresh]')", 'coin module page')
  await click('[data-testid=modules-refresh]'); await until("document.querySelectorAll('[data-module-id]').length===1", 'offline coin fixture selected through GUI')
  await evaluate("document.querySelector('a[href=\"#/\"]').click()")
  await until("document.querySelector('a[href=\"#/create-password\"]')", 'create wallet entry')
  await click('a[href="#/create-password"]')
  const password = crypto.randomBytes(16).toString('hex') + 'A9!', changed = crypto.randomBytes(16).toString('hex') + 'B8!'
  await until("document.querySelectorAll('input[type=password]').length===2", 'password creation page')
  await input('input[autocomplete=new-password]', password)
  await evaluate(`(()=>{const e=document.querySelectorAll('input[type=password]')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(password)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await click('form button[type=submit]')
  await until("location.hash==='#/generate-seed' && document.querySelectorAll('span.font-medium.text-slate-100').length===12", 'GUI generated twelve native phrase words')
  await evaluate("window.__vaultQaWords=[...document.querySelectorAll('span.font-medium.text-slate-100')].map(e=>e.textContent)")
  await evaluate("document.querySelectorAll('input[type=checkbox]').forEach(e=>{if(!e.checked)e.click()})")
  await button('Continue')
  await until("location.hash==='#/confirm-seed' && document.querySelectorAll('input').length===3", 'phrase confirmation page')
  await evaluate("document.querySelectorAll('input').forEach(e=>{const n=Number(e.closest('label').querySelector('span').textContent.match(/\\d+/)[0]);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,window.__vaultQaWords[n-1]);e.dispatchEvent(new Event('input',{bubbles:true}))})")
  await evaluate("[...document.querySelectorAll('button')].find(b=>!b.disabled && !/back/i.test(b.textContent)).click()")
  await until("location.hash==='#/app' && document.querySelector('[data-coin-row]')", 'new wallet reaches dashboard')
  checks.push('GUI generation, acknowledgement, confirmation and encrypted profile creation')
  await capture('02-created-dashboard')
  await lock(); await unlock(password + 'wrong', false); await capture('03-wrong-password')
  await unlock(password, true); checks.push('GUI rejects wrong password and decrypts with correct password after lock')
  await evaluate("location.hash='#/app/settings/security'")
  await until("document.querySelectorAll('input[type=password]').length===3", 'security settings')
  for (const [i, value] of [password, changed, changed].entries()) await evaluate(`(()=>{const e=document.querySelectorAll('input[type=password]')[${i}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  await button('Change password'); await until("document.body.innerText.includes('Password changed')", 'password changed through settings')
  await capture('04-password-changed')
  await lock(); await unlock(password, false); await unlock(changed, true)
  checks.push('GUI password change rejects the old password and accepts the new one')
  await evaluate("location.hash='#/app/settings/seed'")
  await until("document.querySelector('input[type=password]')", 'seed reveal password form')
  await input('input[type=password]', changed)
  await evaluate("[...document.querySelectorAll('button')].find(b=>/show.*phrase|show.*seed/i.test(b.textContent)).click()")
  await until("document.querySelectorAll('span.font-medium.text-slate-100').length===12", 'seed displayed after GUI password check')
  assert.equal(await evaluate("[...document.querySelectorAll('span.font-medium.text-slate-100')].map(e=>e.textContent).join(' ')===window.__vaultQaWords.join(' ')"), true)
  checks.push('GUI seed reveal decrypts the same phrase; no phrase screenshot saved')
  await lock(); await click('a[href="#/restore"]')
  await until("document.querySelectorAll('input[autocomplete=off]').length===12", 'restore page')
  const restorePassword = crypto.randomBytes(16).toString('hex') + 'C7!'
  await evaluate(`document.querySelectorAll('input[type=password]').forEach(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(restorePassword)});e.dispatchEvent(new Event('input',{bubbles:true}))})`)
  await evaluate("(()=>{document.querySelectorAll('input[type=checkbox]').forEach(e=>{if(!e.checked)e.click()});const data=new DataTransfer();data.setData('text',Array(12).fill('abandon').join(' '));document.querySelector('input[autocomplete=off]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));return true})()")
  await click('form button[type=submit]'); await pause(500)
  assert.equal(await evaluate('location.hash'), '#/restore')
  await evaluate("(()=>{const data=new DataTransfer();data.setData('text',window.__vaultQaWords.join(' '));document.querySelector('input[autocomplete=off]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));return true})()")
  await click('form button[type=submit]'); await until("location.hash==='#/app'", 'GUI restores the generated phrase')
  await lock(); await unlock(restorePassword, true)
  await capture('05-restored-and-unlocked')
  checks.push('GUI rejects invalid restore input, restores valid phrase, locks and unlocks restored profile')
  const library = path.join(modules, '_core', windows ? 'altbase_wallet_vault.dll' : 'libaltbase_wallet_vault.so')
  const receipt = JSON.parse(fs.readFileSync(path.join(modules, '_core/vault-build.json')))
  const expected = receipt.binaries.find(entry => entry.name === path.basename(library))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(library)).digest('hex'), expected.sha256)
  let mapped = false
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try { if (fs.readFileSync(`/proc/${pid}/maps`, 'utf8').includes(library)) mapped = true } catch { /* Exited/inaccessible unrelated process. */ }
  }
  assert.equal(mapped, true, 'The source-built vault must be mapped by the real application')
  await evaluate('window.__vaultQaWords=null')
  const result = { at: new Date().toISOString(), passed: true, platform: target, environment: windows ? 'Windows application under Wine on Linux' : 'Linux application with normal sandbox',
    actualPackagedApplication: true, actionsThroughGui: true, directCryptoIpcCalls: 0, checks, sourceBuiltLibraryMapped: mapped,
    sourceBuiltLibrarySha256: expected.sha256, realUserProfilesOpened: 0, realTransfers: 0, seedScreenshots: 0, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result))
}
main().catch(async () => {
  // Keep failures diagnosable without recording phrase inputs or seed screens.
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      const ui = await evaluate("({route:location.hash,title:document.title,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),passwordFields:document.querySelectorAll('input[type=password]').length,moduleLink:Boolean(document.querySelector('[data-testid=modules-link]'))})")
      fs.writeFileSync(path.join(run, 'failure-ui.json'), JSON.stringify(ui, null, 2) + '\n')
    } catch { /* Preserve the original failure without exposing raw UI text. */ }
  }
  const result = { passed: false, stage, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'failure.json'), JSON.stringify(result) + '\n'); console.error(JSON.stringify(result)); process.exitCode = 1
}).finally(async () => {
  socket?.close(); child.kill('SIGTERM'); await pause(1000); if (!exited) child.kill('SIGKILL')
  if (windows) spawnSync('/opt/wine-devel/bin/wineserver', ['-k'], { env, stdio: 'ignore', timeout: 5000 })
})
