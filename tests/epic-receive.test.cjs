'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {bundle,deferred}=require('./bundle-helper.cjs')
test('EPIC receive address is available before cache download and throughout a blocked scan',{timeout:3000},async()=>{
 const scan=deferred(),started=deferred(),calls=[]
 const api=await bundle('src/services/privacy/epicPrivacyWalletService.ts',{
  'services/nativeCoreService':{nativeCoreService:{privacyLightWallet:async params=>{
   calls.push(params.action)
   if(params.action==='ensure')return{ok:true,address:'PUBLIC_EPIC_FIXTURE',code:'epic-native-wallet'}
   started.resolve();return scan.promise
  }}},
  'services/privacyCacheService':{privacyCacheService:{load:async()=>null,saveFromSnapshot:async()=>{}}},
  'services/privacyBirthService':{privacyBirthService:{restoreStartHeight:async()=>100}},
  'utils/quaiDebugLog':{coinDebugLog(){},coinDebugLogError(){}},
 })
 const service=api.epicPrivacyWalletService
 const pending=service.getSnapshot('PUBLIC_TEST_INPUT')
 await started.promise
 assert.equal((await service.ensureWallet('PUBLIC_TEST_INPUT')).address,'PUBLIC_EPIC_FIXTURE')
 assert.deepEqual(calls,['ensure','snapshot'])
 scan.resolve({ok:true,address:'PUBLIC_EPIC_FIXTURE',code:'epic-native-wallet',balance:'1',spendable:'1',lastScannedHeight:100})
 await pending;service.resetNativeReadiness()
})
test('EPIC deterministic address derivation never waits for remote scan-cache recovery',{timeout:3000},async()=>{
 let cacheReads=0,nativeCalls=0
 const api=await bundle('src/services/privacy/epicPrivacyWalletService.ts',{
  'services/nativeCoreService':{nativeCoreService:{privacyLightWallet:async()=>{nativeCalls++;return{ok:true,address:'PUBLIC_EPIC_FIXTURE'}}}},
  'services/privacyCacheService':{privacyCacheService:{load:()=>{cacheReads++;return new Promise(()=>{})}}},
  'services/privacyBirthService':{privacyBirthService:{}},
  'utils/quaiDebugLog':{coinDebugLog(){},coinDebugLogError(){}},
 })
 const service=api.epicPrivacyWalletService
 assert.equal((await service.ensureWallet('PUBLIC_TEST_INPUT')).address,'PUBLIC_EPIC_FIXTURE')
 assert.equal(cacheReads,0);assert.equal(nativeCalls,1)
 service.resetNativeReadiness()
 await service.ensureWallet('ANOTHER_PUBLIC_TEST_INPUT');assert.equal(nativeCalls,2)
 service.resetNativeReadiness()
})
