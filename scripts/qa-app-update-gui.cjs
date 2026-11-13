'use strict'
// Real renderer/preload and visible controls, isolated profile, mocked feed.
const {app,BrowserWindow,ipcMain,session}=require('electron')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),run=process.env.ALTBASE_QA_RUN_DIRECTORY||path.join(root,'local-checks/update-gui-'+Date.now())
fs.mkdirSync(run,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(run,'profile-')));app.disableHardwareAcceleration()
let window,stage='startup',latest='0.1.14',required=false,offline=false,openAllowed=false,requests=0
const opened=[],pause=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>window.webContents.executeJavaScript(code,true)
async function until(expression,label){stage=label;const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(`Boolean(${expression})`))return;await pause(100)}throw Error('Update GUI check failed')}
const visible="Boolean(document.querySelector('[role=dialog][aria-label=\"New version available\"]'))"
const button=text=>evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`)
async function reload(){await window.reload();await until("document.querySelector('[data-testid=modules-link]')",'welcome remains available');await pause(300)}
const watchdog=setTimeout(()=>{console.error(JSON.stringify({passed:false,stage}));app.exit(1)},120000)
app.whenReady().then(async()=>{
 session.defaultSession.protocol.handle('https',async request=>{
  const url=new URL(request.url)
  if(url.origin==='https://api.altbase.io'&&url.pathname==='/api/v1/app/update'){
   requests++;assert.equal(url.searchParams.get('version'),require('../package.json').version)
   if(offline)return new Response('',{status:503,headers:{'Access-Control-Allow-Origin':'*'}})
   return Response.json({ok:true,latestVersion:latest,required,downloadUrl:'https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v'+latest},{headers:{'Access-Control-Allow-Origin':'*'}})
  }
  return Response.json({ok:true,prices:{},updatedAt:Date.now(),available:false},{headers:{'Access-Control-Allow-Origin':'*'}})
 })
 ipcMain.handle('plugins:catalog',()=>({ok:true,result:{modules:[],diagnostics:[],directory:run}}))
 ipcMain.handle('plugins:updates',()=>({ok:true,result:{changed:false}}))
 ipcMain.handle('core:request',()=>({ok:false,error:'Native wallet operations are not used by update GUI fixtures'}))
 ipcMain.handle('app:open-external',(_event,url)=>{opened.push(url);return{ok:openAllowed}})
 for(const key of ['app:debug-log','app:notify'])ipcMain.handle(key,()=>({ok:true}))
 window=new BrowserWindow({show:true,width:1100,height:800,webPreferences:{preload:path.join(root,'electron/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}})
 await window.loadFile(path.join(root,'dist/index.html'));await until(visible,'new release notice')
 assert.ok(await evaluate("document.querySelector('[role=dialog]').textContent.includes('0.1.14')"))
 fs.writeFileSync(path.join(run,'01-update-notice.png'),(await window.webContents.capturePage()).toPNG())
 await button('Download');await pause(150);assert.equal(await evaluate(visible),true)
 assert.equal(await evaluate("localStorage.getItem('altbase.update.dismissed')"),null)
 openAllowed=true;await button('Download');await until('!'+visible,'download opens official release and closes notice')
 assert.equal(opened.length,2);assert.ok(opened.every(u=>u==='https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.14'))
 await reload();assert.equal(await evaluate(visible),false)
 latest='0.1.15';await reload();await until(visible,'newer release bypasses previous dismissal');await button('Later');await until('!'+visible,'later closes optional notice')
 required=true;await reload();await until(visible,'mandatory notice ignores dismissal');assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.trim()==='Later')"),false)
 required=false;offline=true;await reload();assert.equal(await evaluate(visible),false)
 const result={at:new Date().toISOString(),passed:true,realRenderer:true,realPreload:true,requests,optionalNotice:true,failedBrowserOpenKeepsNotice:true,officialReleaseLink:true,dailyDismissal:true,newerReleaseReappears:true,mandatoryCannotDismiss:true,offlineStartupAvailable:true,actualExternalBrowserLaunches:0,realUserProfilesOpened:0,realTransfers:0}
 fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));clearTimeout(watchdog);app.quit()
}).catch(()=>{console.error(JSON.stringify({passed:false,stage}));clearTimeout(watchdog);app.exit(1)})
