'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {connect} = require('./cdp.cjs')
const out=process.env.ALTBASE_QA_OUTPUT || '/tmp/altbase-technical-20260908/gui-results'
fs.mkdirSync(out,{recursive:true})
;(async()=>{
 const c=await connect(19508), results=[]
 const text=()=>c.evaluate('document.body.innerText')
 const input=async(name,value)=>c.evaluate(`(()=>{const e=document.querySelector('input[name="${name}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`)
 const amount=()=>c.evaluate('document.querySelector(\'input[name="amount"]\')?.value')
 const click=async(label)=>{
   assert.ok(['MAX','Continue','Cancel'].includes(label),'Only preflight buttons are allowed')
   assert.equal(await c.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)return false;e.click();return true})()`),true,'Button available: '+label)
 }
 const fresh=async(route)=>{await c.call('Page.navigate',{url:'http://127.0.0.1:18508/tests/gui/technical/index.html?run='+Date.now()+'#'+route});await c.wait(()=>c.evaluate('Boolean(window.qa)'),'fixture initialized');await c.wait(()=>c.evaluate('Boolean(document.querySelector("input[name=to]")) || location.hash === "#/app"'),'page ready');}
 const record=async(name,details={})=>{assert.equal(await c.evaluate('qa.state.sends'),0);await c.wait(()=>c.evaluate('Array.from(document.querySelectorAll("[role=dialog]")).every(e=>Number(getComputedStyle(e).opacity)>=0.99)'), 'dialog animation complete');await c.screenshot(out+'/'+name+'.png');results.push({name,passed:true,...details});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS '+name)}
 try {
  await fresh('/app/send?coin=pepecoin');await input('to','fixture-recipient');await click('MAX');await c.wait(async()=>await amount()==='999.99','initial PEPE MAX')
  await click('Continue');await c.wait(async()=>await amount()==='999.98','PEPE updated MAX')
  assert.match(await text(),/MAX amount or fee changed/)
  assert.equal(await c.evaluate('document.querySelectorAll("[role=dialog]").length'),0)
  await record('pepe-fee-change',{before:'999.99',after:'999.98',fee:'0.02',confirmationOpened:false})
  await click('Continue');await c.wait(()=>c.evaluate('document.querySelectorAll("[role=dialog]").length === 1'),'review modal')
  assert.match(await text(),/999.98/);assert.match(await text(),/0.02/)
  await record('pepe-reviewed-confirmation',{confirmationClicked:false})
  await fresh('/app/send?coin=nonsense');await input('to','nonsense:qr8jdslgp7k5jhcz2uq8fxnpdpr4hghth8kp32t693gmhtc2usvjgkj7su3c8');await click('MAX')
  await c.wait(async()=>/Remaining balance:/.test(await text()),'NNN partial MAX')
  const nnn=await amount();assert.ok(Number(nnn)>0&&Number(nnn)<1000)
  await record('nonsense-many-utxos',{inputs:1000,amount:nnn})
  await click('Continue');await c.wait(()=>c.evaluate('document.querySelectorAll("[role=dialog]").length === 1'),'NNN review')
  assert.equal((await text()).match(/Remaining balance:/g).length,2)
  await record('nonsense-partial-confirmation',{confirmationClicked:false})
  await fresh('/app/send?coin=ckb');await input('to','fixture-recipient');await click('MAX')
  await c.wait(()=>c.evaluate('qa.state.ckbWait'),'CKB pending')
  assert.match(await text(),/Calculating MAX/)
  await record('ckb-waiting')
  await click('Cancel');await c.evaluate('qa.releaseCkb()');await c.wait(()=>c.evaluate('!qa.state.ckbWait'),'CKB canceled result')
  assert.equal(await amount(),'');assert.doesNotMatch(await text(),/Calculating MAX/)
  await record('ckb-canceled-stale-result')
  await click('MAX');await c.wait(()=>c.evaluate('qa.state.ckbWait'),'CKB retry');await c.evaluate('qa.releaseCkb()');await c.wait(async()=>await amount()==='999.99999','CKB resolved');await record('ckb-result')
  await fresh('/app')
  for(const kind of ['background','manual']) {
    await c.evaluate('qa.setBalance("0")');await c.evaluate(`qa.race(${JSON.stringify(kind)})`)
    await c.wait(()=>c.evaluate('qa.state.networkWaiting || qa.state.raceFinished'),'privacy waits for network')
    assert.equal(await c.evaluate('qa.state.networkWaiting'),true,JSON.stringify(await c.evaluate('qa.state')))
    await c.evaluate('qa.setBalance("0.09996")');await c.wait(async()=>/0.09996 BCH2/.test(await text()),'BCH2 updated during privacy wait')
    await c.evaluate('qa.releaseNetwork()');await c.wait(()=>c.evaluate('qa.state.raceFinished'),'privacy commit');assert.equal(await c.evaluate('qa.state.error'),'')
    assert.match(await text(),/0.09996 BCH2/)
    await record('balance-race-'+kind,{balance:'0.09996',privacyRefresh:kind})
  }
  const history=await c.evaluate('qa.history()');assert.equal(history.kaspa.confirmations,6);assert.equal(history.qubic.verification,'unverified')
  await c.evaluate('qa.go("/app/tx/kaspa-fixture")');await c.wait(async()=>/Transaction details/.test(await text()),'Kaspa detail')
  assert.match(await text(),/Confirmations\s+6/i);assert.doesNotMatch(await text(),/2000006/);await record('kaspa-counter',{counter:6})
  await c.evaluate('qa.go("/app/tx/qubic-fixture")');await c.wait(async()=>/status unverified/i.test(await text()),'Qubic detail')
  assert.match(await text(),/Execution has not been verified/);await record('qubic-unverified')
  console.log(JSON.stringify({passed:results.length,signCalls:0,broadcastCalls:0,confirmationClicks:0}))
 } catch(e){await c.screenshot(out+'/failure.png');fs.writeFileSync(out+'/failure.txt',await text());throw e} finally {c.socket.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
