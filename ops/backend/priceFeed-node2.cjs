'use strict'

// Periodically polls exchange/public APIs for USD prices of the coins we serve.
//
// Architecture:
//   • Wallet never talks to livecoinwatch directly — only api.altbase.io knows
//     the API keys, the wallet just reads from /api/v1/prices.
//   • Two API keys (primary + backup). On rate-limit (HTTP 429) on the primary,
//     we transparently retry on the backup.
//   • In-memory cache keyed by coin id; refreshed every 5 minutes.

const logger = require('./logger.cjs')

// Map wallet coin id → LiveCoinWatch symbol.
// LCW disambiguates fork tokens with underscore-prefixed codes. The exact
// strings below come from the project's LCW listing URLs.
const COIN_LCW_CODE = {
  ethereum: 'ETH', bsc: 'BNB', polygon: 'POL', solana: 'SOL', tron: 'TRX',
  nexa: 'NEXA',
  bitcoin2:      'BC2',
  bitcoincashii: 'BCH2',
  firo:          'FIRO',
  pepecoin:      '_______________________________________PEPE',          // 39 underscores + PEPE
  kerrigan:      'KRGN',
  scash:         'SCASH',
  neoxa:         '_NEOX',
  terracoin:     'TRC',
  junkcoin:      'JKC',
  raptoreum:     'RTM',
  quai:          'QUAI',
}

// CapStash isn't on LiveCoinWatch — it trades on nonkyc.io.
// We fetch its USDT pair directly from their public REST.
const NONKYC_PAIRS = {
  capstash: 'CAP_USDT',
  epic: 'EPIC_USDT',
  zano: 'ZANO_USDT',
}

// LitecoinII trades on NestEx as LC2/USDT.
const NESTEX_PAIRS = {
  litecoinii: 'LC2_USDT',
}

// Pearl uses SafeTrade's current API, with the independent NestEx PRL/USDT
// market as a fallback.
const SAFETRADE_PAIRS = {
  pearl: 'prlusdt',
}
const SAFETRADE_NESTEX_FALLBACKS = { pearl: 'PRL_USDT' }

const COINPAPRIKA_TICKERS = { neoxa: 'neox-neoxa' }

const COINPAPRIKA_MARKETS = {
  pearl: { coinId: 'prl-pearl-1', exchangeId: 'safetrade', pair: 'PRL/USDT' },
}

// Public no-key CoinGecko fallback for coins that are not available through LCW.
const COINGECKO_IDS = {
  neoxa: 'neoxa',
  ethereum: 'ethereum', bsc: 'binancecoin', polygon: 'polygon-ecosystem-token', solana: 'solana', tron: 'tron',
  quai: 'quai-network',
  kaspa: 'kaspa',
  qubic: 'qubic-network',
  ckb: 'nervos-network',
}

const REFRESH_INTERVAL_MS = 5 * 60_000  // 5 min — comfortable under daily limits
const SINGLE_TIMEOUT_MS   = 8_000

const fetchWithTimeout = async (url, init = {}, timeoutMs = SINGLE_TIMEOUT_MS) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      headers: {
        'user-agent': 'AltbaseWallet/0.1 price-feed',
        accept: 'application/json,text/plain,*/*',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

const requestSinglePrice = async (apiKey, code) => {
  const r = await fetchWithTimeout('https://api.livecoinwatch.com/coins/single', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ currency: 'USD', code }),
  })
  if (r.status === 429) {
    const err = new Error('livecoinwatch rate limit')
    err.status = 429
    throw err
  }
  if (!r.ok) throw new Error(`livecoinwatch http ${r.status}`)
  return r.json()
}

/** Try the primary key, fall back to the backup on 429. Returns rate or null. */
const fetchPriceWithFallback = async (keys, code) => {
  for (let i = 0; i < keys.length; i++) {
    try {
      const data = await requestSinglePrice(keys[i], code)
      const rate = data?.rate
      return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null
    } catch (err) {
      if (err.status === 429 && i < keys.length - 1) continue   // try next key
      // Non-rate-limit error → coin probably isn't listed, log once and move on
      logger.warn('priceFeed.fetchFailed', { code, error: err.message })
      return null
    }
  }
  return null
}

/** Fetch a USDT pair price from NonKYC. Returns USD-equivalent or null. */
const fetchFromNonkyc = async (pair) => {
  try {
    const r = await fetchWithTimeout(`https://nonkyc.io/api/v2/ticker/${pair}`)
    if (!r.ok) throw new Error(`nonkyc http ${r.status}`)
    const data = await r.json()
    const price = parseFloat(data?.last_price)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch (err) {
    logger.warn('priceFeed.nonkycFailed', { pair, error: err.message })
    return null
  }
}

/** Fetch a USDT pair price from NestEx public API. */
const fetchFromNestex = async (pair) => {
  try {
    const r = await fetchWithTimeout(`https://trade.nestex.one/api/cg/tickers/${pair}`)
    if (!r.ok) throw new Error(`nestex http ${r.status}`)
    const data = await r.json()
    if (data?.ticker_id !== undefined && data.ticker_id !== pair) return null
    const price = Number(data?.last_price)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch (err) {
    logger.warn('priceFeed.nestexFailed', { pair, error: err.message })
    return null
  }
}

const safeTradePriceFromPayload = (data, pair) => {
  const rows = []
  if (Array.isArray(data)) rows.push(...data)
  if (data && typeof data === 'object') {
    rows.push(data)
    rows.push(data.ticker)
    if (data[pair]) rows.push(data[pair])
    if (data[pair]?.ticker) rows.push(data[pair].ticker)
  }

  for (const row of rows.filter(Boolean)) {
    const market = row.id ?? row.market ?? row.ticker_id
    if (market !== undefined && String(market).toLowerCase().replace(/[/_-]/g, '') !== pair) continue
    const price = Number(row.last ?? row.last_price ?? row.price ?? row.close)
    if (Number.isFinite(price) && price > 0) return price
  }
  return null
}

/** Fetch a USDT pair price from SafeTrade public API. */
const fetchFromSafetrade = async (pair) => {
  try {
    const url = `https://safetrade.com/api/v2/trade/public/tickers/${encodeURIComponent(pair)}`
    const r = await fetchWithTimeout(url, {
      headers: { referer: 'https://safetrade.com/exchange/PRL-USDT' },
    })
    if (!r.ok) throw new Error(`safetrade http ${r.status}`)
    const data = await r.json()
    return safeTradePriceFromPayload(data, pair)
  } catch (err) {
    logger.warn('priceFeed.safetradeFailed', { pair, error: err.message })
    return null
  }
}

/** Fetch a USD price for a specific exchange pair from CoinPaprika markets. */
const fetchFromCoinpaprikaMarket = async ({ coinId, exchangeId, pair }) => {
  try {
    const url = `https://api.coinpaprika.com/v1/coins/${encodeURIComponent(coinId)}/markets`
    const r = await fetchWithTimeout(url)
    if (!r.ok) throw new Error(`coinpaprika http ${r.status}`)
    const rows = await r.json()
    const market = (Array.isArray(rows) ? rows : []).find((row) =>
      String(row.exchange_id || '').toLowerCase() === String(exchangeId || '').toLowerCase()
      && String(row.pair || '').toUpperCase() === String(pair || '').toUpperCase()
      && row.outlier !== true
    )
    const price = Number(market?.quotes?.USD?.price)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch (err) {
    logger.warn('priceFeed.coinpaprikaMarketFailed', { coinId, exchangeId, pair, error: err.message })
    return null
  }
}

/** Fetch a USD price directly from CoinPaprika's ticker endpoint. */
const fetchFromCoinpaprikaTicker = async (coinId) => {
  try {
    const url = `https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(coinId)}`
    const r = await fetchWithTimeout(url)
    if (!r.ok) throw new Error(`coinpaprika ticker http ${r.status}`)
    const data = await r.json()
    const price = Number(data?.quotes?.USD?.price)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch (err) {
    logger.warn('priceFeed.coinpaprikaTickerFailed', { coinId, error: err.message })
    return null
  }
}

/** Fetch a USD price from CoinGecko simple price API. */
const fetchFromCoingecko = async (ids) => {
  try {
    // A single batch avoids a burst of requests against the same rate limit.
    const unique = [...new Set(ids)]
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(unique.join(','))}&vs_currencies=usd`
    const r = await fetchWithTimeout(url)
    if (!r.ok) throw new Error(`coingecko http ${r.status}`)
    const data = await r.json()
    const prices = {}
    for (const id of unique) {
      const price = Number(data?.[id]?.usd)
      if (Number.isFinite(price) && price > 0) prices[id] = price
    }
    return prices
  } catch (err) {
    logger.warn('priceFeed.coingeckoFailed', { error: err.message })
    return {}
  }
}

/**
 * Start the background refresh loop and return a snapshot accessor.
 * @param {{ primaryKey?: string, backupKey?: string }} opts
 */
const startPriceFeed = ({ primaryKey, backupKey }) => {
  const cache = new Map() // coinId → { usd: number, updatedAt: ms }
  const keys = [primaryKey, backupKey].filter(Boolean)

  if (keys.length === 0) {
    logger.warn('priceFeed.livecoinwatchDisabled', { reason: 'no API keys configured' })
  }

  let lastRefreshAt = 0
  let refreshing = false
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    const refreshed = new Set()
    const storePrice = (coinId, usd) => {
      cache.set(coinId, { usd, updatedAt: Date.now() })
      refreshed.add(coinId)
    }
    try {
      // LiveCoinWatch coins
      if (keys.length > 0) {
        for (const [coinId, code] of Object.entries(COIN_LCW_CODE)) {
          const rate = await fetchPriceWithFallback(keys, code)
          if (rate !== null) {
            storePrice(coinId, rate)
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      // NonKYC coins (CapStash etc.) — fetched in parallel
      await Promise.all(
        Object.entries(NONKYC_PAIRS).map(async ([coinId, pair]) => {
          const rate = await fetchFromNonkyc(pair)
          if (rate !== null) {
            storePrice(coinId, rate)
          }
        }),
      )
      // NestEx coins fetched in parallel.
      await Promise.all(
        Object.entries(NESTEX_PAIRS).map(async ([coinId, pair]) => {
          const rate = await fetchFromNestex(pair)
          if (rate !== null) {
            storePrice(coinId, rate)
          }
        }),
      )
      // SafeTrade, then an independent NestEx pair, then the existing market.
      await Promise.all(
        Object.entries(SAFETRADE_PAIRS).map(async ([coinId, pair]) => {
          let rate = await fetchFromSafetrade(pair)
          if (rate === null && SAFETRADE_NESTEX_FALLBACKS[coinId]) {
            rate = await fetchFromNestex(SAFETRADE_NESTEX_FALLBACKS[coinId])
          }
          if (rate === null && COINPAPRIKA_MARKETS[coinId]) {
            rate = await fetchFromCoinpaprikaMarket(COINPAPRIKA_MARKETS[coinId])
          }
          if (rate !== null) {
            storePrice(coinId, rate)
          }
        }),
      )
      await Promise.all(
        Object.entries(COINPAPRIKA_TICKERS).map(async ([coinId, paprikaId]) => {
          const rate = await fetchFromCoinpaprikaTicker(paprikaId)
          if (rate !== null) storePrice(coinId, rate)
        }),
      )
      // The existing CoinGecko fallback uses one request for every ID.
      if (!refreshed.has('nexa')) {
        try {
          const response = await fetchWithTimeout('https://api.mexc.com/api/v3/ticker/price?symbol=NEXAUSDT')
          if (response.ok) {
            const row = await response.json(), rate = Number(row?.price)
            if (row?.symbol === 'NEXAUSDT' && Number.isFinite(rate) && rate > 0) storePrice('nexa', rate)
          }
        } catch { /* Retain only a still-fresh verified quote. */ }
      }
      const fallback = await fetchFromCoingecko(Object.values(COINGECKO_IDS))
      for (const [coinId, id] of Object.entries(COINGECKO_IDS)) {
        if (!refreshed.has(coinId) && fallback[id] !== undefined) storePrice(coinId, fallback[id])
      }
      lastRefreshAt = Date.now()
      logger.info('priceFeed.refreshed', { coins: cache.size })
    } finally {
      refreshing = false
    }
  }

  // Initial fetch on boot, then schedule periodic refresh.
  refresh().catch((err) => logger.warn('priceFeed.initialFailed', { error: err.message }))
  const timer = setInterval(() => {
    refresh().catch((err) => logger.warn('priceFeed.refreshFailed', { error: err.message }))
  }, REFRESH_INTERVAL_MS)
  timer.unref?.()

  return {
    snapshot: () => {
      const prices = {}
      const priceUpdatedAt = {}
      for (const [coinId, entry] of cache) {
        // Failed refreshes may preserve a short-lived quote, never indefinitely.
        if (Date.now() - entry.updatedAt > 30 * 60_000 || Date.now() < entry.updatedAt) continue
        prices[coinId] = entry.usd
        priceUpdatedAt[coinId] = entry.updatedAt
      }
      // Arbitrum gas is ETH, never the ARB governance token.
      if (prices.ethereum !== undefined) {
        prices.arbitrum = prices.ethereum
        priceUpdatedAt.arbitrum = priceUpdatedAt.ethereum
      }
      return { prices, updatedAt: lastRefreshAt || null, priceUpdatedAt }
    },
  }
}

module.exports = {
  startPriceFeed,
  COIN_LCW_CODE,
  NONKYC_PAIRS,
  NESTEX_PAIRS,
  SAFETRADE_PAIRS,
  COINPAPRIKA_MARKETS,
  COINPAPRIKA_TICKERS,
  COINGECKO_IDS,
}
