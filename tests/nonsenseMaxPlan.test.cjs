'use strict'
const assert=require('node:assert/strict')
const test=require('node:test')
const {createJiti}=require('jiti')
const {pathToFileURL}=require('node:url')
const path=require('node:path')
const {planNonsenseMax}=createJiti(__filename)('../src/utils/nonsenseMaxPlan.ts')
const address='nonsense:qr8jdslgp7k5jhcz2uq8fxnpdpr4hghth8kp32t693gmhtc2usvjgkj7su3c8'
const entries=Array.from({length:1000},(_,i)=>({
  outpoint:{transactionId:(i+1).toString(16).padStart(64,'0'),index:0},
  amount:100_000_000n+BigInt(i),scriptPublicKey:{version:0,script:'20'+'11'.repeat(32)+'ac'},
  blockDaaScore:1n,isCoinbase:false,
}))
test('Nonsense MAX fits a checked subset of 1000 synthetic UTXOs without signing', async()=>{
  const root=path.resolve(__dirname,'../vendor/nonsense-wasm-v0.1.7')
  const sdk=await import(pathToFileURL(path.join(root,'nonsense.js')).href)
  const bytes=await import(pathToFileURL(path.join(root,'nonsense_bg.base64.js')).href)
  await sdk.default({module_or_path:Uint8Array.from(Buffer.from(bytes.default,'base64'))})
  const create=selected=>sdk.createSweepTransaction({address,entries:selected,feeRate:1,priorityFee:0n,networkId:'mainnet'})
  assert.throws(()=>create(entries), /too many UTXOs/)
  const result=planNonsenseMax(entries,create)
  assert.ok(result.entries.length>0 && result.entries.length<entries.length)
  assert.equal(result.entries.length+result.remainingInputCount,entries.length)
  assert.equal(result.entries.reduce((n,e)=>n+e.amount,0n)+result.remainingAmount,entries.reduce((n,e)=>n+e.amount,0n))
  assert.equal(result.plan.transactions.length,1)
  assert.throws(()=>result.plan.transactions[0].serializeToSafeJSON(),/must be signed/)
  assert.throws(()=>create([...result.entries,entries[0]]),/too many UTXOs/)
  const small=planNonsenseMax(entries.slice(0,2),create)
  assert.equal(small.remainingInputCount,0)
  assert.equal(small.remainingAmount,0n)
})
test('Nonsense MAX does not mask invalid input or fee errors as a partial sweep',()=>{
  assert.throws(()=>planNonsenseMax(entries,()=>{throw Error('Invalid address')}),/Invalid address/)
  assert.throws(()=>planNonsenseMax([],()=>({})),/No spendable/)
})
