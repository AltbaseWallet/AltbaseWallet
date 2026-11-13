'use strict'
// Linux-only universal assembly. Builds must already have passed both native preflights.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),base=path.join(root,'local-checks/macos-package'),product=require('../package.json').productName
const x64=path.join(base,'darwin-x64/mac',product+'.app'),arm=path.join(base,'darwin-arm64/mac-arm64',product+'.app')
const output=path.join(root,'artifacts/mac-universal',product+'.app'),toolchain=require('./macos-toolchain.cjs').macosToolchain('darwin-arm64')
const targets=['darwin-x64','darwin-arm64'],apps=[x64,arm],read=file=>JSON.parse(fs.readFileSync(file,'utf8'))
function write(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n')}
for(const app of apps)if(!fs.existsSync(app))throw Error('Build both macOS applications before universal assembly: '+app)
const receipts=targets.map(target=>read(path.join(root,'local-checks/vault-builds',target+'.json')))
for(const app of apps){
 const resources=path.join(app,'Contents/Resources'),plugins=path.join(resources,'coin-plugins'),metadata=path.join(plugins,'_core/runtime-package.json')
 write(metadata,{...read(metadata),target:'darwin-universal',targets})
 write(path.join(plugins,'_core/vault-build.json'),{schemaVersion:1,target:'darwin-universal',targets,builtFromProjectSource:true,perArchitectureBeforeUniversalMergeAndSigning:receipts})
 for(const directory of fs.readdirSync(plugins)){
  const file=path.join(plugins,directory,'manifest.json');if(!fs.existsSync(file))continue
  const entry=read(file);if(entry.nativeRuntime){entry.nativeRuntime.target='darwin-universal';entry.nativeRuntime.targets=targets;write(file,entry)}
 }
 for(const target of targets){const directory=path.join(resources,'native-plugin-host/bin',target);fs.mkdirSync(directory,{recursive:true});fs.copyFileSync(path.join(root,'native-plugin-host/bin',target,'altbase_plugin_host'),path.join(directory,'altbase_plugin_host'));fs.chmodSync(path.join(directory,'altbase_plugin_host'),0o755)}
}
const wrappers=path.join(base,'tools');fs.mkdirSync(wrappers,{recursive:true})
fs.writeFileSync(path.join(wrappers,'lipo'),'#!/usr/bin/env node\nimport {spawnSync} from "node:child_process"; const r=spawnSync('+JSON.stringify(toolchain.lipo)+',process.argv.slice(2),{stdio:"inherit",env:{...process.env,...'+JSON.stringify(toolchain.environment)+'}});if(r.error)throw r.error;process.exit(r.status??1)\n',{mode:0o755})
process.env.PATH=wrappers+path.delimiter+process.env.PATH
async function main(){
 const {makeUniversalApp}=await import('@electron/universal')
 if (!process.argv.includes('--sign-only')) await makeUniversalApp({x64AppPath:x64,arm64AppPath:arm,outAppPath:output,force:false,mergeASARs:true,singleArchFiles:'**/node_modules/secp256k1/prebuilds/darwin-*/**',x64ArchFiles:'**/{native-plugin-host/bin/darwin-*/**,node_modules/secp256k1/prebuilds/darwin-*/**}'})
 else if (!fs.existsSync(output)) throw Error('No assembled universal application to sign')
 const license=process.env.ALTBASE_OPENSSL_LICENSE||path.join(require('node:os').homedir(),'.cache/altbase-build/macos-deps/sources/openssl-3.5.9/LICENSE.txt')
 const licenseTarget=path.join(output,'Contents/Resources/third-party/OpenSSL-3.5.9-LICENSE.txt')
 fs.mkdirSync(path.dirname(licenseTarget),{recursive:true});fs.copyFileSync(license,licenseTarget)
 const entitlements=path.join(base,'entitlements.plist')
 fs.writeFileSync(entitlements,'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.allow-dyld-environment-variables</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>')
 function signBinaries(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
   if (/wallet[ _-]?secret/i.test(entry.name)) throw Error('Protected source path in macOS application')
   const file=path.join(directory,entry.name)
   if (entry.isSymbolicLink()) continue
   if (entry.isDirectory()) { signBinaries(file); continue }
   if (!entry.isFile()) throw Error('Unsupported macOS package entry')
   const header=Buffer.alloc(4),fd=fs.openSync(file,'r');let count
   try { count=fs.readSync(fd,header,0,4,0) } finally { fs.closeSync(fd) }
   if(count!==4||![0xcffaedfe,0xcafebabe,0xcafebabf].includes(header.readUInt32BE(0)))continue
   const signed=spawnSync(toolchain.codesign,['sign',file],{stdio:'inherit'})
   if(signed.error)throw signed.error;if(signed.status!==0)throw Error('Nested Mach-O ad-hoc signing failed')
  }
 }
 signBinaries(output)
 const result=spawnSync(toolchain.codesign,['sign','--entitlements-xml-path',entitlements,output],{stdio:'inherit'})
 if(result.error)throw result.error;if(result.status!==0)throw Error('Universal application ad-hoc signing failed')
 console.log(JSON.stringify({passed:true,universalApplication:output,targets,sourceCompilerPlatform:'linux',personalSigningCertificateUsed:false}))
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
