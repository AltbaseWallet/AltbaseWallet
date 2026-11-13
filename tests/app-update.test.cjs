'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {bundle}=require('./bundle-helper.cjs')
async function fixture({data={latestVersion:'0.1.14'},platform='Linux x86_64',storageError=false,fetchError=false,status=200}={}) {
 const stored=new Map(),requests=[]
 const service=await bundle('src/services/appUpdateService.ts',{}, {
  __APP_VERSION__:'0.1.13',URL,AbortController,navigator:{platform},
  window:{setTimeout,clearTimeout,localStorage:{getItem:key=>{if(storageError)throw Error('Storage unavailable');return stored.get(key)||null},setItem:(k,v)=>{if(storageError)throw Error('Storage unavailable');stored.set(k,v)}}},
  fetch:async(url,options)=>{requests.push({url:String(url),options});if(fetchError)throw Error('Offline');return{ok:status===200,json:async()=>data}},
 })
 return {...service,stored,requests}
}
test('wallet update check reaches the production endpoint with the actual version and platform',async()=>{
 for(const [value,expected] of [['Win32','windows'],['Linux x86_64','linux'],['MacIntel','macos']]){
  const f=await fixture({platform:value});const result=await f.checkAppUpdate(),url=new URL(f.requests[0].url)
  assert.equal(url.origin+url.pathname,'https://api.altbase.io/api/v1/app/update')
  assert.equal(url.searchParams.get('version'),'0.1.13');assert.equal(url.searchParams.get('platform'),expected)
  assert.equal(f.requests[0].options.cache,'no-store');assert.ok(f.requests[0].options.signal)
  assert.equal(result.latestVersion,'0.1.14');assert.equal(result.downloadUrl,'https://altbase.io/download')
 }
})
test('update checks reject downgrades, the current version, malformed feeds and spoofed availability',async()=>{
 for(const data of [null,[],{}, {ok:false,latestVersion:'0.1.14'},...['0.1.12','0.1.13','0.1.14.bad','1.2','999999999999999999999.0.0','https://bad.invalid'].map(latestVersion=>({latestVersion,updateAvailable:true}))]){
  assert.equal(await(await fixture({data})).checkAppUpdate(),null)
 }
 const f=await fixture({data:{latestVersion:'v0.1.14',downloadUrl:'https://bad.invalid',releaseNotesUrl:'javascript:alert(1)'}})
 assert.equal((await f.checkAppUpdate()).downloadUrl,'https://altbase.io/download')
 const official=await fixture({data:{latestVersion:'0.1.14',downloadUrl:'https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.14'}})
 assert.equal((await official.checkAppUpdate()).downloadUrl,'https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.14')
})
test('optional update dismissal expires by day and cannot suppress another or mandatory release',async()=>{
 const f=await fixture();f.dismissUpdateForToday('0.1.14');assert.equal(await f.checkAppUpdate(),null)
 const [key]=f.stored.keys();f.stored.set(key,JSON.stringify({version:'0.1.14',day:'2000-1-1'}));assert.ok(await f.checkAppUpdate())
 f.dismissUpdateForToday('0.1.15');assert.ok(await f.checkAppUpdate())
 const required=await fixture({data:{latestVersion:'0.1.14',required:true}});required.dismissUpdateForToday('0.1.14');assert.equal((await required.checkAppUpdate()).required,true)
})
test('unavailable feeds and restricted or corrupted storage never break wallet startup',async()=>{
 assert.equal(await(await fixture({fetchError:true})).checkAppUpdate(),null)
 assert.equal(await(await fixture({status:503})).checkAppUpdate(),null)
 const f=await fixture({storageError:true});assert.doesNotThrow(()=>f.dismissUpdateForToday('0.1.14'));assert.ok(await f.checkAppUpdate())
 const corrupt=await fixture();corrupt.stored.set('altbase.update.dismissed','not JSON');assert.ok(await corrupt.checkAppUpdate())
})
