'use strict'
const { spawn } = require('node:child_process')

// Keep the operation alive while the desktop portal/file manager starts. Some
// Electron/GTK combinations abandon shell.openPath's pending IPC reply.
const pending = new Set()
async function openModuleDirectory(directory, shell, options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'linux') {
    const operation = shell.openPath(directory); pending.add(operation)
    try { if (await operation) throw Error('Could not open the modules folder') }
    finally { pending.delete(operation) }
    return
  }
  const operation = new Promise((resolve, reject) => {
    const child = (options.spawn || spawn)('xdg-open', [directory], { stdio: 'ignore', shell: false })
    const timer = setTimeout(() => { child.kill(); reject(Error('Opening the modules folder timed out')) }, options.timeoutMs || 30000)
    child.once('error', () => { clearTimeout(timer); reject(Error('Could not start the desktop file manager')) })
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(Error('Could not open the modules folder')) })
  })
  pending.add(operation)
  try { await operation } finally { pending.delete(operation) }
}
module.exports = { openModuleDirectory }
