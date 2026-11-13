'use strict'
const fs = require('node:fs')
function registerPluginIpc({ ipcMain, getPluginManager, getModuleUpdater, isTrustedIpcEvent, shell }) {
ipcMain.handle('plugins:updates', async event => {
  try {
    if (!isTrustedIpcEvent(event)) throw Error('Untrusted IPC sender')
    return { ok: true, result: getModuleUpdater ? await getModuleUpdater().check() : { configured: false, changed: false, error: null, lastChecked: null } }
  } catch { return { ok: false, error: 'Could not check module updates' } }
})
ipcMain.handle('plugins:catalog', async (event, refresh = false) => {
  try {
    if (!isTrustedIpcEvent(event)) throw Error('Untrusted IPC sender')
    return { ok: true, result: refresh ? await getPluginManager().discover() : getPluginManager().catalog() }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('plugins:request', async (event, request = {}) => {
  try {
    if (!isTrustedIpcEvent(event)) throw Error('Untrusted IPC sender')
    return { ok: true, result: await getPluginManager().request(request.coin, request.method, request.params) }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('plugins:open-directory', async (event) => {
  try {
    if (!isTrustedIpcEvent(event)) throw Error('Untrusted IPC sender')
    const directory = getPluginManager().catalog().directory
    await fs.promises.mkdir(directory, { recursive: true })
    await require('../open-module-directory.cjs').openModuleDirectory(directory, shell)
    return { ok: true, directory }
  } catch (error) { return { ok: false, error: error.message } }
})

}
module.exports = { registerPluginIpc }
