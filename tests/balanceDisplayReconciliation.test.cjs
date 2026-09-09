const test=require('node:test'),assert=require('node:assert/strict'),{createJiti}=require('jiti');
const jiti=createJiti(__filename),{privacyBalanceDisplay}=jiti('../src/utils/privacyBalanceDisplay.ts');
const {walletSnapshotService}=jiti('../src/services/walletSnapshotService.ts');
const {walletService}=jiti('../src/services/walletService.ts');
const {allCoins}=jiti('../src/services/coinService.ts');
test('BCH2 portfolio keeps the funded cashaddr rather than querying its empty legacy index',async t=>{
 const address='bitcoincashii:qq7ty96yha3waz7vsf32wastmag47k283y3jfk4q9m';
 t.mock.method(walletService,'getWalletAddresses',()=>({bitcoincashii:address}));
 const coin=allCoins().find(c=>c.id==='bitcoincashii');
 const items=await walletSnapshotService.buildItems([{...coin,address}]);
 assert.deepEqual(items,[{coin:'bitcoincashii',addresses:[address]}]);
 const fixture=new Map([[address,9996000],['16XvtUxPtGuNA7jTQ1tvaghVJV47cWooi3',0]]);
 assert.equal(fixture.get(items[0].addresses[0]),9996000);
});
test('unfinished and unavailable privacy reads cannot be displayed as a verified zero',()=>{
 for(const readiness of ['unknown','syncing','error']){
  const d=privacyBalanceDisplay({id:'zano',status:'active',balance:'0'},readiness);
  assert.equal(d.unverified,true);assert.equal(d.hideZero,true);assert.notEqual(d.status,'active');
 }
 const pending=privacyBalanceDisplay({id:'monero',status:'active',balance:'0',recoveryProgress:{blocksRemaining:12}},'ready');
 assert.equal(pending.hideZero,true);
 const positive=privacyBalanceDisplay({id:'zano',status:'active',balance:'5.668'},'syncing');
 assert.equal(positive.hideZero,false);assert.equal(positive.unverified,true);
 assert.deepEqual(privacyBalanceDisplay({id:'monero',status:'active',balance:'0'},'ready'),{unverified:false,hideZero:false,status:'active'});
});
