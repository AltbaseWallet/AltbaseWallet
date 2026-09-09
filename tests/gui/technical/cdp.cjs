'use strict'
const fs=require('node:fs');
const WebSocket=require('ws');
async function connect(port){
 const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
 const target=targets.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);if(!target)throw Error('Missing renderer');
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j)});
 let seq=0;const pending=new Map();socket.on('message',raw=>{const m=JSON.parse(raw);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},45000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
 const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text||'GUI evaluation failed');return r.result?.value};
 const wait=async(predicate,label,ms=30000)=>{const start=Date.now();while(Date.now()-start<ms){const v=await predicate();if(v)return v;await new Promise(r=>setTimeout(r,250))}throw Error('Timeout: '+label)};
 const screenshot=async(file)=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(file,Buffer.from(r.data,'base64'))};
 const click=async(selector)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return false;e.click();return true})()`);
 const snapshot=()=>evaluate(`({hash:location.hash,title:document.title,text:location.hash.includes('restore')?'Restore screen':(document.body?.innerText||'').slice(0,16000),buttons:[...document.querySelectorAll('button,a')].map(e=>({tag:e.tagName,text:e.textContent.trim(),disabled:e.disabled,href:e.getAttribute('href')}))})`);
 return {socket,call,evaluate,wait,screenshot,click,snapshot};
}
module.exports={connect};
if(require.main===module){(async()=>{const c=await connect(Number(process.argv[2]));try{if(process.argv[3]==='shot'){await c.screenshot(process.argv[4]);console.log('Screenshot saved')}else if(process.argv[3]==='eval')console.log(JSON.stringify(await c.evaluate(process.argv[4])));else console.log(JSON.stringify(await c.snapshot()))}finally{c.socket.close()}})().catch(e=>{console.error(e.message);process.exitCode=1})}
