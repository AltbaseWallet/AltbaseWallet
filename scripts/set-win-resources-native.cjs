'use strict'
// Edit PE resources directly so cross packaging does not depend on a Wine prefix.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {NtExecutable,NtExecutableResource,Data,Resource}=require('resedit')
const root=path.resolve(__dirname,'..'),pkg=require(path.join(root,'package.json')),file=path.join(root,process.env.ALTBASE_RELEASE_DIR||'release','win-unpacked','Altbase Wallet.exe')
const exe=NtExecutable.from(fs.readFileSync(file),{ignoreCert:true}),resources=NtExecutableResource.from(exe)
const integrity=resources.entries.filter(e=>e.type==='INTEGRITY').map(e=>({...e,bin:Buffer.from(e.bin)}))
const icon=Data.IconFile.from(fs.readFileSync(path.join(root,'build/icon.ico')))
const groups=resources.entries.filter(e=>e.type===14)
for(const group of groups.length?groups:[{id:1,lang:1033}])Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icon.icons.map(i=>i.data))
const versions=Resource.VersionInfo.fromEntries(resources.entries)
if(!versions.length)throw new Error('Executable omitted its version resource')
const numbers=pkg.version.split('.').map(Number)
for(const v of versions){
 v.setFileVersion(...numbers,0,1033);v.setProductVersion(...numbers,0,1033)
 v.setStringValues({lang:1033,codepage:1200},{CompanyName:'Altbase',FileDescription:'Altbase Wallet',InternalName:'Altbase Wallet',LegalCopyright:'Copyright (C) 2026 Altbase. All rights reserved.',OriginalFilename:'Altbase Wallet.exe',ProductName:'Altbase Wallet'})
 v.outputToResourceEntries(resources.entries)
}
resources.outputResource(exe)
const temporary=file+'.resources.tmp';fs.writeFileSync(temporary,Buffer.from(exe.generate()))
const checked=NtExecutableResource.from(NtExecutable.from(fs.readFileSync(temporary)))
for(const entry of integrity){const actual=checked.entries.find(e=>e.type===entry.type&&e.id===entry.id&&e.lang===entry.lang);assert.ok(actual,'Electron ASAR integrity resource retained');assert.ok(Buffer.from(actual.bin).equals(entry.bin),'Electron integrity bytes retained')}
assert.equal(Resource.VersionInfo.fromEntries(checked.entries)[0].getStringValues({lang:1033,codepage:1200}).FileVersion,pkg.version+'.0')
fs.renameSync(temporary,file)
console.log('Windows icon and version updated; ASAR integrity resources preserved')
