'use strict'
const path=require('node:path')
const runtimes=new Map(),pending=new Map()
let sessionRevision=0
const COINS=new Set(['zcash','nexa','xelis','mwc'])
const METHODS=new Set(['derive','validate','plan','sign','send','snapshot','status','export'])
const requestCoinSdk=async(request,context={})=>{
  const {coin,method,params}=request||{}
  const revision=sessionRevision
  if(!COINS.has(coin)||!METHODS.has(method))throw new Error('Unsupported coin SDK operation')
  if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Invalid coin SDK parameters')
  let runtime=runtimes.get(coin)
  if(!runtime){
    const sdk=require(`./coin-sdks/${coin}.cjs`)
    if(sdk.createRuntime){
      const binary=coin==='xelis'?'xelis_wallet':'mwc-wallet',suffix=process.platform==='win32'?'.exe':''
      const directory=path.join(context.resources,'coin-runtimes',`${process.platform}-${process.arch}`,coin)
      runtime=sdk.createRuntime({baseDir:path.join(context.userData,'local-wallets',coin),binary:path.join(directory,binary+suffix),consoleHelper:path.join(directory,'altbase-private-console.exe'),nodeUrl:`https://api.altbase.io/api/v1/${coin}/daemon`,getNetwork:async()=>{
        const response=await fetch(`https://api.altbase.io/api/v1/${coin}/network`,{signal:AbortSignal.timeout(20000)})
        if(!response.ok)throw new Error('Current remote node status is unavailable')
        const data=await response.json();return data.network??data
      }})
    }else runtime=sdk
    runtimes.set(coin,runtime)
  }
  if(typeof runtime[method]!=='function')throw new Error('Unsupported operation for this coin')
  // Serialize state-changing local calls. Snapshot reads must remain available
  // during a recovery scan; send errors are never retried.
  if(['derive','send','sign'].includes(method)){
    const operation=(pending.get(coin)||Promise.resolve()).catch(()=>{}).then(()=>{if(revision!==sessionRevision)throw new Error('Wallet session closed');return runtime[method](params)})
    pending.set(coin,operation);try{return await operation}finally{if(pending.get(coin)===operation)pending.delete(coin)}
  }
  return runtime[method](params)
}
const closeCoinSdks=async()=>{++sessionRevision;pending.clear();const current=[...runtimes.values()];runtimes.clear();await Promise.allSettled(current.map(runtime=>runtime.close?.()))}
module.exports={requestCoinSdk,closeCoinSdks}
