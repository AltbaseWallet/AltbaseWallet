'use strict'
const WebSocket=require('ws')
const requestRostrum=(url,method,params=[],timeoutMs=9000)=>new Promise((resolve,reject)=>{
  if(!url.startsWith('wss://'))return reject(new Error('Rostrum requires secure WebSocket transport'))
  const ws=new WebSocket(url,{handshakeTimeout:timeoutMs,maxPayload:16*1024*1024,rejectUnauthorized:true})
  let settled=false,identified=false
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);ws.terminate();error?reject(error):resolve(result)}
  const timer=setTimeout(()=>finish(new Error('Rostrum request timed out')),timeoutMs)
  ws.on('error',error=>finish(error));ws.on('close',()=>finish(new Error('Rostrum closed before replying')))
  ws.on('open',()=>ws.send(JSON.stringify({id:0,method:'server.version',params:['Altbase/0.1.9','1.4']})))
  ws.on('message',data=>{
    let message;try{message=JSON.parse(data)}catch{return finish(new Error('Invalid Rostrum JSON'))}
    if(message.id===0&&!identified){
      if(message.error)return finish(new Error('Rostrum protocol negotiation failed'))
      identified=true;ws.send(JSON.stringify({id:1,method,params}));return
    }
    if(message.id!==1||!identified)return
    if(message.error)return finish(new Error(message.error.message||'Rostrum RPC error'))
    if(!Object.hasOwn(message,'result'))return finish(new Error('Rostrum omitted result'))
    finish(null,message.result)
  })
})
module.exports={requestRostrum}

// Share one authenticated transport across bounded concurrent reads. Opening a
// fresh TLS socket for every immature mining output made 1,000-output wallets
// exceed the API timeout. Requests are never replayed after a disconnect.
const createRostrumClient=(url,{connect=address=>new WebSocket(address,{handshakeTimeout:9000,maxPayload:16*1024*1024,rejectUnauthorized:true}),timeoutMs=9000,idleMs=1000}={})=>{
  if(!url.startsWith('wss://'))throw new Error('Rostrum requires secure WebSocket transport')
  let socket=null,opening=null,sequence=0,idle=null
  const pending=new Map()
  const scheduleClose=()=>{clearTimeout(idle);if(!pending.size)idle=setTimeout(()=>{const old=socket;socket=null;old?.close()},idleMs)}
  const ensure=()=>{
    clearTimeout(idle)
    if(socket?.readyState===WebSocket.OPEN&&socket.identified)return Promise.resolve(socket)
    if(opening)return opening
    opening=new Promise((resolve,reject)=>{
      const ws=connect(url);socket=ws
      const timer=setTimeout(()=>{reject(new Error('Rostrum protocol negotiation timed out'));ws.terminate()},timeoutMs)
      const fail=error=>{clearTimeout(timer);if(socket===ws){socket=null;opening=null}reject(error);for(const [id,entry] of pending){if(entry.ws===ws){clearTimeout(entry.timer);pending.delete(id);entry.reject(error)}}}
      ws.on('error',error=>fail(error));ws.on('close',()=>fail(new Error('Rostrum disconnected before replying')))
      ws.on('open',()=>ws.send(JSON.stringify({id:0,method:'server.version',params:['Altbase/0.1.9','1.4']})))
      ws.on('message',data=>{
        let msg;try{msg=JSON.parse(data)}catch{return fail(new Error('Invalid Rostrum JSON'))}
        for(const message of Array.isArray(msg)?msg:[msg]){
          if(message.id===0&&!ws.identified){if(message.error){fail(new Error('Rostrum protocol negotiation failed'));ws.terminate();return}clearTimeout(timer);ws.identified=true;opening=null;resolve(ws);continue}
          const entry=pending.get(message.id);if(!entry||entry.ws!==ws)continue
          clearTimeout(entry.timer);pending.delete(message.id)
          if(message.error)entry.reject(new Error(message.error.message||'Rostrum RPC error'))
          else if(!Object.hasOwn(message,'result'))entry.reject(new Error('Rostrum omitted result'))
          else entry.resolve(message.result)
          scheduleClose()
        }
      })
    })
    return opening
  }
  const call=async(method,params=[])=>{
    const ws=await ensure();clearTimeout(idle)
    if(pending.size>=128)throw new Error('Too many outstanding Rostrum requests')
    return new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Rostrum request timed out'));scheduleClose()},timeoutMs)
      pending.set(id,{resolve,reject,timer,ws})
      ws.send(JSON.stringify({id,method,params}),error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);scheduleClose()}})
    })
  }
  call.close=()=>{clearTimeout(idle);socket?.terminate()}
  return call
}
module.exports.createRostrumClient=createRostrumClient
