'use strict'
// Pinned official reference wallets. Recovery data is never part of these files.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),output=path.join(root,'coin-runtimes'),cache=process.env.ALTBASE_REFERENCE_CACHE||path.join(os.homedir(),'.cache','altbase','reference-wallets')
const value=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)
const platform=({windows:'win32',macos:'darwin'})[value('target')]||value('target')||process.platform,arch=value('arch')||process.arch
const targets=platform==='darwin'&&arch==='universal'?['darwin-x64','darwin-arm64']:[`${platform}-${arch}`]
const pins={
 xelis:{version:'1.25.0',repository:'https://github.com/xelis-project/xelis-blockchain.git',commit:'db59b5c246ab0e40386d6c241dcd77f0aea84b10',binary:'xelis_wallet',package:'xelis_wallet',license:'REFERENCE-WALLET.txt',assets:{
  'linux-x64':['https://github.com/xelis-project/xelis-blockchain/releases/download/v1.25.0/x86_64-unknown-linux-gnu.tar.gz','424ac65de320a835b4cbe2c2a8b9140b12e8bab86cf5ebda89ffee024947135e'],
  'win32-x64':['https://github.com/xelis-project/xelis-blockchain/releases/download/v1.25.0/x86_64-pc-windows-msvc.zip','c1c3494793bc492da84d6c1b82bda4bf225bc9e71198e91e5bd70fd1bcc26127'],
 }},
 mwc:{version:'6.0.1',repository:'https://github.com/mwcproject/mwc-wallet.git',commit:'2fb156ac2952b61b59887a020465ba0d10ae0c53',binary:'mwc-wallet',package:'mwc_wallet',license:'REFERENCE-WALLET.txt',assets:{
  'linux-x64':['https://github.com/mwcproject/mwc-wallet/releases/download/6.0.1/mwc-wallet-6.0.1-linux-x64.tar.gz','c9e3322c9d8d6847398b161fe04ba55dc96c6a62da5807d32674d87108bb0b18'],
  'win32-x64':['https://github.com/mwcproject/mwc-wallet/releases/download/6.0.1/mwc-wallet-6.0.1-win-x64.zip','2f88fd4a0ea39f6b0fd7fde32571ef5794da95be1c47d583903054c085634a59'],
  'darwin-x64':['https://github.com/mwcproject/mwc-wallet/releases/download/6.0.1/mwc-wallet-6.0.1-macos-x64.tar.gz','eddd30160626c1bb619cd8296dc2aaa4aafede5e968761fa3c968003b89a6887'],
 }}
}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const run=(cmd,args,cwd=cache)=>{const r=spawnSync(cmd,args,{cwd,stdio:'inherit',shell:false,env:{...process.env,CARGO_BUILD_JOBS:'1',NUM_JOBS:'1'}});if(r.error)throw r.error;if(r.status!==0)throw new Error(cmd+' failed')}
const find=(dir,name)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isFile()&&e.name===name)return p;if(e.isDirectory()){const f=find(p,name);if(f)return f}}}
const main=async()=>{
 fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(output,{recursive:true})
 const manifestPath=path.join(output,'manifest.json');let manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):[]
 const record=(coin,target,filename,version,component)=>{const data={coin,platform:target,version,path:path.relative(output,filename).split(path.sep).join('/'),sha256:hash(filename),size:fs.statSync(filename).size,...(component?{component}:{})};manifest=manifest.filter(e=>e.path!==data.path);manifest.push(data);fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n')}
 for(const target of targets){
  if(!['linux-x64','win32-x64','darwin-x64','darwin-arm64'].includes(target))throw new Error('Unsupported reference target: '+target)
  for(const [coin,pin] of Object.entries(pins)){
   const filename=pin.binary+(target.startsWith('win32')?'.exe':''),dest=path.join(output,target,coin,filename)
   const old=manifest.find(e=>e.path===path.relative(output,dest).split(path.sep).join('/'))
   if(old&&old.version===pin.version&&fs.existsSync(dest)&&hash(dest)===old.sha256)continue
   fs.mkdirSync(path.dirname(dest),{recursive:true});let source
   if(pin.assets[target]){
    const [url,digest]=pin.assets[target],archive=path.join(cache,path.basename(new URL(url).pathname)),extract=path.join(cache,coin+'-'+target+'-'+pin.version)
    if(!fs.existsSync(archive)||hash(archive)!==digest){const response=await fetch(url);if(!response.ok)throw new Error('Reference download HTTP '+response.status);fs.writeFileSync(archive,Buffer.from(await response.arrayBuffer()))}
    if(hash(archive)!==digest)throw new Error('Reference archive checksum mismatch: '+coin+' '+target)
    fs.mkdirSync(extract,{recursive:true})
    if(archive.endsWith('.zip')&&process.platform!=='win32')run('unzip',['-oq',archive,'-d',extract]);else run('tar',['-xf',archive,'-C',extract])
    source=find(extract,filename);if(!source)throw new Error('Reference archive omitted '+filename)
   }else{
    const checkout=path.join(cache,coin+'-'+pin.commit),rustTarget=target==='darwin-arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin'
    if(!fs.existsSync(path.join(checkout,'.git'))){run('git',['init',checkout]);run('git',['remote','add','origin',pin.repository],checkout)}
    run('git',['fetch','--depth=1','origin',pin.commit],checkout);run('git',['checkout','--detach',pin.commit],checkout)
    run('rustup',['target','add','--toolchain','1.97.0',rustTarget]);run('cargo',['+1.97.0','build','--release','--locked','--jobs','1','--target',rustTarget,'-p',pin.package],checkout)
    source=path.join(process.env.CARGO_TARGET_DIR||path.join(checkout,'target'),rustTarget,'release',filename)
   }
   fs.copyFileSync(source,dest);if(!target.startsWith('win32'))fs.chmodSync(dest,0o755)
   fs.copyFileSync(path.join(root,'modules',coin,'licenses',pin.license),path.join(path.dirname(dest),'LICENSE.txt'));record(coin,target,dest,pin.version)
  }
  if(target==='win32-x64'){
   const dest=path.join(output,target,'mwc','altbase-private-console.exe'),source=path.join(root,'modules','mwc','native','private_console.c')
   run(process.env.ALTBASE_MINGW_CC||'x86_64-w64-mingw32-gcc',['-O2','-Wall','-Wextra','-municode','-static',source,'-o',dest]);record('mwc',target,dest,'0.1.9','console-helper')
  }
 }
 process.stdout.write('Reference wallets verified: '+targets.join(', ')+'\n')
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
