'use strict'
const fs=require('node:fs'),net=require('node:net'),path=require('node:path'),crypto=require('node:crypto')
const {spawn,spawnSync}=require('node:child_process')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})
const waitFor=async(check,child,timeout=30000)=>{const start=Date.now();let error;while(Date.now()-start<timeout){if(child.exitCode!==null||child.signalCode||child.killed||child._altbaseSpawnError)throw new Error('Local wallet process exited during startup');try{return await check()}catch(e){error=e}await delay(200)}throw new Error('Local wallet startup timed out'+(error?.code?' ('+error.code+')':''))}
// The recovery phrase/password travel through a private OS pipe. A config file
// containing secrets is never written, and command-line arguments contain paths only.
const spawnWithPrivateConfig=async(binary,config,dir)=>{
  await fs.promises.mkdir(dir,{recursive:true,mode:0o700})
  let server,pipe,writePromise
  if(process.platform==='win32'){
    pipe='\\\\.\\pipe\\altbase-wallet-'+crypto.randomUUID()
    server=net.createServer(socket=>{socket.end(JSON.stringify(config));server.close()})
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve)})
  }else{
    pipe=path.join(dir,'startup-'+crypto.randomUUID()+'.pipe')
    const result=spawnSync('mkfifo',['-m','600',pipe],{stdio:'ignore',shell:false})
    if(result.status!==0)throw new Error('Unable to create a private wallet configuration pipe')
  }
  const child=spawn(binary,['--config-file',pipe],{cwd:dir,stdio:'ignore',windowsHide:true,shell:false,env:{...process.env,TOKIO_WORKER_THREADS:'1'}})
  child.on('error',error=>{child._altbaseSpawnError=error.code||'spawn failed'})
  if(process.platform!=='win32')writePromise=(async()=>{
    // A blocking open() would leave a worker stuck if the child died before
    // opening the FIFO. Retry O_NONBLOCK only while the child is alive.
    const deadline=Date.now()+30000;let handle
    while(Date.now()<deadline&&child.exitCode===null){
      try{handle=await fs.promises.open(pipe,fs.constants.O_WRONLY|fs.constants.O_NONBLOCK);break}
      catch(e){if(e.code!=='ENXIO')throw e;await delay(25)}
    }
    if(!handle)throw new Error('Local wallet configuration handshake timed out')
    try{await handle.writeFile(JSON.stringify(config))}finally{await handle.close()}
  })().finally(()=>fs.promises.unlink(pipe).catch(()=>{}))
  const clean=()=>{server?.close();if(process.platform!=='win32')fs.promises.unlink(pipe).catch(()=>{})}
  child.once('exit',clean);child.once('error',clean)
  writePromise?.catch(()=>{})
  return child
}
const readRpc=async(url,method,params,authorization,timeout=20000)=>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeout)})
  if(!response.ok)throw new Error('Local wallet RPC HTTP '+response.status)
  const body=await response.json()
  if(body.error){const error=new Error('Local wallet '+method+' failed ('+body.error.code+')');error.rpcCode=body.error.code;throw error}
  if(!Object.hasOwn(body,'result'))throw new Error('Local wallet omitted RPC result')
  return body.result
}
const stopProcess=async child=>{
  if(!child||child.exitCode!==null||child.signalCode||child._altbaseSpawnError)return
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},5000);timer.unref()
    child.once('exit',()=>{clearTimeout(timer);resolve()});child.kill('SIGTERM')
  })
}
module.exports={freePort,waitFor,spawnWithPrivateConfig,readRpc,delay,stopProcess}
