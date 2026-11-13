'use strict'
// Execute the user's plain command with no flags and an empty isolated profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), run = path.join(root, 'local-checks', 'linux-direct-' + Date.now())
fs.mkdirSync(run, { recursive: true, mode: 0o700 })
const binary = path.join(process.env.ALTBASE_QA_LINUX_DIRECTORY || path.join(root, 'artifacts/linux-unpacked'), 'altcoinwallet')
const log = fs.openSync(path.join(run, 'launch.log'), 'w')
const env = { ...process.env, XDG_CONFIG_HOME: path.join(run, 'config') }
delete env.CHROME_DEVEL_SANDBOX
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(binary, [], { cwd: path.dirname(binary), env, stdio: ['ignore', log, log] })
fs.closeSync(log)
let exited = false, spawnError
child.on('exit', () => { exited = true })
child.on('error', error => { spawnError = error; exited = true })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function waylandWindow(pid) {
  // AT-SPI can inspect this application's window on Wayland without changing
  // launch flags or depending on GNOME's restricted shell introspection API.
  const result = spawnSync('python3', ['-c', `
import sys, gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
found = False
for index in range(desktop.get_child_count()):
    application = desktop.get_child_at_index(index)
    if application.get_process_id() != int(sys.argv[1]):
        continue
    for child_index in range(application.get_child_count()):
        window = application.get_child_at_index(child_index)
        state = window.get_state_set()
        if 'Altbase Wallet' in (window.get_name() or '') and state.contains(Atspi.StateType.SHOWING):
            found = True
print('visible' if found else 'waiting')
`, String(pid)], { encoding: 'utf8', timeout: 3000 })
  return !result.error && result.status === 0 && result.stdout.trim() === 'visible'
}
function properties(id, ...names) {
  const result = spawnSync('xprop', [id === '-root' ? '-root' : '-id', ...(id === '-root' ? [] : [id]), ...names], { encoding: 'utf8', timeout: 2000 })
  if (result.error) throw result.error
  return result.stdout || ''
}
;(async () => {
  const deadline = Date.now() + 20000
  let visible = false
  while (!exited && Date.now() < deadline) {
    const ids = properties('-root', '_NET_CLIENT_LIST').match(/0x[0-9a-f]+/ig) || []
    for (const id of ids) {
      const state = properties(id, '_NET_WM_PID', '_NET_WM_NAME', 'WM_STATE')
      if (Number(state.match(/_NET_WM_PID\(CARDINAL\) = (\d+)/)?.[1]) === child.pid
        && /_NET_WM_NAME.*Altbase Wallet/.test(state) && /window state: Normal/.test(state)) visible = true
    }
    if (!visible && process.env.XDG_SESSION_TYPE === 'wayland') visible = waylandWindow(child.pid)
    if (visible) break
    await pause(200)
  }
  if (spawnError) throw spawnError
  assert.equal(visible, true, 'Plain launch must show the normal application window')
  assert.equal(exited, false)
  assert.doesNotMatch(fs.readFileSync(path.join(run, 'launch.log'), 'utf8'), /FATAL|No usable sandbox|SUID sandbox helper binary was found/)
  const record = { at: new Date().toISOString(), passed: true, command: binary, arguments: [],
    visibleNormalWindow: true, isolatedProfile: true, administratorChanges: false,
    realTransfers: 0, evidence: path.relative(root, run) }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify(record))
})().catch(error => {
  console.error(JSON.stringify({ passed: false, error: error.message, evidence: path.relative(root, run) })); process.exitCode = 1
}).finally(async () => { child.kill('SIGTERM'); await pause(500); if (!exited) child.kill('SIGKILL') })
