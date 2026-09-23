import { rolldown } from 'rolldown'
import { builtinModules } from 'node:module'
import { mkdir } from 'node:fs/promises'
const external=new Set([...builtinModules,...builtinModules.map(id=>'node:'+id)])
await mkdir('electron/coin-sdks',{recursive:true})
for(const coin of ['zcash','nexa','xelis','mwc']){
  const bundle=await rolldown({input:`modules/${coin}/runtime/index.cjs`,platform:'node',external:id=>external.has(id)})
  await bundle.write({file:`electron/coin-sdks/${coin}.cjs`,format:'cjs',sourcemap:false})
  await bundle.close()
}
