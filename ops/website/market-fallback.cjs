'use strict'
// Preserve fresh native prices when slower market-statistic providers fail.
const {sanitizeQuotes}=require('./demo-prices.cjs')
function fallbackMarket(asset,quotes,now=Date.now()) {
 const valid=sanitizeQuotes(quotes,now),key=asset.priceId||asset.id,price=valid.prices[key],at=valid.priceUpdatedAt[key]
 if(!Number.isFinite(price)||price<=0)throw Error('Fresh native price unavailable')
 return {name:asset.name,symbol:asset.ticker,provider:'Altbase wallet price feed',providerUrl:'https://api.altbase.io/api/v1/prices',priceUsd:price,lastUpdated:new Date(at).toISOString(),volume24h:null,change24h:null,marketCap:null,athPrice:null,markets:[],links:asset.aggregators||[],fallback:true,statsUnavailable:true}
}
function createMarketReader({assets,getSource,getQuotes,clock=Date.now,timeoutMs=8000}) {
 const catalog=new Map(assets.map(a=>[a.id,a])),pending=new Map(),fallbacks=new Map()
 const valid=data=>Number.isFinite(data?.priceUsd)&&data.priceUsd>0
 return async function market(id){
  const asset=catalog.get(id)
  if(!asset)return getSource(id)
  const cached=fallbacks.get(id),now=clock()
  if(cached&&cached.expiresAt>now&&now-Date.parse(cached.data.lastUpdated)<1200000)return cached.data
  if(!pending.has(id)){
   const request=Promise.resolve().then(()=>getSource(id));pending.set(id,request)
   request.then(()=>{if(pending.get(id)===request)pending.delete(id)},()=>{if(pending.get(id)===request)pending.delete(id)})
  }
  const source=pending.get(id);let timer
  try {
   const result=await Promise.race([source,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Market provider timeout')),timeoutMs)})])
   if(valid(result))return result
  } catch { /* A verified native quote can still be available. */ }
  finally {clearTimeout(timer)}
  const result=fallbackMarket(asset,await getQuotes(),clock());fallbacks.set(id,{expiresAt:clock()+30000,data:result});return result
 }
}
module.exports={fallbackMarket,createMarketReader}
