'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),source=path.join(root,'coin-runtimes'),stage=path.join(root,'coin-runtimes-stage')
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=')[1]
const target=arg('target')||process.platform,arch=arg('arch')||process.arch
const platform=({windows:'win32',macos:'darwin'})[target]||target
const platforms=platform==='darwin'&&arch==='universal'?['darwin-x64','darwin-arm64']:[`${platform}-${arch}`]
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'))
const entries=manifest.filter(entry=>platforms.includes(entry.platform))
for(const selected of platforms)for(const coin of ['xelis','mwc']){
  if(!entries.some(entry=>entry.platform===selected&&entry.coin===coin&&entry.component!=='console-helper'))throw new Error(`Missing ${selected} ${coin} runtime; run scripts/prepare-coin-runtimes.cjs first`)
}
if(platform==='win32'&&!entries.some(entry=>entry.component==='console-helper'))throw new Error('The Windows MWC private console helper is missing')
for(const entry of entries){
  const file=path.resolve(source,entry.path)
  if(!file.startsWith(source+path.sep))throw new Error('Invalid runtime manifest path')
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if(hash!==entry.sha256)throw new Error('Runtime checksum mismatch: '+entry.path)
}
fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true})
for(const selected of platforms)fs.cpSync(path.join(source,selected),path.join(stage,selected),{recursive:true})
fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(entries,null,2)+'\n')
process.stdout.write(`Staged verified reference wallets for ${platforms.join(', ')}\n`)
