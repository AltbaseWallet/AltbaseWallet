'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {deferred}=require('./bundle-helper.cjs')
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))}
function fixture(rpc,scannedHeight=100){
 const timers=[],idx={coin:'fixture',watched:new Set(['PUBLIC_FIXTURE']),scannedHeight,knownMempool:new Set(),flushIfDirty(){},pendingTxids:()=>[]}
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(require.resolve('../ops/backend/indexerWorker.cjs'),'utf8'),{module,exports:module.exports,Map,Set,Date,Promise,setTimeout,require:name=>name==='./logger.cjs'?{warn(){},info(){}}:{MEMPOOL_POLL_MS:100,BLOCK_POLL_MS:100,BACKFILL_BLOCKS:1},setInterval:fn=>{timers.push(fn);return{unref(){}}}})
 const worker=new module.exports.IndexerWorker({ensure:()=>idx});worker.register('fixture',rpc)
 return{timers,idx}
}
test('slow block and mempool sweeps remain single-flight across timer ticks',async()=>{
 let tip=100,blocks=0,mempools=0;const block=deferred(),mempool=deferred()
 const f=fixture(async method=>{if(method==='getblockchaininfo')return{blocks:tip};if(method==='getblockhash')return'fixture';if(method==='getblock'){blocks++;return block.promise}if(method==='getrawmempool'){mempools++;return mempool.promise}throw Error('Unexpected fixture method')})
 await flush();tip=101
 for(let i=0;i<5;i++){f.timers[0]();f.timers[1]()}
 await flush();assert.equal(blocks,1);assert.equal(mempools,1);assert.equal(f.idx.scannedHeight,100)
 block.resolve({tx:[]});mempool.resolve([]);await flush();assert.equal(f.idx.scannedHeight,101)
})
test('a failed block read cannot advance the persistent index height',async()=>{
 let tip=100,fail=true
 const f=fixture(async method=>{if(method==='getblockchaininfo')return{blocks:tip};if(method==='getblockhash')return'fixture';if(method==='getblock'){if(fail)throw Error('Fixture block unavailable');return{tx:[]}}throw Error('Unexpected fixture method')})
 await flush();tip=101;f.timers[1]();await flush();assert.equal(f.idx.scannedHeight,100)
 fail=false;f.timers[1]();await flush();assert.equal(f.idx.scannedHeight,101)
})
test('retry after interrupted initial catch-up stays inside the retained block range',async()=>{
 let fail=true;const heights=[]
 const f=fixture(async(method,params)=>{
  if(method==='getblockchaininfo')return{blocks:2000,pruned:true,pruneheight:1500}
  if(method==='getblockhash'){heights.push(params[0]);return'fixture'}
  if(method==='getblock'){if(fail)throw Error('Fixture block unavailable');return{tx:[]}}
  throw Error('Unexpected fixture method')
 },0)
 await flush();assert.equal(f.idx.scannedHeight,0)
 fail=false;f.timers[1]();await flush();assert.equal(f.idx.scannedHeight,2000)
 assert.ok(heights.every(height=>height>=1500));assert.equal(f.idx.dirty,true)
})
