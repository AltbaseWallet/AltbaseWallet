'use strict'
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path'), vm = require('node:vm')
let api, calls = [], data = new Map(), catalogModules = []
before(async () => {
  const { rolldown } = await import('rolldown')
  const bundle = await rolldown({ input: path.join(__dirname, 'frontend-entry.ts'), platform: 'node' })
  const { output } = await bundle.generate({ format: 'cjs' }); await bundle.close()
  const mockRequest = async request => {
    calls.push(request)
    return { ok: true, result: request.method === 'derive' ? 'FIXTURE_ADDRESS'
      : request.method === 'validate' ? true
      : request.method === 'estimateFee' ? { coin: '0.01', satoshis: 1000000 }
      : request.method === 'estimateMax' ? { amountCoin: '9.99', feeCoin: '0.01' } : { txid: 'mock-only' } }
  }
  const exports = {}, context = { exports, module: { exports }, TextEncoder, Map, Set, console, crypto: require('node:crypto').webcrypto,
    btoa: text => Buffer.from(text).toString('base64'), localStorage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) },
    window: { altbaseWallet: { plugins: { request: mockRequest,
      catalog: async () => ({ ok: true, result: { modules: catalogModules, diagnostics: [], directory: '/fixture' } }),
    } } } }
  vm.runInNewContext(output[0].code, context); api = context.module.exports
})
test('decimal arithmetic preserves signs and handles exponent notation exactly', () => {
  assert.equal(api.toBaseUnits(-0.25), -25000000n)
  assert.equal(api.toBaseUnits(1e-8), 1n)
  assert.equal(api.toBaseUnits('1e+3'), 100000000000n)
  assert.equal(api.toBaseUnits('12345678901234567890.00000001'), 1234567890123456789000000001n)
  assert.equal(api.addAmounts('-1.25', '0.25'), '-1')
  for (const value of ['1.2.3', '12BTC', 'NaN', 'Infinity', '0x10', '1e99999', '1,000']) assert.throws(() => api.toBaseUnits(value))
})
test('plugin results cannot smuggle truthy non-booleans, negative fees or mismatched atomic amounts', () => {
  for (const value of ['false', 1, {}, null]) assert.throws(() => api.pluginBoolean(value))
  assert.equal(api.pluginBoolean(false), false)
  for (const value of [{coin:'-1',satoshis:1},{coin:'0.1',satoshis:1},{coin:'0.000000001',satoshis:0},{coin:'NaN',satoshis:0}]) assert.throws(() => api.pluginFee(value,8))
  assert.equal(api.pluginFee({coin:'0.00000001',satoshis:1},8).satoshis,1)
  assert.throws(() => api.pluginMax({amountCoin:'1',feeCoin:'0',inputCount:-1},8))
  assert.throws(() => api.pluginSendResult({txid:'../invalid',amountCoin:'1'},8))
})
test('partial address balances and explicit balance errors cannot publish a verified total', () => {
  const value=snapshot();delete value.walletBalance
  value.balances.a={balance:'1',balance_spendable:'1',received:'1',immature:'0'}
  assert.throws(()=>api.validatePluginSnapshot(value.coin,value,'local-fixture',['a','b']))
  const failed=snapshot();failed.errors={balance:'offline'}
  assert.throws(()=>api.validatePluginSnapshot(failed.coin,failed))
  const malformed=snapshot();malformed.balances=[]
  assert.throws(()=>api.validatePluginSnapshot(malformed.coin,malformed))
})
test('a verified plugin network survives explicit unavailable balances without inventing a zero', () => {
  const value = { coin: 'late-installed-coin', network: { ok: true, coin: 'late-installed-coin', chain: 'local-fixture', blocks: 100, headers: 100, initialBlockDownload: false },
    balances: {}, histories: {}, walletBalance: null, errors: { 'balance:PUBLIC_TRON_FIXTURE': 'Current balance could not be verified' } }
  const result = api.validatePluginSnapshot(value.coin, value, 'local-fixture', ['PUBLIC_TRON_FIXTURE'])
  assert.equal(result.network.ok, true); assert.equal(Object.keys(result.balances).length, 0)
  assert.throws(() => api.validatePluginSnapshot(value.coin, value, 'local-fixture', ['ANOTHER_ADDRESS']))
  assert.throws(() => api.validatePluginSnapshot(value.coin, { ...value, network: null }, 'local-fixture', ['PUBLIC_TRON_FIXTURE']))
})
const definition = (id = 'late-installed-coin', decimals = 8) => ({ id, name: 'Late Installed', ticker: 'LATE', version: '1.0.0', runtimeType: 'plugin', decimals,
  capabilities: ['derive', 'validate', 'estimateFee', 'estimateMax', 'send'], nativeRoute: `${id}-sdk`, coin: { id, name: 'Late Installed', ticker: 'LATE', networkId: 'local-fixture', balance: '0', address: '', status: 'preparing', enabled: true, favorite: false, walletEngine: 'plugin', satsPerCoin: 10 ** decimals } })
const install = modules => api.installPluginCatalog({ modules, diagnostics: [], directory: '/fixture' })
test('plugin transaction identifiers preserve case during history deduplication', () => {
  install([definition('case-sensitive')])
  const tx={coinId:'case-sensitive',id:'fixture',txHash:'AbCd'}
  assert.notEqual(api.transactionIdentityKey(tx),api.transactionIdentityKey({...tx,txHash:'abcd'}))
})
test('coins installed after module imports appear in the catalog without rebuilding', async () => {
  install([]); assert.equal(api.allCoins().length, 0)
  install([definition()]); assert.equal(api.allCoins()[0].id, 'late-installed-coin')
  assert.equal((await api.coinService.getCoins())[0].walletEngine, 'plugin')
})
test('delisted coins stay out of both the module GUI catalog and runtime registry after refresh', async () => {
  const retained = definition('late-installed-coin')
  catalogModules = [definition('hypercoin'), definition('mydogecoin'), definition('nonsense'), definition('btgs'), retained]
  const original = catalogModules.slice()
  const catalog = await api.pluginService.load(true)
  assert.deepEqual(Array.from(catalog.modules, m => m.id), [retained.id])
  assert.equal(api.pluginService.current(), catalog)
  assert.equal(api.coinModuleRegistry.get('hypercoin'), undefined)
  assert.equal(api.coinModuleRegistry.descriptor('mydogecoin'), undefined)
  assert.equal(api.coinModuleRegistry.get('nonsense'), undefined)
  assert.equal(api.coinModuleRegistry.get('btgs'), undefined)
  assert.deepEqual(Array.from(await api.coinService.getCoins(), c => c.id), [retained.id])
  assert.deepEqual(catalogModules, original, 'the installed/backend catalog is preserved')
  const alias = definition('alias'); alias.coin.id = 'hypercoin'
  install([alias, definition('mydogecoin'), retained])
  assert.deepEqual(Array.from(api.allCoins(), c => c.id), [retained.id])
})
test('delisting and saving visible coins preserves cached balances for older wallets', async () => {
  data.clear()
  const delisted = ['hypercoin', 'mydogecoin', 'nonsense', 'btgs']
  await api.coinService.saveCoins(delisted.map(id => ({ ...definition(id).coin, balance: '123.456', favorite: true })))
  install([...delisted.map(id => definition(id)), definition()])
  await api.coinService.saveCoins(await api.coinService.getCoins())
  const saved = [...data.values()].map(value => JSON.parse(value)).find(value => Array.isArray(value) && value.some(c => c.id === 'btgs'))
  for (const id of delisted) {
    assert.equal(saved.find(c => c.id === id).balance, '123.456')
    assert.equal(saved.find(c => c.id === id).favorite, true)
  }
})
test('the embedded miner hides delisted coins and pools while preserving jobs and source data', () => {
  const catalog = { version: 'fixture', coins: [{ id: 'hypercoin' }, { id: 'mydogecoin' }, { id: 'nonsense' }, { id: 'btgs' }, { id: 'zano' }],
    pools: [{ coinId: 'hypercoin' }, { coinId: 'nonsense' }, { coinId: 'btgs' }, { coinId: 'zano' }], miners: ['fixture'] }
  const filtered = api.listedMiningResult('catalog', catalog)
  assert.deepEqual(Array.from(filtered.coins, c => c.id), ['zano'])
  assert.deepEqual(Array.from(filtered.pools, c => c.coinId), ['zano'])
  assert.equal(catalog.coins.length, 5)
  assert.equal(api.listedMiningResult('listJobs', catalog), catalog)
  assert.deepEqual(Array.from(api.listedMiningResult('customPools', catalog.pools), c => c.coinId), ['zano'])
})
test('derive, validate, fees, MAX and mock sends are routed by runtime ID', async () => {
  const module = definition('another-new-coin'); install([module]); calls = []
  assert.equal(await api.pluginEngine.deriveAddress(module.coin, 'NOT_A_REAL_SEED'), 'FIXTURE_ADDRESS')
  assert.equal(await api.pluginEngine.validateAddress(module.coin, 'FIXTURE_ADDRESS'), true)
  await api.pluginEngine.estimateFee(module.coin, { toAddress: 'FIXTURE_ADDRESS' })
  assert.equal((await api.pluginEngine.estimateMaxSend(module.coin, 'FIXTURE_ADDRESS')).amountCoin, '9.99')
  assert.equal((await api.pluginEngine.send({ coin: module.coin, mnemonic: 'NOT_A_REAL_SEED', toAddress: 'FIXTURE_ADDRESS', amountCoin: '1' })).txid, 'mock-only')
  assert.equal(calls.length, 5); assert.ok(calls.every(c => c.coin === module.id))
  await assert.rejects(api.pluginEngine.exportSecret(module.coin, 'NOT_A_REAL_SEED'), /does not support/)
})
test('coin precision comes from a newly installed manifest', () => {
  install([definition('precision-coin', 12)])
  assert.equal(api.formatAmount('1.000000000001', 'LATE'), '1.000000000001 LATE')
})
test('temporarily removing a module preserves its wallet preferences and cached balance', async () => {
  data.clear(); const a = definition('preference-coin'); install([a])
  await api.coinService.saveCoins([{ ...a.coin, balance: '9', favorite: true, enabled: false }])
  install([]); await api.coinService.saveCoins([])
  install([a]); const restored = (await api.coinService.getCoins())[0]
  assert.equal(restored.balance, '9'); assert.equal(restored.favorite, true); assert.equal(restored.enabled, false)
})
const snapshot = () => ({ coin: 'late-installed-coin', network: { ok: true, coin: 'late-installed-coin', chain: 'local-fixture', blocks: 100, headers: 100, initialBlockDownload: false },
  walletBalance: { balance: '100', balance_spendable: '99', received: '100', immature: '1' }, balances: {}, histories: {} })
test('an unfinished plugin scan cannot report a verified zero', () => {
  const value = snapshot();value.network.headers = 200;value.network.initialBlockDownload = true;value.walletBalance.balance = '0'
  const validated = api.validatePluginSnapshot(value.coin, value)
  assert.equal(validated.walletBalance, null);assert.deepEqual(Object.keys(validated.balances), [])
  assert.match(validated.errors.balance, /incomplete/)
})
test('missing network proof, malformed amounts and wrong coin responses are rejected', () => {
  for (const change of [s => {s.network=null}, s => {delete s.walletBalance.balance}, s => {s.walletBalance.balance='NaN'}, s => {s.walletBalance.balance_spendable='101'}, s => {s.coin='different-coin'}, s => {delete s.network.initialBlockDownload}, s => {s.network.ok=false}, s => {s.network.chain='wrong-chain'}, s => {s.network.walletScanPercent=NaN}, s => {s.network.walletScanPercent=101}]) {
    const value = snapshot(); change(value); assert.throws(() => api.validatePluginSnapshot('late-installed-coin', value, 'local-fixture'))
  }
})
test('a complete verified zero remains a valid balance', () => {
  const value = snapshot(); for (const key of Object.keys(value.walletBalance)) value.walletBalance[key]='0'
  assert.equal(api.validatePluginSnapshot(value.coin, value).walletBalance.balance, '0')
})
test('wallet lock invalidates late balance readiness from the preceding session', () => {
  const revision = api.pluginReadiness.revision()
  api.pluginReadiness.set('fixture', 'ready', revision)
  api.pluginReadiness.reset()
  api.pluginReadiness.set('fixture', 'ready', revision)
  assert.equal(api.pluginReadiness.get('fixture'), 'unknown')
})
test('readiness changes notify views and retain explicit error/syncing states', () => {
  let changes = 0
  const off = api.pluginReadiness.subscribe(() => { changes++ })
  api.pluginReadiness.set('fixture', 'syncing')
  assert.equal(api.pluginReadiness.get('fixture'), 'syncing')
  api.pluginReadiness.set('fixture', 'error')
  assert.equal(api.pluginReadiness.get('fixture'), 'error')
  api.pluginReadiness.set('fixture', 'balance-unavailable')
  assert.equal(api.pluginReadiness.get('fixture'), 'balance-unavailable')
  off(); assert.equal(changes, 3)
})
