const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const {patchAuthoritativeBalances}=require('../ops/remote-nodes/authoritative-balance-patch.cjs')
test('authoritative balances never fall back to an incomplete spendable UTXO list',async()=>{
  const source=`
const readUtxoBalanceFallback = async (adapter, address, { force = false, fast = true } = {}) => { return adapter.getUtxos(address) }
const readWalletUtxoBalanceFallback = async (adapter, addresses, primaryAddress) => { return adapter.getUtxos(primaryAddress) }
const timeout = adapter => scanAwareTimeout(adapter, BALANCE_PRIMARY_TIMEOUT_MS)
globalThis.readOne=readUtxoBalanceFallback;globalThis.readMany=readWalletUtxoBalanceFallback;globalThis.timeout=timeout`
  const patched=patchAuthoritativeBalances(source)
  assert.equal(patchAuthoritativeBalances(patched),patched)
  const context={scanAwareTimeout:(_,ms)=>ms,BALANCE_PRIMARY_TIMEOUT_MS:8000};vm.runInNewContext(patched,context)
  let reads=0;const adapter={authoritativeBalance:true,balanceTimeoutMs:60000,getUtxos:()=>{reads++;return {balance:100,immature:0}}}
  assert.equal(await context.readOne(adapter,'fixture'),null)
  assert.equal(await context.readMany(adapter,['fixture'],'fixture'),null)
  assert.equal(reads,0);assert.equal(context.timeout(adapter),60000)
  adapter.authoritativeBalance=false
  assert.equal((await context.readOne(adapter,'fixture')).balance,100)
  assert.equal(reads,1)
})
