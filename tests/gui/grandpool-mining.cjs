const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

console.log('[mining-ui-qa] boot')

const root = path.resolve(__dirname, '../..')
const frontend = path.join(root, 'modules', 'mining', 'dist', 'frontend', 'index.html')
const preload = path.join(root, 'scripts', 'qa-mining-preload.cjs')
const outputRoot = path.join(root, 'local-checks', 'grandpool-0.1.9', 'mining-gui')
app.setPath('userData', path.join(outputRoot,'profile'))
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'modules', 'mining', 'catalog', 'default-catalog.json'), 'utf8'))
const scenarios = new Map()
const withTimeout = (promise, timeoutMs, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)),
])

const activeJob = {
  id: 'qa-raptoreum-cpu',
  name: 'Raptoreum CPU',
  coinId: 'raptoreum',
  algorithm: 'gr',
  runtimeState: 'running',
  miner: { id: 'xmrig', version: '6.26.0', adapterVersion: '1.0.0' },
  pools: [{ name: 'RPlant Europe', url: 'stratum+ssl://eu.rplant.xyz:17056' }],
  devices: { mode: 'cpu', ids: ['cpu:0'], intensity: 'auto', cpuThreads: 1 },
  runtimeMetrics: {
    startedAt: Date.now() - 185_000,
    hashrateHps: 2_740,
    hashrateUnit: 'h/s',
    powerWatts: 42,
    temperatureCelsius: 61,
    acceptedShares: 4,
    rejectedShares: 0,
    staleShares: 0,
  },
}

const qubicActiveJob = {
  id: 'qa-qubic-cpu',
  name: 'Qubic CPU',
  coinId: 'qubic',
  algorithm: 'qubic-upow',
  runtimeState: 'running',
  miner: { id: 'qli-client', version: '3.6.1', adapterVersion: '1.0.0' },
  pools: [{ name: 'Qubic.li Registerless', url: 'wss://wps.qubic.li/ws' }],
  devices: { mode: 'cpu', ids: ['cpu:0'], intensity: 'auto', cpuThreads: 1 },
  runtimeMetrics: {
    startedAt: Date.now() - 185_000,
    hashrateHps: 1_320_377,
    hashrateUnit: 'it/s',
    powerWatts: null,
    temperatureCelsius: null,
    acceptedShares: 0,
    rejectedShares: 0,
    staleShares: 0,
  },
}

const miningResponse = (scenario, request) => {
  const method = String(request?.method || '')
  const params = request?.params || {}
  const runningJob = scenario.qubicActive ? qubicActiveJob : activeJob
  switch (method) {
    case 'status':
      return {
        installed: true,
        verified: true,
        installedVersion: '0.1.13',
        bundledVersion: '0.1.13',
        updateAvailable: false,
        walletApiVersion: '1.0.0',
        platform: 'windows-x64',
        runningJobs: scenario.active ? [runningJob.id] : [],
        dataBytes: 0,
        dataPath: outputRoot,
      }
    case 'catalog':
      return { ...catalog, poolDirectory: { ...catalog.poolDirectory, entries: [] } }
    case 'customPools':
      return []
    case 'listJobs':
      return scenario.active
        ? [runningJob]
        : scenario.saved
          ? [scenario.savedJob || { ...activeJob, runtimeState: 'stopped', runtimeMetrics: undefined }]
          : []
    case 'saveJob':
      scenario.savedJob = { ...params.job, runtimeState: 'stopped' }
      return scenario.savedJob
    case 'installedMiners':
      return scenario.active || scenario.saved ? [{
        id: runningJob.miner.id,
        displayName: scenario.qubicActive ? 'QLI Client' : 'XMRig',
        version: runningJob.miner.version,
        platform: 'windows-x64',
        state: 'verified',
        running: true,
        sourceUrl: 'https://github.com/xmrig/xmrig',
      }] : []
    case 'hardware':
      return {
        cpu: { model: 'QA 8-Core CPU', logicalThreads: 8, memoryBytes: 16 * 1024 ** 3 },
        gpus: [{ id: '0', vendorId: 0x10de, deviceId: 0x2684, active: true, usable: true, renderer: 'NVIDIA QA GPU' }],
      }
    case 'checkModuleUpdates':
      return { currentVersion: '0.1.6', latestVersion: '0.1.6', updateAvailable: false, installable: false }
    case 'checkMinerUpdates':
      return { miners: [] }
    case 'getMiningIdentity':
      return {
        coinId: params.coinId,
        algorithm: params.algorithm,
        kind: params.coinId === 'qubic' ? 'public-identity' : 'payout-address',
        value: params.coinId === 'qubic'
          ? 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARMID'
          : `RQA${String(params.coinId || 'coin').toUpperCase()}111111111111111111111111111`,
      }
    case 'logs':
      return scenario.qubicActive ? [
        '[2026-07-18 19:16:09.359] [INFO] E:222 | SHARES: 0/0 (R:0) | [AVX2] 1274447 it/s | 1320377 avg it/s',
      ] : scenario.active ? [
        '[2026-07-16 12:55:01] net connected to eu.rplant.xyz:17056',
        '[2026-07-16 12:55:02] cpu READY threads 1/8',
        '[2026-07-16 12:55:06] speed 2.74 kH/s accepted 4 rejected 0',
        '[2026-07-16 12:55:12] new job from eu.rplant.xyz:17056',
      ] : []
    case 'manifest':
      return { version: '0.1.6', files: Array(67).fill(null) }
    default:
      throw new Error(`Unhandled Mining UI QA request: ${method}`)
  }
}

const assert=require('node:assert/strict')
const waitFor=async(window,expression)=>{for(let i=0;i<150;i++){if(await window.webContents.executeJavaScript(expression,true))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Mining GUI did not reach expected state')}
app.commandLine.appendSwitch('disable-gpu')
app.whenReady().then(async()=>{
 fs.mkdirSync(outputRoot,{recursive:true});const requests=[]
 ipcMain.handle('mining:request',(event,request)=>{requests.push(request.method);if(['startJob','installMiner','installModuleUpdate'].includes(request.method))throw Error('Execution is forbidden in this fixture');return miningResponse(scenarios.get(event.sender.id)||{},request)})
 ipcMain.handle('app:open-external',()=>{throw Error('External actions forbidden')})
 const keeper=new BrowserWindow({show:false,width:1,height:1});await keeper.loadURL('about:blank');const results=[]
 for(const coin of ['bitcoin','bitcoincash','zcash','peercoin','digibyte','mwc','pearl','xelis','nexa']){
  const window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
  scenarios.set(window.webContents.id,{})
  await window.loadFile(frontend,{query:{embedded:'1',coin,entry:'coin'}})
  await waitFor(window,"document.body.dataset.moduleReady==='true' && (document.querySelector('#quick-start-dialog')?.open || document.querySelector('#external-pool-dialog')?.open)")
  const state=await window.webContents.executeJavaScript(`({pool:document.querySelector('#external-pool-dialog')?.open?document.querySelector('#external-pool-dialog').dataset.poolId:document.querySelector('#quick-pool')?.value,logos:[...document.querySelectorAll('#quick-coin-choices img')].every(i=>i.complete&&i.naturalWidth>0),external:document.querySelector('#external-pool-dialog')?.open,user:document.querySelector('#external-pool-user')?.value})`,true)
  assert.equal(state.pool,`grandpool-${coin}-pool-fr-paris`);assert.equal(state.logos,true)
  if(state.external) assert.match(state.user,/\.worker1$/)
  results.push({coin,pool:state.pool,logosLoaded:state.logos,externalMiner:state.external})
  if(['xelis','nexa','bitcoincash'].includes(coin)){window.showInactive();await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(outputRoot,coin+'.png'),(await window.webContents.capturePage()).toPNG())}
  window.destroy();console.log('PASS GrandPool default '+coin)
 }
 assert.equal(requests.includes('startJob'),false)
 fs.writeFileSync(path.join(outputRoot,'results.json'),JSON.stringify({at:new Date().toISOString(),results,minerStarts:0,transactionBroadcasts:0},null,2)+'\n')
 keeper.destroy();app.quit()
}).catch(error=>{console.error(error.message);app.exit(1)})
