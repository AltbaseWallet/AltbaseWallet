'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {bundle,create}=require('./bundle-helper.cjs')
async function fixture(stored={},priceSnapshot){
  const noop=()=>{},data=new Map([['pending-outgoing-reservations:fixture',stored]])
  const api=await bundle('src/store/coinStore.ts',{
    zustand:{create},'coin-modules':{coinModuleRegistry:{isPlugin:()=>true}},
    'services/coinService':{coinService:{saveRuntimeCoins:async coins=>coins}},
    'services/coinApiService':{coinApiService:{getPrices:async()=>priceSnapshot},atomicAmountToBigInt:v=>BigInt(v??0),networkToStatus:()=> 'active'},
    'services/localWalletSnapshot':{isLocalWalletCoin:()=>false},
    'services/privacyWalletService':{privacyWalletService:{onNativeReadinessChange:noop,onNativeRuntimeSnapshot:noop}},'services/privacyBirthService':{privacyBirthService:{}},
    'services/storageService':{storageService:{get:(k,f)=>data.get(k)??f,set:(k,v)=>data.set(k,v)}},
    'services/walletService':{walletService:{getWalletStorageScope:()=> 'fixture',getSessionRevision:()=>0}},
    'services/walletSnapshotService':{walletSnapshotService:{}},
    'store/transactionStore':{useTransactionStore:{getState:()=>({})}},
    'wallet-engines/registry':{walletEngineRegistry:{}},
    'utils/quaiDebugLog':{coinDebugLog:noop,quaiDebugLog:noop,quaiDebugLogError:noop},
    'utils/walletAddressOwnership':{isWalletAddressVariant:async()=>false},
    'utils/privacyCoins':{isPrivacyCoin:()=>false},'utils/accountCoins':{isAccountCoin:()=>true},'utils/utxoCoins':{isUtxoCoin:()=>false},
  })
  return api.useCoinStore
}
const transaction=(coinId='coin-a',txHash='AbCd')=>({id:`${coinId}-${txHash}`,coinId,txHash,type:'outgoing',status:'pending',amount:'1',fee:'0.1',from:'CaseAddress',to:'caseaddress',createdAt:new Date().toISOString()})
test('outgoing reservations distinguish the coin and case-sensitive plugin transaction ID',async()=>{
  const store=await fixture()
  store.getState().syncPendingOutgoingReservations([transaction(),transaction('coin-b'),transaction('coin-a','abcd')])
  assert.deepEqual(Object.keys(store.getState().reservedOutgoing).sort(),['coin-a:AbCd','coin-a:abcd','coin-b:AbCd'])
  store.getState().releaseOutgoingReservation('coin-a','AbCd')
  assert.deepEqual(Object.keys(store.getState().reservedOutgoing).sort(),['coin-a:abcd','coin-b:AbCd'])
})
test('old hash-only reservation keys migrate without dropping reservation metadata',async()=>{
  const store=await fixture({AbCd:{...transaction(),balanceBefore:'10',expectedBalanceAfter:'8.9'}})
  assert.equal(store.getState().reservedOutgoing['coin-a:AbCd'].expectedBalanceAfter,'8.9')
})
test('case-different non-EVM addresses do not turn an outgoing balance delta into a self-transfer',async()=>{
  const store=await fixture()
  store.setState({coins:[{id:'coin-a',walletEngine:'plugin',balance:'10',spendableBalance:'10',satsPerCoin:1e8}]})
  await store.getState().applyTransactionBalanceDelta(transaction())
  assert.equal(store.getState().coins[0].balance,'8.9')
  assert.equal(store.getState().reservedOutgoing['coin-a:AbCd'].internal,false)
})
test('quote refresh revalues a plugin-only wallet while balance scans remain busy',async()=>{
  const store=await fixture({}, {prices:{'coin-a':2},updatedAt:Date.now()})
  store.setState({refreshing:true,coins:[{id:'coin-a',walletEngine:'plugin',balance:'3',spendableBalance:'2',fiatValue:99999}]})
  await store.getState().refreshPrices()
  const coin=store.getState().coins[0]
  assert.equal(coin.balance,'3');assert.equal(coin.spendableBalance,'2');assert.equal(coin.fiatValue,6)
  assert.equal(store.getState().refreshing,true)
})
