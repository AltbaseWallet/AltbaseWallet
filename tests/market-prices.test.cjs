'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { bundle } = require('./bundle-helper.cjs')

test('legacy cached dollar totals cannot survive without a current dated quote', async () => {
  const { applyCachedCoinRuntime } = await bundle('src/services/coinRuntimeCache.ts', {})
  const coin = applyCachedCoinRuntime({id:'pearl',balance:'0'}, {balance:'12.345',priceUsd:99,fiatValue:999999})
  assert.equal(coin.balance, '12.345')
  assert.equal(coin.priceUsd, undefined)
  assert.equal(coin.fiatValue, undefined)
  const fresh = applyCachedCoinRuntime({id:'pearl',balance:'0'}, {balance:'3',priceUsd:2,priceUpdatedAt:Date.now(),fiatValue:999999})
  assert.equal(fresh.fiatValue, 6)
})
test('fresh global quotes revalue plugin balances, preserve native units, and expire individually', async () => {
  const { marketPriceService: prices } = await bundle('src/services/marketPriceService.ts', {})
  const now = Date.now(), coin = {id:'nexa',balance:'10000000',priceUsd:100,fiatValue:1e9}
  prices.update({prices:{nexa:0.00000055},updatedAt:now,priceUpdatedAt:{nexa:now}})
  assert.equal(prices.apply(coin,now).fiatValue, 5.5)
  assert.equal(prices.apply(coin,now).balance, '10000000')
  assert.equal(prices.apply({...coin,balance:'20000000'},now).fiatValue, 11)
  assert.equal(prices.apply(coin,now+30*60_000+1).fiatValue, undefined)
  prices.update({prices:{},updatedAt:now})
  assert.equal(prices.apply(coin,now).fiatValue, undefined)
})
test('invalid, undated, future, and expired prices never become a dollar balance', async () => {
  const { marketPriceService: prices } = await bundle('src/services/marketPriceService.ts', {})
  const now=Date.now(),coin={id:'coin',balance:'4'}
  for(const [rate,time] of [[NaN,now],[Infinity,now],[-2,now],[0,now],['2',now],[2,null],[2,now+1],[2,now-31*60_000]]){
    prices.update({prices:{coin:rate},updatedAt:time})
    assert.equal(prices.apply(coin,now).fiatValue,undefined)
  }
})
