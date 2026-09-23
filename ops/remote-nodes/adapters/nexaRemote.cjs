'use strict'
const n=require('libnexa-ts')
const {mapConcurrent}=require('../lib/mapConcurrent.cjs')
const {createRostrumClient}=require('../lib/rostrumClient.cjs')
const {atoms,decimalAtoms}=require('./remoteUtxo.cjs')
const createNexaRemoteAdapter=({url='wss://electrum.nexa.org:20004',request}={})=>{
  const call=request?((method,params=[])=>request(url,method,params)):createRostrumClient(url)
  const checked=address=>{
    if(typeof address!=='string'||!address.startsWith('nexa:')||address.length>200)throw new Error('Invalid Nexa mainnet address')
    const a=n.Address.fromString(address)
    if(a.network.name!=='mainnet'||!['P2ST','P2PKH'].includes(a.type))throw new Error('Unsupported Nexa address type')
    return a
  }
  const network=async()=>{
    const tip=await call('blockchain.headers.subscribe')
    if(!Number.isSafeInteger(tip?.height)||tip.height<1)throw new Error('Node omitted current Nexa height')
    return {chain:'nexa-mainnet',blocks:tip.height,headers:tip.height,initialBlockDownload:false,verificationProgress:1}
  }
  const transactionCache=new Map(),transactionPending=new Map()
  const transaction=async id=>{
    if(!/^[0-9a-f]{64}$/i.test(id))throw new Error('Invalid Nexa transaction id')
    const cached=transactionCache.get(id)
    if(cached&&cached.expires>Date.now())return cached.value
    if(transactionPending.has(id))return transactionPending.get(id)
    const operation=(async()=>{
    const value=await call('blockchain.transaction.get',[id,true])
    if(!Array.isArray(value?.vin)||!Array.isArray(value?.vout))throw new Error('Node omitted Nexa transaction data')
    if(transactionCache.size>=5000)transactionCache.delete(transactionCache.keys().next().value)
    transactionCache.set(id,{value,expires:Date.now()+300000});return value
    })()
    transactionPending.set(id,operation)
    try{return await operation}finally{transactionPending.delete(id)}
  }
  const pendingAddresses=new Map()
  const readUtxos=async address=>{
    const script=n.ScriptFactory.buildOutFromAddress(checked(address)).toHex()
    const [result,tip]=await Promise.all([call('blockchain.address.listunspent',[address,'exclude_tokens']),network()])
    const rows=Array.isArray(result)?result:result?.unspent
    if(!Array.isArray(rows))throw new Error('Node omitted Nexa UTXOs')
    return mapConcurrent(rows.filter(row=>!row.has_token&&!row.token),4,async row=>{
      if(!/^[0-9a-f]{64}$/i.test(row.outpoint_hash)||!/^[0-9a-f]{64}$/i.test(row.tx_hash))throw new Error('Node omitted Nexa outpoint hash')
      const value=atoms(row.value)
      if(value<0n)throw new Error('Negative Nexa output')
      const confirmations=row.height>0?Math.max(0,tip.blocks-row.height+1):0
      const tx=confirmations<5000?await transaction(row.tx_hash):null
      const isCoinbase=Boolean(tx&&(tx.vin.length===0||tx.vin.some(input=>input.coinbase || /^0{64}$/.test(input.outpoint||''))))
      const immature=isCoinbase&&confirmations<5000
      return {txid:row.tx_hash,outputIndex:row.tx_pos,outpoint:row.outpoint_hash,satoshis:value.toString(),script,address,
        height:row.height,confirmations,isCoinbase,immature,spendable:confirmations>0&&!immature}
    })
  }
  const utxos=async address=>{
    if(pendingAddresses.has(address))return pendingAddresses.get(address)
    const work=readUtxos(address);pendingAddresses.set(address,work)
    try{return await work}finally{if(pendingAddresses.get(address)===work)pendingAddresses.delete(address)}
  }
  return {coin:'nexa',preserveAtomicBalances:true,authoritativeBalance:true,balanceTimeoutMs:60000,getNetwork:network,
    validateAddress:async address=>{try{checked(address);return{isvalid:true}}catch{return{isvalid:false}}},
    getUtxos:async address=>({address,utxos:(await utxos(address)).filter(u=>u.spendable)}),
    async getBalance(address){
      checked(address)
      const [balance,rows]=await Promise.all([call('blockchain.address.get_balance',[address,'exclude_tokens']),utxos(address)])
      const confirmed=atoms(balance.confirmed),pending=atoms(balance.unconfirmed)
      return{balance:confirmed.toString(),balance_spendable:rows.filter(u=>u.spendable).reduce((v,u)=>v+atoms(u.satoshis),0n).toString(),
        immature:rows.filter(u=>u.immature).reduce((v,u)=>v+atoms(u.satoshis),0n).toString(),
        pendingIncoming:(pending>0n?pending:0n).toString(),pendingOutgoing:(pending<0n?-pending:0n).toString()}
    },
    async getHistory(address,{limit=25,offset=0}={}){
      const script=n.ScriptFactory.buildOutFromAddress(checked(address)).toHex()
      const history=await call('blockchain.address.get_history',[address])
      if(!Array.isArray(history))throw new Error('Node omitted Nexa history')
      const rows=history.slice().reverse().slice(offset,offset+limit),deltas=[]
      for(const row of rows){
        const tx=await transaction(row.tx_hash)
        let value=0n
        for(const output of tx.vout){if(output.scriptPubKey?.hex===script)value+=output.value_satoshi===undefined?decimalAtoms(output.value,2):atoms(output.value_satoshi)}
        for(const input of tx.vin){
          if(input.coinbase)continue
          // Rostrum's verbose Nexa transaction supplies previous scripts/amounts.
          if(!Array.isArray(input.addresses))throw new Error('Nexa historical input addresses are unavailable')
          if(input.addresses.some(a=>{try{return n.ScriptFactory.buildOutFromAddress(checked(a)).toHex()===script}catch{return false}}))
            value-=input.value_satoshi===undefined?decimalAtoms(input.value,2):atoms(input.value_satoshi)
        }
        deltas.push({txid:row.tx_hash,satoshis:value.toString(),height:row.height||0,timestamp:tx.blocktime||tx.time||0})
      }
      return{address,txids:rows.map(r=>r.tx_hash),deltas:deltas.filter(r=>r.height>0),mempool:deltas.filter(r=>r.height<=0),transactions:[]}
    },
    async estimateFee(blocks=6){
      const rate=Number(await call('blockchain.estimatefee',[blocks]))
      return{feerate:Number.isFinite(rate)&&rate>30?rate:30,relayFee:30}
    },
    async broadcastTx(hex){
      if(typeof hex!=='string'||!/^[0-9a-f]+$/i.test(hex)||hex.length%2||hex.length>2000000)throw new Error('Invalid Nexa transaction')
      const txid=await call('blockchain.transaction.broadcast',[hex])
      if(!/^[0-9a-f]{64}$/i.test(txid))throw new Error('Node omitted transaction id; broadcast outcome is unknown')
      return{txid}
    },
  }
}
module.exports={createNexaRemoteAdapter}
