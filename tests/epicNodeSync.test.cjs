'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const {patchEpicSyncStatus}=require('../ops/remote-nodes/epic-sync-status-patch.cjs')
const input=fs.readFileSync(path.join(__dirname,'../ops/remote-nodes/adapters/epicNode.node2.cjs'),'utf8')
const output=patchEpicSyncStatus(input);assert.equal(patchEpicSyncStatus(output),output)
let status
const c={module:{exports:{}},URL,require(name){assert.equal(name,'../lib/rpc.cjs');return {RpcError:Error,httpRequest:async()=>({status:200,body:JSON.stringify(status)})}}}
vm.createContext(c);vm.runInContext(output,c)
const adapter=c.module.exports.createEpicNodeAdapter({apiUrl:'http://fixture.invalid'})
;(async()=>{
 const fixtures=[
  {name:'body sync preserves target',input:{tip:{height:3717102},sync_status:'body_sync',sync_info:{current_height:3717102,highest_height:3723987}},headers:3723987,ready:false},
  {name:'snapshot validation is not ready',input:{tip:{height:100},sync_status:'txhashset_validation'},headers:100,ready:false},
  {name:'awaiting peers is not ready',input:{tip:{height:100},sync_status:'awaiting_peers'},headers:100,ready:false},
  {name:'completed daemon is ready',input:{tip:{height:3723987},sync_status:'no_sync'},headers:3723987,ready:true},
  {name:'inconsistent no_sync does not hide known lag',input:{tip:{height:100},sync_status:'no_sync',sync_info:{current_height:100,highest_height:200}},headers:200,ready:false},
 ]
 for(const f of fixtures){status=f.input;const n=await adapter.getNetwork(),scan=await adapter.getPrivacyScanInfo();assert.equal(n.headers,f.headers,f.name);assert.equal(scan.ready,f.ready,f.name);assert.equal(n.initialBlockDownload,!f.ready,f.name)}
 console.log(JSON.stringify({fixtures:fixtures.map(f=>f.name),passed:true}))
})().catch(e=>{console.error(e);process.exitCode=1})
