// Delisting affects this frontend only. Keep module files, cached balances and
// backend routes available to older wallet versions.
const delistedCoinIds = new Set(['hypercoin', 'mydogecoin', 'nonsense', 'btgs'])

export const isListedCoin = (coinId: string): boolean => !delistedCoinIds.has(coinId)

const listedEntries = (value: unknown, key: string): unknown => Array.isArray(value)
  ? value.filter(entry => !entry || typeof entry[key] !== 'string' || isListedCoin(entry[key]))
  : value

// Filter the embedded miner's view without changing its shared module or the
// catalog used by older wallet versions. Existing jobs remain accessible.
export const listedMiningResult = (method: string, result: unknown): unknown => {
  if (method === 'customPools') return listedEntries(result, 'coinId')
  if (method !== 'catalog' || !result || typeof result !== 'object' || Array.isArray(result)) return result
  const catalog = result as Record<string, unknown>
  return { ...catalog, coins: listedEntries(catalog.coins, 'id'), pools: listedEntries(catalog.pools, 'coinId') }
}
