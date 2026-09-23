import {rolldown} from 'rolldown'
import {builtinModules} from 'node:module'
import {mkdir} from 'node:fs/promises'
const external=new Set([...builtinModules,...builtinModules.map(name=>'node:'+name)])
await mkdir('ops/remote-nodes/dist',{recursive:true})
const bundle=await rolldown({input:'ops/remote-nodes/grandpool-bundle-entry.cjs',platform:'node',external:name=>external.has(name)||['bufferutil','utf-8-validate'].includes(name)})
await bundle.write({file:'ops/remote-nodes/dist/grandpool.cjs',format:'cjs'})
await bundle.close()
