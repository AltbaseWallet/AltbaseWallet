const {app, BrowserWindow, session} = require('electron')
app.setPath('userData', process.env.ALTBASE_QA_PROFILE || '/tmp/altbase-technical-20260908/gui-profile')
app.commandLine.appendSwitch('remote-debugging-port','19508')
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    callback({cancel: !(['127.0.0.1','localhost'].includes(url.hostname) || ['data:','blob:'].includes(url.protocol))})
  })
  const win = new BrowserWindow({width:1400,height:1050,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}})
  win.loadURL('http://127.0.0.1:18508/tests/gui/technical/index.html')
})
app.on('window-all-closed', () => app.quit())
