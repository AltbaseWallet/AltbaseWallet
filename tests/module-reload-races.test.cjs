'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { bundle, deferred } = require('./bundle-helper.cjs')
async function fixture() {
  const coins = deferred(), started = deferred(), writes = []; let revision = 0, loads = 0
  const api = await bundle('src/services/moduleReloadService.ts', {
    'services/pluginService': { pluginService: { load: async () => { loads++; return { modules: [] } } } },
    'services/walletService': { walletService: { getSessionRevision: () => revision } },
    'services/coinService': { coinService: { getCoins: () => { started.resolve(); return coins.promise } } },
    'store/authStore': { useAuthStore: { getState: () => ({ isUnlocked: false }) } },
    'store/coinStore': { useCoinStore: { setState: value => writes.push(value) } },
  }, { window: { dispatchEvent: () => {} }, Event: class {} })
  return { api, coins, started, writes, changeSession: () => { revision++ }, loads: () => loads }
}
test('locking while module preferences load cannot restore stale coins', async () => {
  const f = await fixture(), operation = f.api.reloadInstalledModules()
  await f.started.promise; f.changeSession(); f.coins.resolve([{ id: 'OLD_WALLET_COIN' }]); await operation
  assert.equal(f.writes.length, 0)
})
test('a new session requesting module reload is serviced after the old reload finishes', async () => {
  const f = await fixture(), previous = f.api.reloadInstalledModules()
  await f.started.promise; f.changeSession()
  const current = f.api.reloadInstalledModules()
  f.coins.resolve([]); await Promise.all([previous, current])
  assert.equal(f.loads(), 2); assert.equal(f.writes.length, 1)
})
test('atomic integer parsing preserves exact values and rejects malformed supplied values', async () => {
  const { atomicAmountToBigInt } = await bundle('src/utils/atomicInteger.ts', {})
  assert.equal(atomicAmountToBigInt('9007199254740993'), 9007199254740993n)
  assert.equal(atomicAmountToBigInt('-1'), -1n)
  assert.equal(atomicAmountToBigInt(undefined), 0n); assert.equal(atomicAmountToBigInt(null), 0n)
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 0.1, NaN, Infinity, '', 'unavailable', '1e3', {}]) assert.throws(() => atomicAmountToBigInt(value), /atomic amount/)
})
