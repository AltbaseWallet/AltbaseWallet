'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net')
const u=require('@bitgo/utxo-lib')
const {createRemoteUtxoAdapter,decimalAtoms,atoms}=require('../ops/remote-nodes/adapters/remoteUtxo.cjs')
const {requestEndpoint,createElectrumClient}=require('../ops/remote-nodes/lib/electrumClient.cjs')
const address=u.payments.p2pkh({hash:Buffer.alloc(20,1)}).address
const txid='ab'.repeat(32)
const provider=extra=>({network:async()=>({blocks:1000}),balance:async()=>({confirmed:'100000',unconfirmed:'0'}),utxos:async()=>[{tx_hash:txid,tx_pos:0,value:100000,height:990}],transaction:async()=>({vin:[{coinbase:'01'}],vout:[]}),...extra})
const adapter=p=>createRemoteUtxoAdapter({coin:'bitcoin',network:u.networks.bitcoin,provider:p})
test('Remote UTXO: immature mining rewards never enter MAX',async()=>{
  const a=adapter(provider()),b=await a.getBalance(address)
  assert.equal(b.balance,'100000');assert.equal(b.immature,'100000');assert.equal(b.balance_spendable,'0')
  assert.deepEqual((await a.getUtxos(address)).utxos,[])
})
test('Remote UTXO: mature mining rewards become spendable',async()=>{
  const a=adapter(provider({utxos:async()=>[{tx_hash:txid,tx_pos:0,value:'100000',height:899}]}))
  assert.equal((await a.getBalance(address)).balance_spendable,'100000')
  assert.equal((await a.getUtxos(address)).utxos.length,1)
})
test('Remote UTXO: upstream failures do not become zero balances',async()=>{
  const a=adapter(provider({utxos:async()=>{throw new Error('node unavailable')}}))
  await assert.rejects(a.getBalance(address),/node unavailable/)
  await assert.rejects(adapter(provider({balance:async()=>({})})).getBalance(address),/invalid atomic amount/)
})
test('Remote UTXO: amounts remain exact for PPC and scientific notation',()=>{
  assert.equal(decimalAtoms('0.000001',6),1n);assert.equal(decimalAtoms(1e-8,8),1n)
  assert.equal(decimalAtoms('900719925.47409931',8),90071992547409931n)
  assert.throws(()=>decimalAtoms('0.0000001',6),/precision/)
  assert.throws(()=>atoms(90071992547409931),/exact JSON integer/)
})
test('Electrum: identifies client and ignores unsolicited notifications',async t=>{
  const server=net.createServer(socket=>{
    let pending=''
    socket.on('data',data=>{pending+=data;while(pending.includes('\n')){
      const at=pending.indexOf('\n'),msg=JSON.parse(pending.slice(0,at));pending=pending.slice(at+1)
      if(msg.id===0){assert.equal(msg.method,'server.version');socket.write(JSON.stringify({method:'blockchain.relayfee',params:[0.00001]})+'\n'+JSON.stringify({id:0,result:['fixture','1.4']})+'\n')}
      else socket.write(JSON.stringify({id:1,result:{confirmed:17,unconfirmed:0}})+'\n')
    }})
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  assert.equal((await requestEndpoint({host:'127.0.0.1',port:server.address().port,tls:false},'blockchain.scripthash.get_balance',['fixture'])).confirmed,17)
})
test('Electrum: retries reads but never retries an uncertain broadcast',async()=>{
  const calls=[];const rpc=createElectrumClient([{host:'first'},{host:'second'}],async e=>{calls.push(e.host);throw new Error('lost connection')})
  await assert.rejects(rpc('read'));assert.deepEqual(calls,['first','second']);calls.length=0
  await assert.rejects(rpc('broadcast',[],{write:true}));assert.deepEqual(calls,['first'])
})
test('Peercoin: explicit non-coinbase flag does not hide immature coinstake',async()=>{
 const p=provider({blockbook:true,utxos:async()=>[{tx_hash:txid,tx_pos:1,value:'100000',height:990,coinbase:false}],transaction:async()=>({vin:[{txid:'cd'.repeat(32),vout:0}],vout:[{isAddress:false,addresses:[],value:'0'},{value:'100000'}]})})
 const a=createRemoteUtxoAdapter({coin:'peercoin',network:u.networks.bitcoin,provider:p,maturity:500})
 assert.equal((await a.getBalance(address)).balance_spendable,'0')
 assert.equal((await a.getBalance(address)).immature,'100000')
})
test('Nexa: zero-input coinbase transactions remain immature for 5000 confirmations',async()=>{
 const n=require('libnexa-ts'),{createNexaRemoteAdapter}=require('../ops/remote-nodes/adapters/nexaRemote.cjs')
 const address=n.PrivateKey.fromBuffer(Buffer.alloc(32,7)).toAddress().toString()
 const a=createNexaRemoteAdapter({request:async(url,method)=>{
  if(method==='blockchain.headers.subscribe')return{height:10000}
  if(method==='blockchain.address.listunspent')return[{tx_hash:txid,outpoint_hash:'cd'.repeat(32),tx_pos:0,height:9999,value:'1000000000'}]
  if(method==='blockchain.address.get_balance')return{confirmed:'1000000000',unconfirmed:'0'}
  if(method==='blockchain.transaction.get')return{vin:[],vout:[]}
  throw new Error('Unexpected RPC '+method)
 }})
 const balance=await a.getBalance(address)
 assert.equal(balance.balance_spendable,'0');assert.equal(balance.immature,'1000000000');assert.deepEqual((await a.getUtxos(address)).utxos,[])
})
test('Remote UTXO: raw previous transactions are available for legacy input proofs',async()=>{
 const a=adapter(provider({rawTransaction:async id=>{assert.equal(id,txid);return '0100000001'}}))
 assert.equal(await a.getRawTransaction(txid),'0100000001')
 await assert.rejects(a.getRawTransaction('invalid'),/Invalid transaction id/)
 await assert.rejects(adapter(provider({rawTransaction:async()=>undefined})).getRawTransaction(txid),/raw transaction proof/)
})
test('Rostrum: many reads share one socket and an uncertain broadcast is never replayed',async t=>{
 const WS=require('ws'),{createRostrumClient}=require('../ops/remote-nodes/lib/rostrumClient.cjs')
 const server=new WS.Server({port:0,host:'127.0.0.1'});await new Promise(r=>server.on('listening',r));let sockets=0,broadcasts=0
 server.on('connection',socket=>{sockets++;socket.on('message',bytes=>{const m=JSON.parse(bytes);if(m.method==='blockchain.transaction.broadcast'){broadcasts++;socket.terminate();return}socket.send(JSON.stringify({id:m.id,result:m.id===0?['fixture','1.4']:m.params[0]}))})})
 const rpc=createRostrumClient('wss://fixture.invalid',{connect:()=>new WS('ws://127.0.0.1:'+server.address().port),idleMs:50})
 t.after(()=>{rpc.close();server.close()})
 const results=await Promise.all(Array.from({length:100},(_,i)=>rpc('blockchain.transaction.get',[i])))
 assert.equal(results.length,100);assert.equal(results[99],99);assert.equal(sockets,1)
 await assert.rejects(rpc('blockchain.transaction.broadcast',['fixture']),/disconnected/)
 assert.equal(broadcasts,1);assert.equal(sockets,1)
})
test('Blockbook: an unfinished index cannot produce a verified zero or stale spendable outputs',async()=>{
 let syncing=true
 const a=adapter(provider({blockbook:true,network:async()=>({blocks:1000,headers:1002,initialBlockDownload:syncing}),balance:async()=>({confirmed:'0',unconfirmed:'0'}),history:async()=>[],utxos:async()=>[]}))
 for(const read of [()=>a.getBalance(address),()=>a.getUtxos(address),()=>a.getHistory(address)])await assert.rejects(read(),/index is still synchronizing/)
 syncing=false
 assert.equal((await a.getBalance(address)).balance,'0')
 assert.deepEqual((await a.getUtxos(address)).utxos,[])
})
test('Electrum: a wrong-chain server cannot answer wallet balance requests',async t=>{
 const {createElectrumProvider}=require('../ops/remote-nodes/adapters/remoteUtxo.cjs');let genesis='wrong',balanceCalls=0
 const server=net.createServer(socket=>{let text='';socket.on('data',bytes=>{text+=bytes;while(text.includes('\n')){const end=text.indexOf('\n'),m=JSON.parse(text.slice(0,end));text=text.slice(end+1);let result
  if(m.method==='server.version')result=['fixture','1.4']
  else if(m.method==='server.features')result={genesis_hash:genesis}
  else if(m.method==='blockchain.scripthash.get_balance'){balanceCalls++;result={confirmed:7,unconfirmed:0}}
  else throw Error('Unexpected fixture RPC '+m.method)
  socket.write(JSON.stringify({id:m.id,result})+'\n')
 }})})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close())
 const p=createElectrumProvider({endpoints:[{host:'127.0.0.1',port:server.address().port,tls:false}],codec:{script:()=>Buffer.from('51','hex')},genesisHash:'expected'})
 await assert.rejects(p.balance('fixture'),/genesis/);assert.equal(balanceCalls,0)
 genesis='expected';assert.equal((await p.balance('fixture')).confirmed,7);assert.equal(balanceCalls,1)
})
