'use strict'
const units = (text, decimals) => {
  if (typeof text !== 'string' || !new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(text)) throw new Error('Invalid amount or decimal precision')
  const [whole, fraction=''] = text.split('.')
  return BigInt(whole)*10n**BigInt(decimals) + BigInt(fraction.padEnd(decimals,'0'))
}
const format = (value, decimals) => {
  const n=BigInt(value), unit=10n**BigInt(decimals)
  if (n<0n) throw new Error('Negative amount')
  const fraction=(n%unit).toString().padStart(decimals,'0').replace(/0+$/,'')
  return `${n/unit}${fraction ? '.'+fraction : ''}`
}
const integer = value => {
  if (typeof value==='number' && !Number.isSafeInteger(value)) throw new Error('Unsafe atomic amount')
  if (!/^\d+$/.test(String(value))) throw new Error('Invalid atomic amount')
  return BigInt(value)
}
const select = (params, {decimals, dust, feeFor, validateUtxo, maxInputs=200}) => {
  if (!Array.isArray(params.utxos) || params.utxos.length>100000) throw new Error('Invalid UTXO set')
  const seen=new Set()
  const available=params.utxos.map(u=>{
    const key=validateUtxo(u)
    if (seen.has(key)) throw new Error('Duplicate UTXO')
    seen.add(key)
    const value=integer(u.satoshis)
    if (value===0n) throw new Error('Zero-value UTXO')
    return {...u,value}
  }).sort((a,b)=>a.value===b.value?0:a.value>b.value?-1:1)
  const requested=params.sendMax ? 0n : units(params.amountCoin,decimals)
  if (!params.sendMax && requested<dust) throw new Error('Amount is below the minimum output value')
  const selected=[]
  let total=0n,fee=0n,amount=requested,change=0n
  for (const row of available.slice(0,maxInputs)) {
    selected.push(row); total+=row.value
    fee=feeFor(selected.length,params.sendMax?1:2)
    if (params.feeCoin) {
      const custom=units(params.feeCoin,decimals)
      if (custom<fee) throw new Error('The selected fee is below the current network minimum')
      fee=custom
    }
    if (!params.sendMax && total>=requested+fee) break
  }
  if (!selected.length) throw new Error('No confirmed spendable outputs')
  if (params.sendMax) amount=total-fee
  else change=total-amount-fee
  if (amount<dust || change<0n) throw new Error('Insufficient confirmed balance for amount and fee')
  if (change>0n && change<dust) {fee+=change;change=0n}
  if (params.maxFeeCoin && fee>units(params.maxFeeCoin,decimals)) throw new Error('Fee changed; review the updated amount before confirming')
  const remaining=available.slice(selected.length)
  return {selected,total,fee,amount,change, amountCoin:format(amount,decimals),feeCoin:format(fee,decimals),
    inputCount:selected.length,remainingInputCount:remaining.length,
    remainingAmountCoin:format(remaining.reduce((n,u)=>n+u.value,0n),decimals)}
}
const publicPlan = plan => ({amountCoin:plan.amountCoin,feeCoin:plan.feeCoin,feeSatoshis:Number(plan.fee),
  inputCount:plan.inputCount,remainingInputCount:plan.remainingInputCount,remainingAmountCoin:plan.remainingAmountCoin})
module.exports={units,format,integer,select,publicPlan}
