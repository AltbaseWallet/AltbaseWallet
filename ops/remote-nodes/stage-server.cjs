'use strict'
// Loopback-only verification service for adapter reads and node connections.
const http=require('node:http')
const {createGrandpoolAdapters,createPrivateRemoteAdapters,attachPrivateRemoteProxy}=require('./grandpool.cjs')
const runtime=createPrivateRemoteAdapters(),adapters=new Map([...createGrandpoolAdapters(),...runtime.adapters].map(a=>[a.coin,a]))
const routes=new Map(),sendJson=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean),adapter=adapters.get(parts[2]);
 if(req.method==='GET'&&url.pathname==='/api/v1/health')return sendJson(res,200,{ok:true,coins:[...adapters.keys()]})
 if(req.method==='GET'&&adapter&&parts[3]==='network')return sendJson(res,200,{ok:true,...await adapter.getNetwork()})
 let text='';for await(const chunk of req){text+=chunk;if(text.length>1000000)throw Error('oversize')}
 const body=text?JSON.parse(text):{}
 if(req.method==='POST'&&adapter&&parts[3]==='address'&&['balance','history','utxos'].includes(parts[4])){
  const method={balance:'getBalance',history:'getHistory',utxos:'getUtxos'}[parts[4]];return sendJson(res,200,{ok:true,...await adapter[method](body.address,{limit:5})})
 }
 if(['submit_transaction','push_transaction'].includes(body.method))return sendJson(res,403,{ok:false,error:'Read-only staging'})
 const route=routes.get(url.pathname);if(route)return route({body},res)
 sendJson(res,404,{ok:false,error:'Unknown staging route'})
}catch(error){sendJson(res,502,{ok:false,error:error.message})}})
attachPrivateRemoteProxy(server,{post:(route,fn)=>routes.set(route,fn)},{sendJson},runtime)
server.listen(36684,'127.0.0.1')
