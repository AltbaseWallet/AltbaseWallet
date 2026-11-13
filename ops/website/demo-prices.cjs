'use strict'
// The public demo uses the same dated native-coin quotes as the desktop wallet.
const MAX_AGE_MS = 20 * 60 * 1000
function sanitizeQuotes(data, now = Date.now()) {
  if (data?.ok !== true || !data.prices || !data.priceUpdatedAt) throw Error('Wallet prices unavailable')
  const prices = {}, priceUpdatedAt = {}
  for (const [coin, value] of Object.entries(data.prices)) {
    if (['btgs', 'nonsense', 'hypercoin', 'mydogecoin'].includes(coin)) continue
    const at = data.priceUpdatedAt[coin]
    if (!/^[a-z0-9]+$/.test(coin) || !Number.isFinite(value) || value <= 0 || !Number.isFinite(at) || now - at >= MAX_AGE_MS || at > now + 300000) continue
    prices[coin] = value; priceUpdatedAt[coin] = at
  }
  if (!Object.keys(prices).length) throw Error('Fresh wallet prices unavailable')
  return { ok: true, prices, priceUpdatedAt, updatedAt: Math.max(...Object.values(priceUpdatedAt)), source: 'Altbase wallet price feed' }
}
function createPriceFeed(fetcher = fetch, clock = Date.now) {
  let cached = null, expiresAt = 0, pending = null
  return async function getDemoPrices() {
    if (cached && clock() < expiresAt) return sanitizeQuotes(cached, clock())
    if (pending) return pending
    pending = (async () => {
      const response = await fetcher('https://api.altbase.io/api/v1/prices', { headers: { Accept: 'application/json', 'User-Agent': 'Altbase-Website-Demo' }, signal: AbortSignal.timeout(12000) })
      if (!response.ok) throw Error('Wallet price feed unavailable')
      const result = sanitizeQuotes(await response.json(), clock())
      cached = result; expiresAt = clock() + 30000
      return result
    })()
    try { return await pending } finally { pending = null }
  }
}
module.exports = { sanitizeQuotes, createPriceFeed }
