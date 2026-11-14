'use strict'
// Regenerate every static asset surface from one public metadata file.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = __dirname, directory = path.join(root, 'public')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'asset-catalog.json'), 'utf8'))
const featuredIds = ['ethereum','bsc','polygon','arbitrum','solana','tron']
const ids = new Set(catalog.assets.map(a => a.id)), slugs = new Set(catalog.assets.map(a => a.slug))
if (ids.size !== catalog.assets.length || slugs.size !== ids.size) throw Error('Duplicate public asset IDs or slugs')
for (const a of [...catalog.assets,...catalog.archivedAssets]) {
 if (!/^[a-z0-9-]+$/.test(a.id) || !/^[a-z0-9-]+$/.test(a.slug) || !a.icon.startsWith('assets/img/') || a.icon.includes('..')) throw Error('Invalid public asset metadata')
}
if (catalog.assets.some(a => ['HRC','MYDOGE','NNN','BTGS'].includes(a.ticker))) throw Error('Delisted asset in active catalog')
const featured = featuredIds.map(id => {const a=catalog.assets.find(a=>a.id===id);if(!a)throw Error('Missing current network');return a})
const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
function visit(folder) {
 return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e => {
  if (/wallet[ _-]?secret/i.test(e.name) || e.isSymbolicLink()) return []
  const file=path.join(folder,e.name)
  return e.isDirectory()?visit(file):e.isFile()&&e.name.endsWith('.html')?[file]:[]
 })
}
const files=visit(directory), home=path.join(directory,'index.html')
if (process.argv.includes('--check')) {
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(directory,'assets/js/asset-catalog.js'),'utf8'),context)
 if (JSON.stringify(context.window.AltbaseAssetCatalog)!==JSON.stringify(catalog)) throw Error('Generated public catalog is stale')
 if (JSON.stringify(JSON.parse(fs.readFileSync(path.join(directory,'assets/data/asset-catalog.json'),'utf8')))!==JSON.stringify(catalog)) throw Error('Server fallback catalog is stale')
 for (const file of files) {
  const text=fs.readFileSync(file,'utf8'), found=[...text.matchAll(/data-network-id="([a-z0-9-]+)"/g)].map(m=>m[1]).sort()
  if (JSON.stringify(found)!==JSON.stringify([...featuredIds].sort())) throw Error('Network footer is stale: '+path.relative(root,file))
 }
 const matches=[...fs.readFileSync(home,'utf8').matchAll(/data-site-asset="([a-z0-9-]+)"/g)].map(m=>m[1])
 if (matches.length!==ids.size*2 || [...ids].some(id=>matches.filter(i=>i===id).length!==2)) throw Error('Homepage marquee is stale')
 console.log(JSON.stringify({passed:true,publicPages:files.length,activeAssets:ids.size,marqueeCards:matches.length}));process.exit(0)
}
const ordered=[catalog.assets[0],...featured,...catalog.assets.slice(1).filter(a=>!featuredIds.includes(a.id))], groupSize=Math.ceil(ordered.length/3)
function card(a,copy){return `<a class="coin-card" data-site-asset="${a.id}" href="/assets/${a.slug}"${copy?' tabindex="-1"':''}><img src="${escape(a.icon)}" alt=""><div><h3>${escape(a.name)}</h3><p>${escape(a.ticker)}</p></div></a>`}
let marquee='<div class="coin-marquee" aria-label="Supported asset list">'
for(let i=0;i<3;i++){
 const group=ordered.slice(i*groupSize,(i+1)*groupSize)
 marquee+=`<div class="coin-marquee-row ${i%2===0?'is-rtl':'is-ltr'}"><div class="coin-marquee-track">${group.map(a=>card(a,false)).join('')}</div><div class="coin-marquee-track" aria-hidden="true">${group.map(a=>card(a,true)).join('')}</div></div>`
}
marquee+='</div>'
const footer='<div class="footer-networks" data-site-networks><strong>New networks</strong><div>'+featured.map(a=>`<a data-network-id="${a.id}" href="/assets/${a.slug}"><img src="/${escape(a.icon)}" width="20" height="20" alt=""><span>${escape(a.name)}</span><small>${escape(a.ticker)}</small></a>`).join('')+'</div><a href="/assets">View all supported networks</a></div>'
for(const file of files){
 let text=fs.readFileSync(file,'utf8');if(!text.includes('data-site-networks'))throw Error('Missing network surface')
 text=text.replace(/<div class="footer-networks"[\s\S]*?(?=<div class="footer-bottom")/,footer+'\n      ')
 if(file===home){const start=text.indexOf('          <div class="coin-marquee"'),end=text.indexOf('\n        </div>\n      </section>',start);if(start<0||end<0)throw Error('Missing marquee boundary');text=text.slice(0,start)+'          '+marquee+text.slice(end)}
 text=text.replace(/data-asset-count>\d+ \/ \d+/,`data-asset-count>${ids.size} / ${ids.size}`)
 fs.writeFileSync(file,text)
}
fs.mkdirSync(path.join(directory,'assets/data'),{recursive:true});fs.writeFileSync(path.join(directory,'assets/data/asset-catalog.json'),JSON.stringify(catalog,null,2)+'\n')
fs.writeFileSync(path.join(directory,'assets/js/asset-catalog.js'),'// One public catalog shared by asset pages, listings and the homepage preview.\nwindow.AltbaseAssetCatalog = '+JSON.stringify(catalog,null,2)+';\n')
console.log(JSON.stringify({generated:true,publicPages:files.length,activeAssets:ids.size}))
