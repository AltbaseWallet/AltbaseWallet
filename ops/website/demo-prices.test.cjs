'use strict'
const { test }=require('node:test'),assert=require('node:assert/strict')
const {sanitizeQuotes,createPriceFeed}=require('./demo-prices.cjs')
const now=1800000000000
const valid=()=>({ok:true,prices:{bitcoin:70000,ethereum:2000,polygon:.1},priceUpdatedAt:{bitcoin:now-10000,ethereum:now-5000,polygon:now-8000}})
test('preserve precise native-wallet quotes and timestamps',()=>{const data=valid(),result=sanitizeQuotes(data,now);assert.equal(result.prices.bitcoin,70000);assert.equal(result.prices.polygon,.1);assert.equal(result.priceUpdatedAt.ethereum,now-5000)})
test('reject stale, future, invalid and delisted entries instead of using zero',()=>{const data=valid();Object.assign(data.prices,{bad:'1',zero:0,future:10,old:15,btgs:2});Object.assign(data.priceUpdatedAt,{bad:now,zero:now,future:now+300001,old:now-1200000,btgs:now});assert.deepEqual(Object.keys(sanitizeQuotes(data,now).prices),['bitcoin','ethereum','polygon']);assert.throws(()=>sanitizeQuotes({ok:true,prices:{btc:0},priceUpdatedAt:{btc:now}},now))})
test('coalesce concurrent refreshes and use a short cache',async()=>{let calls=0,clock=now;const feed=createPriceFeed(async()=>{calls++;return {ok:true,json:async()=>valid()}},()=>clock);const values=await Promise.all([feed(),feed(),feed()]);assert.equal(calls,1);assert.deepEqual(values[0],values[2]);await feed();assert.equal(calls,1);clock+=30001;await feed();assert.equal(calls,2)})
test('clear in-flight failures and recover on the next request',async()=>{let fails=true;const feed=createPriceFeed(async()=>{if(fails)throw Error('offline');return {ok:true,json:async()=>valid()}},()=>now);await assert.rejects(feed());fails=false;assert.equal((await feed()).prices.ethereum,2000)})
test('an expired cache cannot turn into a current valuation',async()=>{let clock=now;const feed=createPriceFeed(async()=>({ok:true,json:async()=>valid()}),()=>clock);await feed();clock+=1200001;await assert.rejects(feed())})
