'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {appUpdatePayload}=require('../ops/backend/appUpdate.cjs')
const config={latestVersion:'0.1.13',downloadUrl:'https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.13',files:{windows:'wallet-0.1.13.msi',linux:'wallet-0.1.13.tar.gz'},platforms:{macos:{latestVersion:'0.1.9',downloadUrl:'https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.9',files:{macos:'macos-0.1.9.zip'}}}}
test('published Linux and Windows updates use the current build without offering downgrades',()=>{
 for(const platform of ['windows','linux','ubuntu','__proto__','constructor']){
  const result=appUpdatePayload(config,{currentVersion:'0.1.12',platform});assert.equal(result.latestVersion,'0.1.13');assert.equal(result.updateAvailable,true)
  for(const currentVersion of ['0.1.13','0.1.14'])assert.equal(appUpdatePayload(config,{currentVersion,platform}).updateAvailable,false)
 }
})
test('an unavailable new macOS build retains the actual last published macOS version',()=>{
 const result=appUpdatePayload(config,{currentVersion:'0.1.9',platform:'macos'});assert.equal(result.latestVersion,'0.1.9');assert.equal(result.updateAvailable,false);assert.equal(result.files.macos,'macos-0.1.9.zip')
 assert.equal(appUpdatePayload(config,{currentVersion:'0.1.8',platform:'macos'}).updateAvailable,true)
})
