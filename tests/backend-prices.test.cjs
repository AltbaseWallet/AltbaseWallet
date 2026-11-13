'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
async function fixtureFeed(useLcw, filename, overrides = {}, responses = {}) {
  const calls = [], exports = {}, rates = { ETH: 2100, BNB: 600, POL: 0.12, SOL: 100, TRX: 0.3, ...overrides }
  const ids = { ethereum: 'ETH', binancecoin: 'BNB', 'polygon-ecosystem-token': 'POL', solana: 'SOL', tron: 'TRX' }
  let now = Date.now()
  const context = { module: { exports }, exports, URL, AbortController, Date: { now: () => now },
    require: name => { assert.equal(name, './logger.cjs'); return { info() {}, warn() {} } },
    setTimeout: (fn, ms) => { if (ms <= 250) queueMicrotask(fn); return 1 }, clearTimeout() {},
    setInterval: () => ({ unref() {} }),
    fetch: async (url, options) => {
      calls.push(url)
      const fixture = Object.entries(responses).find(([match]) => url.includes(match))?.[1]
      if (fixture) return { ok: (fixture.status ?? 200) === 200, status: fixture.status ?? 200, json: async () => fixture.data }
      let data = {}
      if (url.includes('livecoinwatch')) data = { rate: rates[JSON.parse(options.body).code] }
      if (!useLcw && url.includes('coingecko')) {
        const requested = new URL(url).searchParams.get('ids').split(',')
        data = Object.fromEntries(requested.map(id => [id, { usd: rates[ids[id]] }]))
      }
      return { ok: true, status: 200, json: async () => data }
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ops/backend', filename), 'utf8'), context)
  const feed = context.module.exports.startPriceFeed(useLcw ? { primaryKey: 'fixture-only' } : {})
  for (let i = 0; i < 1000 && !feed.snapshot().updatedAt; i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(feed.snapshot().updatedAt)
  return { ...feed.snapshot(), calls, feed, advance: milliseconds => { now += milliseconds } }
}
for (const filename of ['priceFeed.cjs', 'priceFeed-node2.cjs']) {
  test(`${filename}: fallback quotes cannot overwrite a successful primary quote`, async () => {
    const result=await fixtureFeed(true,filename,{NEXA:0.00000055},{'api.coingecko.com/':{data:{ethereum:{usd:99999},nexa:{usd:0.0012}}}})
    assert.equal(result.prices.ethereum,2100)
    assert.equal(result.prices.nexa,0.00000055)
    assert.ok(!new URL(result.calls.find(url=>url.includes('api.coingecko.com/'))).searchParams.get('ids').split(',').includes('nexa'))
  })
  test(`${filename}: Nexa uses only the exact independent exchange pair when LCW is unavailable`, async () => {
    const result=await fixtureFeed(false,filename,{}, {'symbol=NEXAUSDT':{data:{symbol:'NEXAUSDT',price:'0.00000055'}},'api.coingecko.com/':{data:{nexa:{usd:0.0012}}}})
    assert.equal(result.prices.nexa,0.00000055)
    const wrong=await fixtureFeed(false,filename,{}, {'symbol=NEXAUSDT':{data:{symbol:'OTHERUSDT',price:'10'}},'api.coingecko.com/':{data:{nexa:{usd:0.0012}}}})
    assert.equal(wrong.prices.nexa,undefined)
  })
  test(`${filename}: Pearl uses the verified current SafeTrade API`, async () => {
    const result = await fixtureFeed(false, filename, {}, {
      'safetrade.com/api/v2/trade/public/tickers/prlusdt': { data: { id: 'prlusdt', last: '1.99' } },
    })
    assert.equal(result.prices.pearl, 1.99)
    assert.ok(!result.calls.some(url => url.includes('safe.trade/')))
    assert.ok(!result.calls.some(url => url.includes('tickers/PRL_USDT')))
  })
  test(`${filename}: Pearl falls back to the independent NestEx PRL/USDT market`, async () => {
    const result = await fixtureFeed(false, filename, {}, {
      'safetrade.com/': { status: 503 },
      'tickers/PRL_USDT': { data: { ticker_id: 'PRL_USDT', last_price: '1.8' } },
    })
    assert.equal(result.prices.pearl, 1.8)
  })
  test(`${filename}: wrong markets and malformed rates never become a Pearl quote`, async () => {
    const result = await fixtureFeed(false, filename, {}, {
      'safetrade.com/': { data: { id: 'btcusdt', last: '99999' } },
      'tickers/PRL_USDT': { data: { ticker_id: 'BTC_USDT', last_price: '99999' } },
    })
    assert.equal(result.prices.pearl, undefined)
    const malformed = await fixtureFeed(false, filename, {}, {
      'safetrade.com/': { data: { id: 'prlusdt', last: '1.99garbage' } },
      'tickers/PRL_USDT': { data: { ticker_id: 'PRL_USDT', last_price: '2garbage' } },
    })
    assert.equal(malformed.prices.pearl, undefined)
  })
  test(`${filename}: Neoxa remains priced when LCW has no rate and CoinGecko is down`, async () => {
    const result = await fixtureFeed(true, filename, {}, {
      'api.coingecko.com/': { status: 429 },
      'tickers/neox-neoxa': { data: { id: 'neox-neoxa', quotes: { USD: { price: 0.000107 } } } },
    })
    assert.equal(result.prices.neoxa, 0.000107)
  })
  test(`${filename}: Neoxa is included in the single CoinGecko batch fallback`, async () => {
    const result = await fixtureFeed(false, filename, {}, {
      'api.coingecko.com/': { data: { neoxa: { usd: 0.00010667 } } },
      'tickers/neox-neoxa': { status: 503 },
    })
    assert.equal(result.prices.neoxa, 0.00010667)
    const calls = result.calls.filter(url => url.includes('api.coingecko.com/'))
    assert.equal(calls.length, 1)
    assert.ok(new URL(calls[0]).searchParams.get('ids').split(',').includes('neoxa'))
  })
}
for (const filename of ['priceFeed.cjs', 'priceFeed-node2.cjs']) for (const useLcw of [true, false]) test(`${filename}: existing ${useLcw ? 'LCW' : 'CoinGecko fallback'} feed prices six native networks, Arbitrum uses ETH`, async () => {
  const result = await fixtureFeed(useLcw, filename)
  assert.deepEqual(JSON.parse(JSON.stringify(result.prices)), { ethereum: 2100, bsc: 600, polygon: 0.12, solana: 100, tron: 0.3, arbitrum: 2100 })
  assert.ok(!result.calls.some(url => /publicnode|arb-token/.test(url)))
  assert.equal(result.calls.filter(url => url.includes('coingecko')).length, 1)
  assert.equal(result.priceUpdatedAt.arbitrum, result.priceUpdatedAt.ethereum)
})
for (const filename of ['priceFeed.cjs', 'priceFeed-node2.cjs']) test(`${filename}: stale quotes expire rather than appearing current indefinitely`, async () => {
  const result = await fixtureFeed(false, filename)
  result.advance(29 * 60_000)
  assert.equal(result.feed.snapshot().prices.ethereum, 2100)
  result.advance(2 * 60_000)
  assert.deepEqual(JSON.parse(JSON.stringify(result.feed.snapshot().prices)), {})
  assert.deepEqual(JSON.parse(JSON.stringify(result.feed.snapshot().priceUpdatedAt)), {})
})
for (const filename of ['priceFeed.cjs', 'priceFeed-node2.cjs']) for (const useLcw of [true, false]) test(`${filename}: ${useLcw ? 'LCW' : 'CoinGecko'} rejects invalid and nonpositive quotes`, async () => {
  const result = await fixtureFeed(useLcw, filename, { ETH: 0, BNB: -1, POL: Infinity, SOL: NaN, TRX: null })
  assert.deepEqual(JSON.parse(JSON.stringify(result.prices)), {})
})
