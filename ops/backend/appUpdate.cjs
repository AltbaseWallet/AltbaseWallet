'use strict'
const compare=(left,right)=>{
 const a=String(left).split('.').map(Number),b=String(right).split('.').map(Number)
 for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]||0,y=b[i]||0;if(x!==y)return x>y?1:-1}
 return 0
}
// A platform without a new build keeps its last published release. Never
// advertise the wallet's global version against an older platform download.
function appUpdatePayload(configuration={}, {currentVersion='0.0.0',platform='unknown'}={}) {
 const selected=configuration.platforms&&Object.hasOwn(configuration.platforms,platform)?configuration.platforms[platform]:null
 const update=selected&&typeof selected==='object'?selected:configuration
 const latestVersion=String(update.latestVersion||'0.1.5')
 const base=String(update.filesBaseUrl||`https://github.com/AltbaseWallet/AltbaseWallet/releases/download/v${latestVersion}`).replace(/\/$/,'')
 return {
  updateAvailable:compare(latestVersion,currentVersion)>0,currentVersion,latestVersion,
  required:update.required===true,platform,
  downloadUrl:update.downloadUrl||'https://altbase.io/download',
  releaseNotesUrl:update.releaseNotesUrl||update.downloadUrl||'https://altbase.io/download',
  message:'A new version of Altbase Wallet is available.',
  files:update.files&&typeof update.files==='object'?update.files:{windows:base+'/Altbase-Wallet-Windows.zip',linux:base+'/Altbase-Wallet-Ubuntu24.AppImage',macos:base+'/Altbase-Wallet-macOS-x64.zip'},
 }
}
module.exports={appUpdatePayload}
