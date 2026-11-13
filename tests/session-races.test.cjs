'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { bundle, create, deferred } = require('./bundle-helper.cjs')
async function walletFixture(engine = 'plugin') {
  const values = new Map(), hooks = { decrypt: async () => 'TEST_INPUT_IN_MEMORY', validate: async () => true, derive: async () => 'FIXTURE_ADDRESS', height: async () => 123 }
  const oldMeta={isCreated:true,version:2,verifyHash:'old-proof',verifySalt:'old-salt',walletFingerprint:'old-scope',encryptedMnemonic:{cipherText:'old-cipher',iv:'old-iv',salt:'old-salt'}}
  values.set('altbase_wallet:wallet-meta',JSON.stringify(oldMeta));values.set('altbase_wallet:wallet-addresses',JSON.stringify({old:'OLD_PUBLIC_ADDRESS'}))
  const native={generateMnemonic:async()=>hooks.decrypt(),validateMnemonic:()=>hooks.validate(),verifyWalletPassword:async()=>true,
    decryptWalletSecret:()=>hooks.decrypt(),createWalletSecret:async()=>({verifyHash:'new-proof',verifySalt:'new-salt',encryptedMnemonic:{cipherText:'new-cipher',iv:'new-iv',salt:'new-salt'}})}
  const noop=()=>{}
  hooks.coins=[{id:'fixture',walletEngine:engine}];hooks.kindOf=()=> 'account';hooks.ensure=async()=>({})
  const mocks={
    'services/nativeCoreService':{nativeCoreService:native},'services/coinService':{allCoins:()=>hooks.coins},
    'services/privacyWalletService':{privacyWalletService:{resetNativeReadiness:noop,ensureWallet:(...args)=>hooks.ensure(...args)}},'services/privacyBirthService':{privacyBirthService:{markRestoredWallet:noop,markCreatedWallet:noop,restoreStartHeight:()=>hooks.height()}},
    'services/walletScopeService':{getWalletStorageScope:()=> 'fixture-scope',walletFingerprintFromMnemonic:async()=> 'fixture-fingerprint'},
    'wallet-engines/registry':{walletEngineRegistry:{kindOf:()=>hooks.kindOf(),get:()=>({deriveAddress:()=>hooks.derive(),exportSecret:async()=> 'MOCK_VALUE_NOT_A_KEY'})}},
    'utils/quaiDebugLog':{coinDebugLog:noop,coinDebugLogError:noop},
  }
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  const api=await bundle('src/services/walletService.ts',mocks,{localStorage:storage,window:{altbaseWallet:{resetCoreSession:async()=>{}}},setTimeout:()=>0,clearTimeout:noop})
  return {wallet:api.walletService,hooks,values,storage,oldMeta,native}
}
test('one stalled privacy coin cannot delay publishing another receive address',async()=>{
 const {wallet,hooks,values}=await walletFixture(),stalled=deferred()
 hooks.coins=[{id:'epic',walletEngine:'epic-light'},{id:'zano',walletEngine:'zano-light'}];hooks.kindOf=()=> 'privacy'
 hooks.ensure=async coin=>coin==='epic'?{address:'PUBLIC_EPIC_FIXTURE'}:stalled.promise
 await wallet.unlockWallet('TEST_PASSWORD');wallet.warmPrivacyAddresses()
 for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))
 assert.equal(JSON.parse(values.get('altbase_wallet:wallet-addresses')).epic,'PUBLIC_EPIC_FIXTURE')
 assert.equal(JSON.parse(values.get('altbase_wallet:wallet-addresses')).zano,undefined)
 await wallet.lockWallet();stalled.resolve({address:'STALE_ZANO_FIXTURE'})
 for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))
 assert.equal(JSON.parse(values.get('altbase_wallet:wallet-addresses')).zano,undefined)
})
test('locking during authenticated profile-envelope conversion preserves the previous encrypted profile',async()=>{
  const {wallet,values,oldMeta,native}=await walletFixture(),prepared=deferred(),started=deferred()
  const previous={...oldMeta,verifySalt:'fullnode-scrypt-v1:fixture',encryptedMnemonic:{...oldMeta.encryptedMnemonic,salt:'fullnode-scrypt-v1:fixture'}}
  values.set('altbase_wallet:wallet-meta',JSON.stringify(previous))
  native.createWalletSecret=()=>{started.resolve();return prepared.promise}
  const operation=wallet.unlockWallet('TEST_PASSWORD'),rejected=assert.rejects(operation,/session changed/)
  await started.promise;await wallet.lockWallet()
  prepared.resolve({verifyHash:'new-proof',verifySalt:'new-salt',encryptedMnemonic:{cipherText:'new-cipher',iv:'new-iv',salt:'new-salt'}})
  await rejected
  assert.equal(values.get('altbase_wallet:wallet-meta'),JSON.stringify(previous))
  assert.equal(wallet.getSessionMnemonic(),null)
})
test('locking during decryption cannot revive a wallet session', async()=>{
  const {wallet,hooks}=await walletFixture(), decrypt=deferred();hooks.decrypt=()=>decrypt.promise
  const operation=wallet.unlockWallet('TEST_PASSWORD');const rejected=assert.rejects(operation,/session changed/)
  await Promise.resolve();await wallet.lockWallet();decrypt.resolve('TEST_INPUT_IN_MEMORY')
  await rejected;assert.equal(wallet.getSessionMnemonic(),null)
})
test('locking during address derivation invalidates the pending unlock',async()=>{
  const {wallet,hooks,values}=await walletFixture(), derive=deferred(),started=deferred()
  hooks.derive=()=>{started.resolve();return derive.promise}
  const operation=wallet.unlockWallet('TEST_PASSWORD');const rejected=assert.rejects(operation,/session changed/)
  await started.promise;await wallet.lockWallet();derive.resolve('STALE_PUBLIC_ADDRESS');await rejected
  assert.equal(wallet.getSessionMnemonic(),null);assert.equal(values.get('altbase_wallet:wallet-addresses'),JSON.stringify({old:'OLD_PUBLIC_ADDRESS'}))
})
test('cancelled restore cannot overwrite an existing profile after validation resolves',async()=>{
  const {wallet,hooks,values,oldMeta}=await walletFixture(), validation=deferred();hooks.validate=()=>validation.promise
  const operation=wallet.restoreWallet(Array(12).fill('fixture').join(' '),'TEST_PASSWORD')
  const rejected=assert.rejects(operation,/session changed/)
  await wallet.lockWallet();validation.resolve(true);await rejected
  assert.equal(values.get('altbase_wallet:wallet-meta'),JSON.stringify(oldMeta))
  assert.equal(values.get('altbase_wallet:wallet-addresses'),JSON.stringify({old:'OLD_PUBLIC_ADDRESS'}))
})
test('failed encryption verification preserves both profile and address map',async()=>{
  const {wallet,values,oldMeta}=await walletFixture()
  await assert.rejects(wallet.restoreWallet(Array(12).fill('fixture').join(' '),'TEST_PASSWORD'),/verification failed/)
  assert.equal(values.get('altbase_wallet:wallet-meta'),JSON.stringify(oldMeta))
  assert.equal(values.get('altbase_wallet:wallet-addresses'),JSON.stringify({old:'OLD_PUBLIC_ADDRESS'}))
})
test('profile transaction rolls back on a storage quota failure',async()=>{
  const values=new Map([['altbase_wallet:wallet-meta','old-meta'],['altbase_wallet:wallet-addresses','old-addresses']]);let failing=true
  const api=await bundle('src/services/storageService.ts',{}, {localStorage:{getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k),setItem:(k,v)=>{if(failing&&k.endsWith('wallet-addresses')){failing=false;throw Error('quota')}values.set(k,v)}}})
  assert.throws(()=>api.storageService.setMany({'wallet-meta':{new:true},'wallet-addresses':{new:true}}),/quota/)
  assert.equal(values.get('altbase_wallet:wallet-meta'),'old-meta');assert.equal(values.get('altbase_wallet:wallet-addresses'),'old-addresses')
})
test('a stale address preparation cannot restore a locked session',async()=>{
  const {wallet}=await walletFixture()
  await wallet.unlockWallet('TEST_PASSWORD');const phrase=wallet.getSessionMnemonic();await wallet.lockWallet()
  await assert.rejects(wallet.preparePublicAddresses(phrase),/session changed/)
  assert.equal(wallet.getSessionMnemonic(),null)
})
test('locking during privacy restore-height lookup cancels an in-progress mock export',async()=>{
  const {wallet,hooks}=await walletFixture('zano-light'),height=deferred(),started=deferred()
  hooks.height=()=>{started.resolve();return height.promise}
  const operation=wallet.getPrivateKey('fixture','TEST_PASSWORD'),rejected=assert.rejects(operation,/session changed/)
  await started.promise;await wallet.lockWallet();height.resolve(123);await rejected
})
for (const action of ['unlock','confirmWalletSetup']) test(`${action} stays locked if loading balances finishes after the lock action`,async()=>{
  const balance=deferred(),started=deferred();let mnemonic='TEST_INPUT_IN_MEMORY'
  const noop=()=>{}, wallet={getWalletStorageScope:()=> 'fixture',unlockWallet:async()=>true,finalizeWalletSetup:async()=>true,preparePublicAddresses:async()=>{},getSessionMnemonic:()=>mnemonic,warmPrivacyAddresses:noop,lockWallet:async()=>{mnemonic=null}}
  const api=await bundle('src/store/authStore.ts',{
    zustand:{create},'services/walletService':{walletService:wallet},
    'services/storageService':{storageService:{get:(_k,f)=>f,set:noop}},
    'store/coinStore':{useCoinStore:{getState:()=>({resetCoinsForCurrentWallet:async()=>{},loadSendReadyState:()=>{started.resolve();return balance.promise}})}},
    'store/transactionStore':{useTransactionStore:{getState:()=>({loadTransactions:async()=>{},resetTransactions:noop})}},
  })
  const store=api.useAuthStore,operation=store.getState()[action](action==='unlock'?'TEST_PASSWORD':mnemonic),rejected=assert.rejects(operation,/session changed/)
  await started.promise;store.getState().lock();balance.resolve();await rejected
  assert.equal(store.getState().isUnlocked,false);assert.equal(store.getState().sessionMnemonic,null)
})

test('password rotation completes without deriving addresses or touching the public address map', async () => {
  const {wallet,hooks,values}=await walletFixture()
  const addresses=values.get('altbase_wallet:wallet-addresses')
  let derives=0
  hooks.derive=async()=>{derives++;throw Error('Adapter unavailable')}
  assert.equal(await wallet.changePassword('TEST_PASSWORD','NEW_TEST_PASSWORD'),true)
  assert.equal(derives,0)
  assert.equal(values.get('altbase_wallet:wallet-addresses'),addresses)
  assert.equal(JSON.parse(values.get('altbase_wallet:wallet-meta')).encryptedMnemonic.cipherText,'new-cipher')
})
test('wrong current password cannot replace an encrypted profile', async () => {
  const {wallet,native,values,oldMeta}=await walletFixture()
  native.verifyWalletPassword=async()=>false
  await assert.rejects(wallet.changePassword('WRONG_TEST_PASSWORD','NEW_TEST_PASSWORD'),/Wrong password/)
  assert.equal(values.get('altbase_wallet:wallet-meta'),JSON.stringify(oldMeta))
})
test('encryption failure during password rotation preserves the previous profile and addresses', async () => {
  const {wallet,native,values,oldMeta}=await walletFixture()
  const addresses=values.get('altbase_wallet:wallet-addresses')
  native.createWalletSecret=async()=>{throw Error('Fixture encryption failure')}
  await assert.rejects(wallet.changePassword('TEST_PASSWORD','NEW_TEST_PASSWORD'),/Fixture encryption failure/)
  assert.equal(values.get('altbase_wallet:wallet-meta'),JSON.stringify(oldMeta))
  assert.equal(values.get('altbase_wallet:wallet-addresses'),addresses)
})
