'use strict'
const XELIS_METHODS=new Set(['get_version','get_info','get_pruned_topoheight','get_asset','get_account_assets','count_assets','get_assets','get_balance','get_balance_at_topoheight','get_balances_at_maximum_topoheight','get_block_at_topoheight','get_transaction','get_transaction_executor','get_nonce','is_tx_executed_in_block','get_mempool_cache','is_account_registered','get_stable_topoheight','get_estimated_fee_per_kb','get_stable_balance','has_multisig','get_multisig','get_contract_logs','get_contracts_outputs','subscribe','unsubscribe','submit_transaction'])
const MWC_METHODS=new Set(['get_version','get_tip','get_block','get_header','get_kernel','get_outputs','get_unspent_outputs','get_pmmr_indices','get_height_range_to_pmmr_indices','push_transaction'])
const assertCalls=(payload,methods)=>{
  const calls=Array.isArray(payload)?payload:[payload]
  if(calls.length<1||calls.length>100)throw new Error('Invalid RPC batch size')
  for(const call of calls)if(!call||call.jsonrpc!=='2.0'||!methods.has(call.method))throw new Error('Unsupported public node method')
  return calls
}
const createPrivateRemoteAdapters=({xelisUrls=['https://fr-node.xelis.io','https://us-node.xelis.io'],mwcUrls=['https://mwc713.mwc.mw','https://mwc7132.mwc.mw','https://mwc7134.mwc.mw'],mwcAuthorization=process.env.MWC_NODE_AUTH,onDiagnostic}={})=>{
  const proxy=(urls,route,methods,authorization)=>{
    let preferred=0
    return async payload=>{
      const calls=assertCalls(payload,methods),write=calls.some(c=>['submit_transaction','push_transaction'].includes(c.method)),start=preferred
      let error
      for(let i=0;i<(write?1:urls.length);i++){
        const index=(start+i)%urls.length
        try{
          const response=await fetch(urls[index]+route,{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)})
          if(!response.ok)throw new Error(`Remote private-chain node HTTP ${response.status}`)
          const result=await response.json();preferred=index;return result
        }catch(e){error=e}
      }
      throw error
    }
  }
  const xelisRpc=proxy(xelisUrls,'/json_rpc',XELIS_METHODS),mwcRpc=proxy(mwcUrls,'/v2/foreign',MWC_METHODS,mwcAuthorization)
  const localOnly=async()=>{throw new Error('This balance requires the local privacy wallet; node responses contain no public spendable balance')}
  const common={preserveAtomicBalances:true,getBalance:localOnly,getUtxos:localOnly,getHistory:localOnly,estimateFee:localOnly,broadcastTx:localOnly,validateAddress:localOnly}
  const xelis={...common,coin:'xelis',async getNetwork(){
    const r=await xelisRpc({jsonrpc:'2.0',id:1,method:'get_info'}),v=r.result
    if(r.error||!Number.isSafeInteger(v?.topoheight)||v.topoheight<1||v.network!=='mainnet')throw new Error('Incomplete Xelis mainnet status')
    return{chain:'xelis-mainnet',blocks:v.topoheight,headers:v.topoheight,topoheight:v.topoheight,stableTopoheight:v.stable_topoheight,initialBlockDownload:false,verificationProgress:1,version:v.version}
  }}
  const mwc={...common,coin:'mwc',async getNetwork(){
    const r=await mwcRpc({jsonrpc:'2.0',id:1,method:'get_tip',params:[]}),v=r.result?.Ok
    if(r.error||!Number.isSafeInteger(v?.height)||v.height<1)throw new Error('Incomplete MWC mainnet status')
    return{chain:'mwc-mainnet',blocks:v.height,headers:v.height,bestBlockHash:v.last_block_pushed,initialBlockDownload:false,verificationProgress:1}
  }}
  return{adapters:[xelis,mwc],xelisRpc,mwcRpc,xelisUrls,onDiagnostic}
}
const attachPrivateRemoteProxy=(server,router,{readJsonBody,sendJson},runtime)=>{
  for(const [route,proxy] of [['/api/v1/xelis/daemon/json_rpc',runtime.xelisRpc],['/api/v1/mwc/daemon/v2/foreign',runtime.mwcRpc]]){
    router.post(route,async({body},response)=>{try{sendJson(response,200,await proxy(body))}catch{sendJson(response,502,{jsonrpc:'2.0',id:null,error:{code:-32000,message:'Remote node unavailable'}})}})
  }
  const WebSocket=require('ws'),wss=new WebSocket.Server({noServer:true,maxPayload:2000000})
  let upstreamIndex=0
  server.on('upgrade',(request,socket,head)=>{
    if(request.url?.split('?')[0]!=='/api/v1/xelis/daemon/json_rpc')return
    wss.handleUpgrade(request,socket,head,client=>{
      const endpoint=runtime.xelisUrls[upstreamIndex++%runtime.xelisUrls.length].replace('https:','wss:')+'/json_rpc'
      const upstream=new WebSocket(endpoint,{handshakeTimeout:10000,maxPayload:32000000,rejectUnauthorized:true})
      const pending=[],methodsById=new Map();let queuedBytes=0
      const close=()=>{client.terminate();upstream.terminate()}
      client.on('error',close);upstream.on('error',close);client.on('close',()=>upstream.terminate());upstream.on('close',()=>client.close(1011,'Remote node disconnected'))
      client.on('message',data=>{
        try{const calls=assertCalls(JSON.parse(data),XELIS_METHODS);for(const call of calls){if(methodsById.size>1000)methodsById.delete(methodsById.keys().next().value);methodsById.set(call.id,call.method)}}catch{client.close(1008,'Unsupported public node method');return}
        if(upstream.readyState===WebSocket.OPEN){if(upstream.bufferedAmount>2000000)return close();upstream.send(data,{binary:false})}
        else{queuedBytes+=data.length;if(pending.length>=100||queuedBytes>2000000)return close();pending.push(data)}
      })
      upstream.on('open',()=>{for(const message of pending)upstream.send(message,{binary:false});pending.length=0;queuedBytes=0})
      upstream.on('message',data=>{if(runtime.onDiagnostic){try{const replies=JSON.parse(data);for(const reply of Array.isArray(replies)?replies:[replies]){runtime.onDiagnostic({event:'xelis-rpc',method:methodsById.get(reply.id),errorCode:reply.error?.code});if(!reply.error)methodsById.delete(reply.id)}}catch{}}if(client.readyState===WebSocket.OPEN){if(client.bufferedAmount>32000000)return close();client.send(data,{binary:false})}})
    })
  })
}
module.exports={createPrivateRemoteAdapters,attachPrivateRemoteProxy,assertCalls,XELIS_METHODS,MWC_METHODS}
