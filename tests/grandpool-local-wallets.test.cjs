'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events')
const {generateMnemonic}=require('@scure/bip39'),{wordlist}=require('@scure/bip39/wordlists/english')
const {base58check}=require('@scure/base'),{sha256}=require('@noble/hashes/sha256'),{secp256k1}=require('@noble/curves/secp256k1')
const xelis=require('../modules/xelis/runtime/index.cjs'),mwc=require('../modules/mwc/runtime/index.cjs')
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const child=()=>{const c=new EventEmitter();c.exitCode=null;c.stdin=new EventEmitter();c.stdin.end=()=>{};c.kill=()=>{c.exitCode=0;c.emit('exit',0)};return c}
const ready=async(runtime,address)=>{for(let i=0;i<100;i++){const s=await runtime.snapshot({address,network:{blocks:100,stableTopoheight:100},includeHistory:false});if(!s.syncing)return s;await delay(10)}throw new Error('Fixture did not become ready')}

test('Xelis: scan gates balances, MAX rechecks approval, and send broadcasts once',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'altbase-xelis-fixture-'));let online=true,height=99,address,broadcasts=0,builds=0
 const runtime=xelis.createRuntime({baseDir:dir,binary:'fixture',nodeUrl:'fixture',getNetwork:async()=>({blocks:100,stableTopoheight:100}),spawnWithPrivateConfig:async()=>child(),rpc:async(state,method,params)=>{
  if(method==='get_address')return state.address
  if(method==='is_online')return online
  if(method==='get_topoheight')return height
  if(method==='get_balance')return 100000000
  if(method==='estimate_fees')return 25000
  if(method==='list_transactions')return []
  if(method==='build_transaction'){builds++;assert.equal(params.broadcast,false);assert.deepEqual(params.fee,{fixed:25000});assert.equal(params.fee_limit,25000);return{fee:25000,hash:'ab'.repeat(32),tx_as_hex:'mock-signed-by-local-reference'}}
  throw new Error('Unexpected RPC '+method)
 },submitTransaction:async hex=>{broadcasts++;assert.equal(hex,'mock-signed-by-local-reference');throw new Error('uncertain broadcast')}})
 t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true})})
 address=(await runtime.derive({mnemonic:generateMnemonic(wordlist)})).address
 await delay(30)
 const scanning=await runtime.snapshot({address,network:{blocks:100}});assert.equal(scanning.syncing,true);assert.equal(scanning.balance,undefined)
 height=100;assert.equal((await ready(runtime,address)).balance.balance,'100000000')
 online=false;await assert.rejects(runtime.snapshot({address,network:{blocks:100}}),/unavailable/);online=true
 const plan=await runtime.plan({fromAddress:address,toAddress:address,sendMax:true})
 assert.equal(plan.amountCoin,'0.99975');assert.equal(builds,0);assert.equal(broadcasts,0)
 await assert.rejects(runtime.send({fromAddress:address,toAddress:address,sendMax:true,amountCoin:'0.9',maxFeeCoin:'0.00025'}),/MAX changed/)
 assert.equal(builds,0)
 await assert.rejects(runtime.send({fromAddress:address,toAddress:address,amountCoin:'0.2',maxFeeCoin:'0.0001'}),/Fee changed/)
 assert.equal(builds,0)
 await assert.rejects(runtime.send({fromAddress:address,toAddress:address,amountCoin:'0.2',maxFeeCoin:'0.00025'}),/uncertain broadcast/)
 assert.equal(builds,1);assert.equal(broadcasts,1)
})

test('MWC: encrypted reference workflow preserves profiles and prevents unapproved fee broadcasts',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'altbase-mwc-fixture-'))
 const address=base58check(sha256).encode(Buffer.concat([Buffer.from([1,69]),Buffer.from(secp256k1.getPublicKey(Buffer.alloc(32,9),true))]))
 let finishScan,fresh=true,created=0,sends=0,broadcasts=0,fee='1000000'
 const scan=new Promise(r=>{finishScan=r}),calls=[]
 const rpc={initialize:async()=>{},close(){},call:async(method,params)=>{
  calls.push(method)
  if(method==='create_wallet'){created++;const profile=path.join(dir,mwc.identity(params.mnemonic).id,'wallet_data');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'wallet.seed'),'encrypted-fixture-only');return null}
  if(method==='open_wallet')return 'fixture-token'
  if(method==='get_mqs_address')return{public_key:address}
  if(method==='scan')return scan
  if(method==='get_updater_messages')return[{Scanning:[true,'fixture scan',42]}]
  if(method==='retrieve_summary_info')return[fresh,{last_confirmed_height:'100',total:'2000000000',amount_currently_spendable:'2000000000',amount_immature:'0',amount_awaiting_confirmation:'0'}]
  if(method==='retrieve_txs')return[true,[]]
  if(method==='init_send_tx'){
    if(params.args.estimate_only){assert.equal(params.args.send_args,null);return{fee:'1000000',amount:params.args.amount}}
    sends++;assert.equal(params.args.send_args.post_tx,false)
    return{fee,amount:params.args.amount,tx:{body:{kernels:[{excess:'ab'.repeat(33)}]}}}
  }
  if(method==='post_tx'){broadcasts++;throw new Error('uncertain broadcast')}
  throw new Error('Unexpected RPC '+method)
 }}
 const runtime=mwc.createRuntime({baseDir:dir,binary:'fixture',nodeUrl:'fixture',spawn:()=>child(),createOwnerRpc:()=>rpc,getNetwork:async()=>({blocks:100})})
 t.after(async()=>{finishScan();await runtime.close();await fs.rm(dir,{recursive:true,force:true})})
 const mnemonic=generateMnemonic(wordlist)
 assert.equal((await runtime.derive({mnemonic})).address,address);await delay(50)
 const scanning=await runtime.snapshot({address,network:{blocks:100}});assert.equal(scanning.syncing,true);assert.equal(scanning.balance,undefined);assert.equal(scanning.scanPercent,42)
 finishScan();assert.equal((await ready(runtime,address)).balance.balance_spendable,'2000000000')
 fresh=false;await assert.rejects(runtime.snapshot({address,network:{blocks:100}}),/did not refresh/);fresh=true
 const plan=await runtime.plan({fromAddress:address,toAddress:address,sendMax:true});assert.equal(plan.amountCoin,'1.999');assert.equal(sends,0);assert.equal(broadcasts,0)
 await assert.rejects(runtime.send({fromAddress:address,toAddress:address,amountCoin:'0.5',maxFeeCoin:'0.0001'}),/Fee changed/);assert.equal(sends,0)
 fee='2000000';await assert.rejects(runtime.send({fromAddress:address,toAddress:address,amountCoin:'0.5',maxFeeCoin:'0.001'}),/not broadcast/);assert.equal(broadcasts,0)
 fee='1000000';await assert.rejects(runtime.send({fromAddress:address,toAddress:address,amountCoin:'0.5',maxFeeCoin:'0.001'}),/uncertain broadcast/);assert.equal(broadcasts,1)
 await runtime.close();await runtime.derive({mnemonic});await ready(runtime,address)
 assert.equal(created,1);assert.equal(calls.filter(m=>m==='scan').length,1)
})
