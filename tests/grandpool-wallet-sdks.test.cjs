'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const u=require('@bitgo/utxo-lib'),n=require('libnexa-ts')
const {generateMnemonic}=require('@scure/bip39'),{wordlist}=require('@scure/bip39/wordlists/english')
const {signatureDigest}=require('../modules/zcash/runtime/zip244.cjs')
const vectors=require('./fixtures/zcash-zip244-transparent.json')
for(const vector of vectors.vectors)test(`Zcash ZIP-244 matches official Python reference (${vector.branch.toString(16)}, ${vector.inputCount} inputs)`,()=>{
  const builder=u.bitgo.createTransactionBuilderForNetwork(u.networks.zcash)
  builder.setDefaultsForVersion(u.networks.zcash,u.bitgo.ZcashTransaction.VERSION5_BRANCH_NU6_2)
  builder.setConsensusBranchId(vector.branch)
  builder.setExpiryHeight(vector.height)
  const script=Buffer.from('76a914'+'01'.repeat(20)+'88ac','hex')
  const prevouts=[]
  for(let i=0;i<vector.inputCount;i++){
    builder.addInput(Buffer.alloc(32,i+1),i,0xfffffffe-i,script)
    prevouts.push({value:100000000n+BigInt(i),script})
  }
  builder.addOutput(Buffer.from('76a914'+'02'.repeat(20)+'88ac','hex'),90000000n)
  const tx=builder.buildIncomplete()
  assert.equal(tx.getId(),vector.txid)
  for(let i=0;i<vector.inputCount;i++)assert.equal(signatureDigest(tx,i,prevouts).toString('hex'),vector.digests[i])
  const modified=prevouts.map(p=>({...p}));modified[modified.length-1].value+=1n
  assert.notEqual(signatureDigest(tx,0,modified).toString('hex'),vector.digests[0])
})
for(const coin of ['zcash','nexa']){
  const sdk=require(`../modules/${coin}/runtime/index.cjs`)
  const mnemonic=generateMnemonic(wordlist),{address}=sdk.derive({mnemonic})
  const script=coin==='zcash'?u.address.toOutputScript(address,u.networks.zcash).toString('hex'):n.ScriptFactory.buildOutFromAddress(address).toHex()
  const input=i=>({txid:i.toString(16).padStart(64,'0'),outputIndex:0,outpoint:i.toString(16).padStart(64,'0'),script,satoshis:'100000000'})
  const p={fromAddress:address,toAddress:address,height:3493820,utxos:[input(1),input(2)],amountCoin:coin==='zcash'?'1.5':'1000001'}
  test(`${coin}: local fixture signatures and amount conservation`,()=>{
    assert.equal(sdk.validate({address}).valid,true)
    assert.equal(sdk.validate({address:'not-an-address'}).valid,false)
    const result=sdk.sign({...p,mnemonic})
    assert.match(result.txid,/^[a-f0-9]{64}$/)
    if(coin==='zcash'){
      const tx=u.bitgo.createTransactionFromHex(result.hex,u.networks.zcash,{amountType:'bigint'})
      assert.equal(tx.version,5)
      assert.equal(tx.consensusBranchId,0x37a5165b)
      assert.equal(Buffer.from(result.hex,'hex').readUInt32LE(8),0x37a5165b)
      assert.equal(tx.getId(),result.txid)
      const prevouts=p.utxos.map(r=>({value:BigInt(r.satoshis),script:Buffer.from(script,'hex')}))
      assert.equal(tx.ins.length,2)
      for(let i=0;i<tx.ins.length;i++){
        const [encoded,pubkey]=u.script.decompile(tx.ins[i].script),signature=u.script.signature.decode(encoded)
        assert.equal(signature.hashType,1)
        assert.equal(u.ECPair.fromPublicKey(pubkey).verify(signatureDigest(tx,i,prevouts),signature.signature),true)
      }
      assert.equal(200000000n-tx.outs.reduce((v,o)=>v+BigInt(o.value),0n),BigInt(result.feeSatoshis))
    }else{
      const tx=new n.Transaction(result.hex)
      assert.equal(tx.id,result.txid)
      assert.equal(200000000n-tx.outputs.reduce((v,o)=>v+o.value,0n),BigInt(result.feeSatoshis))
    }
  })
  if(coin==='zcash')test('Zcash NU6.3 activation and expiry height bounds',()=>{
    for(const height of [undefined,3428142,0xffffffff-19,NaN,3493820.5])
      assert.throws(()=>sdk.sign({...p,mnemonic,height}),/NU6.3 network height/)
    const result=sdk.sign({...p,mnemonic,height:3428143})
    const tx=u.bitgo.createTransactionFromHex(result.hex,u.networks.zcash,{amountType:'bigint'})
    assert.equal(tx.consensusBranchId,0x37a5165b)
    assert.equal(tx.expiryHeight,3428163)
  })
  test(`${coin}: MAX retains leftovers and rejects duplicate or foreign inputs`,()=>{
    const many={...p,sendMax:true,utxos:Array.from({length:205},(_,i)=>input(i+1))}
    const plan=sdk.plan(many)
    assert.equal(plan.inputCount,200);assert.equal(plan.remainingInputCount,5)
    assert.throws(()=>sdk.plan({...p,utxos:[input(1),input(1)]}),/Duplicate/)
    assert.throws(()=>sdk.plan({...p,utxos:[{...input(1),script:'00'}]}),/belong/)
    assert.throws(()=>sdk.sign({...many,amountCoin:'1',mnemonic}),/MAX amount changed/)
    assert.throws(()=>sdk.sign({...p,mnemonic:generateMnemonic(wordlist)}),/does not match/)
    assert.throws(()=>sdk.plan({...p,maxFeeCoin:'0.00000001'}))
  })
}
test('Nexa: amounts above JSON safe integer range stay exact',()=>{
  const sdk=require('../modules/nexa/runtime/index.cjs'),{address}=sdk.derive({mnemonic:generateMnemonic(wordlist)})
  const script=n.ScriptFactory.buildOutFromAddress(address).toHex()
  const p=sdk.plan({fromAddress:address,toAddress:address,sendMax:true,utxos:[{outpoint:'ab'.repeat(32),script,satoshis:'90071992547409930'}]})
  assert.equal(BigInt(p.amountCoin.replace('.',''))>90071992547400000n,true)
  assert.throws(()=>sdk.plan({fromAddress:address,toAddress:address,sendMax:true,utxos:[{outpoint:'ab'.repeat(32),script,satoshis:90071992547409930}]}),/Unsafe/)
})
