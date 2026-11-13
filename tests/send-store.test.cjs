'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { bundle, create, deferred } = require('./bundle-helper.cjs')
class MockBroadcastError extends Error { constructor(message, txid, uncertain) { super(message); this.txid = txid; this.uncertain = uncertain } }
async function fixture(engine = 'plugin') {
  const genericUtxo = engine === 'pearl-utxo' || engine === 'utxo'
  const noop=()=>{}, stored=new Map(), calls=[]
  const coin={id:'new-coin',name:'Fixture',ticker:'TEST',walletEngine:engine,satsPerCoin:100000000,balance:'10',spendableBalance:'10',status:'active',address:'CaseAddress',enabled:true}
  const hooks={lookup:async()=>coin,send:async p=>({txid:'fixture-only',amountCoin:p.amountCoin,feeCoin:'0.1'}),ready:'ready',mnemonic:'NOT_A_REAL_SEED'}
  const coinState={coins:[coin],applyTransactionBalanceDelta:async tx=>{calls.push({delta:tx});return true},syncPendingOutgoingReservations:noop,
    releaseOutgoingReservation:noop,restoreCoinBalance:async()=>{},loadCoins:async()=>{}}
  const api=await bundle('src/store/transactionStore.ts',{
    zustand:{create},'services/coinService':{coinService:{getCoinById:()=>hooks.lookup(),getCoins:async()=>[coin]},cryptoParamsFor:()=>{if(genericUtxo)return{};throw Error('Legacy UTXO route must not run')}},
    'services/coinApiService':{coinApiService:{getBalance:async()=>({balance:'1000000000'})},atomicAmountToBigInt:v=>BigInt(v||0),mapHistoryResponseToTransactions:noop},
    'services/coinTxService':{coinTxService:{send:p=>{if(!genericUtxo)throw Error('Legacy UTXO route must not run');calls.push({send:true,excludeOutpoints:p.excludeOutpoints});return hooks.send(p)}},UtxoBroadcastError:class extends Error{}},
    'services/privacyCacheService':{privacyCacheService:{}},'services/privacyWalletService':{privacyWalletService:{}},
    'services/quaiWalletService':{quaiWalletService:{estimateFee:async()=>({coin:'0.1'}),send:p=>{calls.push({send:true});return hooks.send(p)}}},'services/walletSnapshotService':{walletSnapshotService:{}},
    'services/walletService':{walletService:{getWalletStorageScope:()=> 'fixture-scope',getSessionRevision:()=>0,getWalletAddresses:()=>({'new-coin':'CaseAddress'}),getSessionMnemonic:()=>hooks.mnemonic}},
    'services/storageService':{storageService:{get:(k,f)=>stored.get(k)??f,set:(k,v)=>stored.set(k,v),removeByPrefix:noop}},
    'store/coinStore':{useCoinStore:{getState:()=>coinState}},
    'services/pluginReadiness':{pluginReadiness:{get:()=>hooks.ready}},
    'wallet-engines/registry':{walletEngineRegistry:{get:()=>({id:engine==='utxo'?'bitcoin-utxo':engine,send:p=>{calls.push({send:true});return hooks.send(p)}}),isPrivacy:()=>false,isAccount:()=>!genericUtxo,isUtxo:()=>genericUtxo}},
    'utils/quaiDebugLog':{coinDebugLog:noop,quaiDebugLog:noop,quaiDebugLogError:noop},
    'utils/walletAddressOwnership':{isWalletAddressVariant:noop},
    'utils/broadcastOutcome':{BroadcastError:MockBroadcastError},
  },{setTimeout:()=>0,clearTimeout:noop})
  return {store:api.useTransactionStore,hooks,calls,stored,coin,payload:{coinId:coin.id,to:'caseaddress',amount:'1',mnemonic:hooks.mnemonic,maxFee:'0.1'}}
}
test('the real transaction store dispatches a new coin to its plugin and preserves address case',async()=>{
  const {store,payload,calls}=await fixture()
  const tx=await store.getState().sendTransaction(payload)
  assert.equal(tx.txHash,'fixture-only');assert.equal(tx.internal,false);assert.equal(tx.expectedBalanceAfter,'8.9')
  assert.equal(calls.filter(x=>x.send).length,1);assert.equal(store.getState().sending,false)
})
for (const engine of ['xelis-local','mwc-local','zcash-utxo','nexa-utxo']) test(`${engine} sends use their registered engine, without falling back to generic UTXO signing`,async()=>{
  const {store,payload,calls}=await fixture(engine)
  const tx=await store.getState().sendTransaction(payload)
  assert.equal(tx.txHash,'fixture-only');assert.equal(tx.internal,false)
  assert.equal(calls.filter(x=>x.send).length,1)
})
test('two sends racing before the first lookup resolves cannot both invoke an engine',async()=>{
  const {store,hooks,payload,calls,coin}=await fixture(),wait=deferred();hooks.lookup=()=>wait.promise
  const first=store.getState().sendTransaction(payload)
  await assert.rejects(store.getState().sendTransaction(payload),/still in progress/)
  wait.resolve(coin);await first;assert.equal(calls.filter(x=>x.send).length,1)
})
test('unverified plugin balance blocks the store even if the UI caller bypasses its disabled button',async()=>{
  const {store,hooks,payload,calls}=await fixture();hooks.ready='error'
  await assert.rejects(store.getState().sendTransaction(payload),/not ready/)
  assert.equal(calls.length,0);assert.equal(store.getState().sending,false)
})
test('module failure releases the send mutex and is not replayed',async()=>{
  const {store,hooks,payload,calls}=await fixture();hooks.send=async()=>{throw Error('uncertain fixture result')}
  await assert.rejects(store.getState().sendTransaction(payload),/uncertain/)
  assert.equal(calls.filter(x=>x.send).length,1);assert.equal(store.getState().sending,false)
})
for (const engine of ['pearl-utxo', 'utxo']) test(`${engine} allows other outputs while excluding every recorded pending input`, async () => {
  const f = await fixture(engine), reserved = [{ txid: 'ab'.repeat(32), vout: 0 }, { txid: 'cd'.repeat(32), vout: 2 }]
  f.store.setState({transactions:[{id:'prior',coinId:f.coin.id,type:'outgoing',amount:'1',status:'pending',txHash:'ef'.repeat(32),broadcastUncertain:true,createdAt:new Date().toISOString(),spentOutpoints:reserved,balanceBefore:'10'}]})
  await f.store.getState().sendTransaction(f.payload)
  const [call] = f.calls.filter(call => call.send)
  assert.deepEqual(JSON.parse(JSON.stringify(call.excludeOutpoints)), reserved)
  assert.equal(f.store.getState().transactions.find(tx=>tx.id==='prior').status, 'pending')
})
for (const inputs of [undefined, [], [{txid:'unknown',vout:0}], [{txid:'ab'.repeat(32),vout:-1}]]) test('unknown or invalid reserved UTXO inputs keep the pending guard', async () => {
  const f = await fixture('pearl-utxo')
  f.store.setState({transactions:[{id:'prior',coinId:f.coin.id,type:'outgoing',amount:'1',status:'pending',txHash:'ef'.repeat(32),broadcastUncertain:true,createdAt:new Date().toISOString(),spentOutpoints:inputs}]})
  await assert.rejects(f.store.getState().sendTransaction(f.payload), /pendingOutgoingLocked/)
  assert.equal(f.calls.filter(call=>call.send).length, 0)
})
test('account pending guard remains active even if an external record contains UTXO-like fields', async () => {
  const f = await fixture('qubic-account')
  f.store.setState({transactions:[{id:'prior',coinId:f.coin.id,type:'outgoing',amount:'1',status:'pending',txHash:'ef'.repeat(32),createdAt:new Date().toISOString(),spentOutpoints:[{txid:'ab'.repeat(32),vout:0}]}]})
  await assert.rejects(f.store.getState().sendTransaction(f.payload), /pendingOutgoingLocked/)
})
test('Xelis UI/store pending policy stays consistent after the old ten-minute UI timeout',async()=>{
 const f=await fixture('xelis-local')
 f.store.setState({transactions:[{id:'prior',coinId:f.coin.id,type:'outgoing',amount:'1',status:'pending',txHash:'ef'.repeat(32),broadcastUncertain:true,createdAt:new Date(Date.now()-12*60_000).toISOString()}]})
 await assert.rejects(f.store.getState().sendTransaction(f.payload),/pendingOutgoingLocked/)
 assert.equal(f.calls.filter(call=>call.send).length,0)
})
test('late module send result cannot be written into a different wallet profile',async()=>{
  const {store,hooks,payload,calls}=await fixture(),waiting=deferred(),started=deferred()
  hooks.send=()=>{started.resolve();return waiting.promise}
  const operation=store.getState().sendTransaction(payload),rejected=assert.rejects(operation,/session changed/)
  await started.promise;hooks.mnemonic=null;waiting.resolve({txid:'fixture-only'})
  await rejected;assert.equal(store.getState().transactions.length,0);assert.equal(calls.filter(x=>x.delta).length,0)
})
for (const engine of ['quai-account', 'qubic-account', 'xgr-account', 'ckb-cell', 'zcash-utxo', 'nexa-utxo', 'xelis-local']) {
  test(`${engine} preserves its prepared transaction on an uncertain submission and prevents replay`, async () => {
    const f = await fixture(engine)
    f.hooks.send = async params => {
      await params.onPrepared({ txid: 'checkpoint-fixture', amountCoin: '1', feeCoin: '0.1' })
      throw new MockBroadcastError('fixture relay timeout', 'checkpoint-fixture', true)
    }
    await assert.rejects(f.store.getState().sendTransaction(f.payload), /status is uncertain/)
    const [tx] = f.store.getState().transactions
    assert.equal(tx.txHash, 'checkpoint-fixture'); assert.equal(tx.broadcastUncertain, true)
    assert.equal(tx.status, 'pending')
    await assert.rejects(f.store.getState().sendTransaction(f.payload), /pendingOutgoingLocked/)
    assert.equal(f.calls.filter(c => c.send).length, 1)
  })
  test(`${engine} removes an unsubmitted checkpoint after an explicit deterministic rejection`, async () => {
    const f = await fixture(engine)
    f.hooks.send = async params => {
      await params.onPrepared({ txid: 'rejected-fixture', amountCoin: '1', feeCoin: '0.1' })
      throw new MockBroadcastError('fixture rejection', 'rejected-fixture', false)
    }
    await assert.rejects(f.store.getState().sendTransaction(f.payload), /fixture rejection/)
    assert.equal(f.store.getState().transactions.length, 0)
  })
  test(`${engine} cannot commit a delayed checkpoint into a changed wallet session`, async () => {
    const f = await fixture(engine), started = deferred(), released = deferred()
    f.hooks.send = async params => {
      started.resolve(); await released.promise
      await params.onPrepared({ txid: 'stale-fixture', amountCoin: '1', feeCoin: '0.1' })
      return { txid: 'stale-fixture' }
    }
    const operation = f.store.getState().sendTransaction(f.payload), rejected = assert.rejects(operation, /session changed/)
    await started.promise; f.hooks.mnemonic = null; released.resolve(); await rejected
    assert.equal(f.store.getState().transactions.length, 0)
  })
}
for (const engine of ['xgr-account', 'qubic-account']) test(`${engine} self-transfers preserve balance when identity text differs only by case`, async () => {
  const f = await fixture(engine)
  f.hooks.send = async p => {
    const prepared = { txid: 'self-fixture', amountCoin: p.amountCoin, feeCoin: '0' }
    await p.onPrepared(prepared); return prepared
  }
  const tx = await f.store.getState().sendTransaction(f.payload)
  assert.equal(tx.internal, true); assert.equal(tx.expectedBalanceAfter, '10')
})
