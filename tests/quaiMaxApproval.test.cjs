'use strict'
const assert=require('node:assert/strict')
const test=require('node:test')
const {createJiti}=require('jiti')
const jiti=createJiti(__filename)
const {QuaiHDWallet}=require('quais')
const {coinApiService}=jiti('../src/services/coinApiService.ts')
const {quaiWalletService}=jiti('../src/services/quaiWalletService.ts')
const from='0x0074A61f9c186499774871Fc59aFe28FeA88d94b'
const to='0x00642Bd5C4a9520a485d53F4aA472205Add5d8f0'
test('Quai MAX preserves its approved amount when the network gas price falls',async(t)=>{
 const previousWindow=globalThis.window
 globalThis.window={}
 t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow})
 let gasPrice='20000000000000'
 const context=()=>({gasLimit:'60000',gasPrice,nonce:0,fee:String(Number(gasPrice)*60000/1e18),source:'test'})
 t.mock.method(coinApiService,'getBalance',async(_coin,_address,options)=>{
  assert.equal(options.priority,true)
  return {balance:'100000000000',balance_spendable:'100000000000'}
 })
 t.mock.method(coinApiService,'getAccountTxContext',async()=>context())
 t.mock.method(coinApiService,'getAccountFeeEstimate',async()=>context())
 const estimate=await quaiWalletService.estimateMaxSend('quai',from,undefined,to)
 assert.equal(estimate.amountCoin,'998.8')
 assert.equal(estimate.feeCoin,'1.2')
 gasPrice='19000000000000'
 let signed
 t.mock.method(QuaiHDWallet,'fromPhrase',()=>({
  getNextAddressSync:()=>({address:from}),
  signTransaction:async(value)=>{signed=value;throw new Error('STOP_BEFORE_SIGNING')},
 }))
 await assert.rejects(quaiWalletService.send({coinId:'quai',mnemonic:'mocked',fromAddress:from,toAddress:to,
  amountCoin:estimate.amountCoin,maxFeeCoin:estimate.feeCoin,sendMax:true}),/STOP_BEFORE_SIGNING/)
 assert.equal(BigInt(signed.value),998800000000000000000n)
 assert.equal(BigInt(signed.gasPrice)*BigInt(signed.gasLimit),1200000000000000000n)
})
