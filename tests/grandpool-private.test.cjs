'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),WebSocket=require('ws')
const {generateMnemonic}=require('@scure/bip39'),{wordlist}=require('@scure/bip39/wordlists/english')
const {createPrivateRemoteAdapters,attachPrivateRemoteProxy,assertCalls,XELIS_METHODS}=require('../ops/remote-nodes/adapters/privateRemote.cjs')
const keys=require('../modules/xelis/runtime/keys.cjs'),mwc=require('../modules/mwc/runtime/index.cjs')
const xelis=require('../modules/xelis/runtime/index.cjs')
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)))
test('Private chains: public proxy cannot accept private wallet commands',()=>{
 for(const method of ['open_wallet','create_wallet','build_transaction','sign_data','get_seed'])assert.throws(()=>assertCalls({jsonrpc:'2.0',id:1,method},XELIS_METHODS))
 assert.doesNotThrow(()=>assertCalls({jsonrpc:'2.0',id:1,method:'get_info'},XELIS_METHODS))
 assert.throws(()=>assertCalls([],XELIS_METHODS))
})
test('Private chains: remote adapters never substitute zero for encrypted balances',async()=>{
 for(const adapter of createPrivateRemoteAdapters().adapters)await assert.rejects(adapter.getBalance('fixture'),/local privacy wallet/)
})
test('Private chains: HTTP reads fail over; broadcasts have one attempt',async t=>{
 let firstCalls=0,secondCalls=0
 const first=http.createServer((req,res)=>{firstCalls++;res.writeHead(503);res.end('{}')})
 const second=http.createServer((req,res)=>{secondCalls++;res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:true}))})
 const a=await listen(first),b=await listen(second);t.after(()=>{first.closeAllConnections();second.closeAllConnections();first.close();second.close()})
 const read=createPrivateRemoteAdapters({xelisUrls:[`http://127.0.0.1:${a}`,`http://127.0.0.1:${b}`]}).xelisRpc
 assert.equal((await read({jsonrpc:'2.0',id:1,method:'get_info'})).result,true)
 assert.equal(firstCalls,1);assert.equal(secondCalls,1)
 const write=createPrivateRemoteAdapters({xelisUrls:[`http://127.0.0.1:${a}`,`http://127.0.0.1:${b}`]}).xelisRpc
 await assert.rejects(write({jsonrpc:'2.0',id:1,method:'submit_transaction',params:{data:'fixture'}}));assert.equal(firstCalls,2);assert.equal(secondCalls,1)
})
test('Xelis: WebSocket proxy preserves text frames and subscription replies',async t=>{
 const upstream=http.createServer(),wss=new WebSocket.Server({server:upstream})
 wss.on('connection',socket=>socket.on('message',(data,binary)=>{assert.equal(binary,false);const q=JSON.parse(data);socket.send(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{topoheight:123}}))}))
 const p=await listen(upstream),server=http.createServer()
 attachPrivateRemoteProxy(server,{post(){}},{},createPrivateRemoteAdapters({xelisUrls:[`http://127.0.0.1:${p}`]}))
 const port=await listen(server),client=new WebSocket(`ws://127.0.0.1:${port}/api/v1/xelis/daemon/json_rpc`)
 t.after(()=>{client.terminate();for(const s of wss.clients)s.terminate();wss.close();upstream.close();server.close();upstream.closeAllConnections();server.closeAllConnections()})
 await once(client,'open');client.send(JSON.stringify({jsonrpc:'2.0',id:7,method:'get_info'}))
 const [data,binary]=await once(client,'message');assert.equal(binary,false);assert.equal(JSON.parse(data).result.topoheight,123)
 client.send(JSON.stringify({jsonrpc:'2.0',id:8,method:'open_wallet'}));assert.equal((await once(client,'close'))[0],1008)
})
test('Xelis: separate seeds derive separate valid recoverable addresses',()=>{
 const a=keys.derive(generateMnemonic(wordlist)),b=keys.derive(generateMnemonic(wordlist))
 try{assert.ok(keys.validate(a.address));assert.ok(keys.validate(b.address));assert.notEqual(a.address,b.address);assert.equal(a.nativeMnemonic.split(' ').length,25);assert.equal(keys.validate(a.address.slice(0,-1)+(a.address.endsWith('q')?'p':'q')),false)}finally{a.key.fill(0);b.key.fill(0)}
})
test('Xelis: incoming, outgoing and mining history conserve atomic values',()=>{
 const rows=[{hash:'a',topoheight:10,timestamp:100000,incoming:{from:'sender',transfers:[{asset:'0'.repeat(64),amount:123456789}]}},{hash:'b',topoheight:11,timestamp:110000,outgoing:{fee:25000,transfers:[{asset:'0'.repeat(64),amount:100000000,destination:'recipient'}]}},{hash:'c',topoheight:12,timestamp:120000,coinbase:{reward:500000000}}]
 const h=xelis.history('own',rows,20)
 assert.deepEqual(h.deltas.map(d=>d.satoshis),['123456789','-100025000','500000000']);assert.equal(h.transactions[1].fee,'0.00025');assert.equal(h.transactions[1].vout[0].value,'1')
})
test('MWC: cancelled and reverted entries do not become confirmed balances/history',()=>{
 const row={id:1,amount_credited:'1000000000',amount_debited:'0',fee:null,creation_ts:'2026-09-23T12:00:00Z',output_height:100,tx_type:'TxReceived',confirmed:false,tx_slate_id:'fixture'}
 const h=mwc.history('own',[row,{...row,id:2,tx_type:'TxReceivedCancelled'},{...row,id:3,tx_type:'TxReverted'}],110)
 assert.equal(h.mempool.length,1);assert.equal(h.deltas.length,0);assert.equal(h.transactions[0].confirmations,0)
 const confirmed=mwc.history('own',[{...row,confirmed:true}],110)
 assert.equal(confirmed.deltas[0].satoshis,'1000000000');assert.equal(confirmed.transactions[0].confirmations,11)
})
