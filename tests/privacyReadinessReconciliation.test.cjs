const test=require('node:test'),assert=require('node:assert/strict'),{createJiti}=require('jiti');
global.window = {};
const jiti=createJiti(__filename);
const {privacyWalletService}=jiti('../src/services/privacyWalletService.ts');
const {nativeCoreService}=jiti('../src/services/nativeCoreService.ts');
const {privacyCacheService}=jiti('../src/services/privacyCacheService.ts');
const {privacyBirthService}=jiti('../src/services/privacyBirthService.ts');
const {zanoScanReadiness}=jiti('../src/utils/zanoScanReadiness.ts');
const fixture='invalid-fixture-no-wallet';
for(const coin of ['monero','epic','zano']) test(`${coin}: a failed read invalidates ready status and a fresh complete read restores it`,async t=>{
 t.mock.method(privacyCacheService,'load',async()=>null);
 t.mock.method(privacyCacheService,'saveFromSnapshot',async()=>undefined);
 t.mock.method(privacyBirthService,'restoreStartHeight',async()=>1);
 let next;
 t.mock.method(nativeCoreService,'privacyLightWallet',async request=>{assert.equal(request.action,'snapshot');if(next instanceof Error)throw next;return next});
 const completed={ok:true,code:`${coin}-native-wallet`,balance:'0',spendable:'0',lastScannedHeight:100,serverStatus:JSON.stringify({ok:true,ready:true,blocks:100,headers:100})};
 privacyWalletService.resetNativeReadiness(coin);
 t.after(()=>privacyWalletService.resetNativeReadiness(coin));
 for(const failure of [{ok:false,code:'native-core-error',error:'Timeout was reached'},new Error('fixture transport timeout')]){
  next=completed;await privacyWalletService.getSnapshot(coin,fixture);assert.equal(privacyWalletService.getNativeReadiness(coin),'ready');
  next=failure;
  if(failure instanceof Error)await assert.rejects(privacyWalletService.getSnapshot(coin,fixture),/fixture transport timeout/);
  else await privacyWalletService.getSnapshot(coin,fixture);
  assert.equal(privacyWalletService.getNativeReadiness(coin),'error');
 }
 next=completed;await privacyWalletService.getSnapshot(coin,fixture);assert.equal(privacyWalletService.getNativeReadiness(coin),'ready');
 if(coin==='zano') {
  next={...completed,lastScannedHeight:90};await privacyWalletService.getSnapshot(coin,fixture);
  assert.equal(privacyWalletService.getNativeReadiness(coin),'syncing');
 }
});
test('Zano native success at an old scan height or with unavailable scan-info is not current balance evidence',()=>{
 const completed={ok:true,code:'zano-native-wallet',balance:'5.668',spendable:'5.668',lastScannedHeight:3832430,serverStatus:JSON.stringify({ok:true,ready:true,blocks:3851297,headers:3851297})};
 assert.equal(zanoScanReadiness(completed),'syncing');
 assert.equal(zanoScanReadiness({...completed,serverStatus:'server scan-info unavailable: Timeout was reached'}),'error');
 assert.equal(zanoScanReadiness({...completed,serverStatus:undefined}),'syncing');
 assert.equal(zanoScanReadiness({...completed,lastScannedHeight:3851297}),'ready');
});
