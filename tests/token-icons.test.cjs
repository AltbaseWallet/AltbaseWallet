'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { PNG } = require('pngjs')
const { createIconCache, iconIdentity, sanitizePng } = require('../modules/account-common/icons.cjs')
const { createAccountPlugin } = require('../modules/account-common/runtime.cjs')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const contract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', owner = '0x000000000000000000000000000000000000dEaD'
function png() {
  const source = new PNG({ width: 181, height: 181 }); source.data.fill(200)
  return PNG.sync.write(source)
}
test('contract and chain determine the logo URL; names and tickers cannot substitute another identity', () => {
  const eth = iconIdentity('ethereum', contract.toLowerCase())
  assert.equal(eth.url, `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${contract}/logo.png`)
  assert.notEqual(eth.key, iconIdentity('bsc', contract).key)
  assert.match(iconIdentity('bsc', contract).url, /blockchains\/smartchain\//)
  assert.throws(() => iconIdentity('ethereum', '../../logo.png'))
  assert.throws(() => iconIdentity('solana', 'USDC'))
})
test('on-demand download is decoded, resized, cached locally and never fetched again for the same contract', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icons-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let calls = 0
  const cache = createIconCache('ethereum', root, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, iconIdentity('ethereum', contract).url); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined)
    return new Response(png(), { headers: { 'Content-Type': 'image/png' } })
  } })
  assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(root), [])
  const icon = await cache.load(contract); assert.equal(icon.status, 'cached'); assert.equal(calls, 1)
  const saved = fs.readFileSync(path.join(root, 'token-icons', icon.key + '.png')), image = PNG.sync.read(saved)
  assert.equal(image.width, 128); assert.equal(image.height, 128)
  assert.deepEqual(await cache.load(contract.toLowerCase()), icon); assert.equal(calls, 1)
  const manager = new PluginManager({ dataRoot: path.dirname(root), installedRoots: [] })
  manager.modules.set(path.basename(root), { descriptor: { capabilities: ['assets'] } })
  assert.equal(manager.tokenIcon(path.basename(root), icon.key).mime, 'image/png')
  assert.equal(manager.tokenIcon(path.basename(root), '../../private'), null)
})
test('logo failure is separate from token validity; reject HTML, SVG, redirects, oversized and malformed PNGs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icons-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(() => sanitizePng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))
  const huge = Buffer.from(png()); huge.writeUInt32BE(999999, 16); assert.throws(() => sanitizePng(huge), /dimensions/)
  const corrupted = Buffer.from(png()); corrupted[29] ^= 255; assert.throws(() => sanitizePng(corrupted))
  for (const response of [() => new Response('missing', { status: 404 }), () => new Response('<html>bad</html>'), () => new Response('', { status: 302, headers: { Location: 'https://example.com/' } }), () => new Response('x', { headers: { 'Content-Length': '9999999' } })]) {
    const result = await createIconCache('ethereum', root, { fetchImpl: async () => response() }).load(contract)
    assert.ok(['missing', 'unavailable'].includes(result.status))
    assert.deepEqual(fs.readdirSync(root), [])
  }
})
test('startup, automatic discovery and balance refresh never download icons; explicit import does', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-import-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let calls = 0
  const runtime = createAccountPlugin('ethereum', { dataDirectory: root, iconCache: { load: async () => { calls++; return { status: 'missing' } } },
    adapter: { normalize: value => value, validate: () => true, head: async () => ({ height: 1 }), balance: async () => '1',
      discover: async () => ({ candidates: [contract], complete: false, reason: 'partial' }),
      token: async () => ({ id: contract, name: 'Unit', symbol: 'UNIT', decimals: 6, atomic: '1234567', complete: true }) } })
  assert.equal(calls, 0)
  await runtime.request('snapshot', { addresses: [owner] }); await runtime.waitForIdle()
  assert.equal(calls, 0)
  await runtime.request('assets', { owner, force: true }); await runtime.waitForIdle(); assert.equal(calls, 0)
  await runtime.request('importAsset', { owner, asset: contract }); await runtime.waitForIcons()
  const imported = await runtime.request('assets', { owner })
  assert.equal(calls, 1); assert.equal(imported.tokens[0].amount, '1.234567'); assert.equal(imported.tokens[0].icon.status, 'missing')
  await runtime.request('assets', { owner, force: true }); await runtime.waitForIdle(); assert.equal(calls, 1)
  await runtime.close()
})
test('icon import survives a concurrent background refresh replacing the token record', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-race-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let finishIcon, started
  const iconStarted = new Promise(resolve => { started = resolve })
  const pendingIcon = new Promise(resolve => { finishIcon = resolve })
  const runtime = createAccountPlugin('ethereum', { dataDirectory: root,
    iconCache: { load: async () => { started(); return pendingIcon } },
    adapter: { normalize: value => value, validate: () => true, head: async () => ({ height: 1 }),
      discover: async () => ({ candidates: [contract], complete: false }),
      token: async () => ({ id: contract, name: 'Unit', symbol: 'UNIT', decimals: 6, atomic: '1234567', complete: true }) } })
  const importing = runtime.request('importAsset', { owner, asset: contract })
  await iconStarted
  await runtime.request('assets', { owner, force: true }); await runtime.waitForIdle()
  finishIcon({ key: iconIdentity('ethereum', contract).key, status: 'cached' })
  await importing; await runtime.waitForIcons()
  const imported = await runtime.request('assets', { owner })
  assert.equal(imported.tokens[0].icon?.status, 'cached')
  await runtime.close()
})
test('lost icon metadata is repaired from disk without a network request, including after restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-repair-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const cache = createIconCache('ethereum', root, { fetchImpl: async () => new Response(png()) })
  const icon = await cache.load(contract)
  const offline = createIconCache('ethereum', root, { fetchImpl: () => { throw Error('Network forbidden') } })
  assert.equal(offline.peek(contract).key, icon.key)
  const runtime = createAccountPlugin('ethereum', { dataDirectory: root, iconCache: offline,
    adapter: { normalize: value => value, validate: () => true, head: async () => ({ height: 1 }),
      discover: async () => ({ candidates: [contract], complete: false }),
      token: async () => ({ id: contract, name: 'Unit', symbol: 'UNIT', decimals: 6, atomic: '1', complete: true }) } })
  await runtime.request('assets', { owner, force: true }); await runtime.waitForIdle()
  assert.equal((await runtime.request('assets', { owner })).tokens[0].icon.key, icon.key)
  await runtime.close()
})
test('a malformed cached PNG is fetched again only after explicit import', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-corrupt-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const key = iconIdentity('ethereum', contract).key
  fs.mkdirSync(path.join(root, 'token-icons')); fs.writeFileSync(path.join(root, 'token-icons', key + '.png'), Buffer.alloc(100))
  let requests = 0
  const cache = createIconCache('ethereum', root, { fetchImpl: async () => { requests++; return new Response(png()) } })
  assert.equal(cache.peek(contract), undefined); assert.equal(requests, 0)
  assert.equal((await cache.load(contract)).status, 'cached'); assert.equal(requests, 1)
})
test('fallback logo lookup matches the full network and base-token contract, never the quote or ticker', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-fallback-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const requests = []
  const cache = createIconCache('ethereum', root, { fetchImpl: async url => {
    requests.push(url)
    if (url.startsWith('https://raw.githubusercontent.com/')) return new Response('', { status: 404 })
    if (url.startsWith('https://api.dexscreener.com/')) return Response.json([
      { chainId: 'bsc', baseToken: { address: contract }, info: { imageUrl: 'https://cdn.dexscreener.com/cms/images/wrong-chain' } },
      { chainId: 'ethereum', baseToken: { address: owner }, quoteToken: { address: contract }, info: { imageUrl: 'https://cdn.dexscreener.com/cms/images/wrong-quote' } },
      { chainId: 'ethereum', baseToken: { address: contract }, info: { imageUrl: 'http://127.0.0.1/private' } },
      { chainId: 'ethereum', baseToken: { address: contract }, info: { imageUrl: 'https://cdn.dexscreener.com.evil.example/cms/images/wrong-host' } },
      { chainId: 'ethereum', baseToken: { address: contract }, info: { imageUrl: 'https://cdn.dexscreener.com/cms/images/correct?width=800&format=auto' } },
    ])
    assert.equal(url, 'https://cdn.dexscreener.com/cms/images/correct?width=128&height=128&fit=contain&quality=95&format=png')
    return new Response(png())
  } })
  assert.equal(requests.length, 0)
  const icon = await cache.load(contract)
  assert.equal(icon.status, 'cached'); assert.equal(icon.source, 'dexscreener-logo'); assert.equal(requests.length, 3)
})
test('icon cache refuses symlink directories without reading outside the profile', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-links-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const data = path.join(root, 'data'), outside = path.join(root, 'outside'); fs.mkdirSync(data); fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(data, 'token-icons'))
  const cache = createIconCache('ethereum', data, { fetchImpl: async () => new Response(png()) })
  assert.equal(cache.peek(contract), undefined); assert.equal((await cache.load(contract)).status, 'unavailable'); assert.deepEqual(fs.readdirSync(outside), [])
})
test('JPEG logo responses are bounded and re-encoded as PNG rather than silently lost', () => {
  const { sanitizeImage } = require('../modules/account-common/icons.cjs'), jpeg = require('jpeg-js')
  const data = Buffer.alloc(64 * 64 * 4, 180), encoded = jpeg.encode({ width: 64, height: 64, data }, 80).data
  const safe = PNG.sync.read(sanitizeImage(encoded))
  assert.equal(safe.width, 64); assert.equal(safe.height, 64)
  assert.throws(() => sanitizeImage(encoded.subarray(0, 30)))
  const large = jpeg.encode({ width: 700, height: 700, data: Buffer.alloc(700 * 700 * 4) }, 30).data
  assert.throws(() => sanitizeImage(large), /maxResolution|dimensions/)
})
test('failed imported icons recover with backoff across restart, independently of RPC and without reimport', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-retry-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let clock = 100000, downloads = 0, online = false, rpcOnline = true, release
  const cache = createIconCache('ethereum', root, { fetchImpl: async () => {
    downloads++
    if (!online) throw Error('Temporary image server timeout')
    return new Promise(resolve => { release = () => resolve(new Response(png())) })
  } })
  const options = { dataDirectory: root, iconCache: cache, now: () => clock,
    adapter: { normalize: value => value, validate: () => true, head: async () => { if (!rpcOnline) throw Error('RPC unavailable'); return { height: 1 } },
      discover: async () => ({ candidates: [], complete: false }),
      token: async () => ({ id: contract, name: 'Unit', symbol: 'UNIT', decimals: 6, atomic: '1234567', complete: true }) } }
  let runtime = createAccountPlugin('ethereum', options)
  await runtime.request('importAsset', { owner, asset: contract }); await runtime.waitForIcons()
  const first = await runtime.request('assets', { owner })
  assert.equal(first.tokens[0].icon.status, 'unavailable'); assert.equal(first.tokens[0].amount, '1.234567')
  const initialDownloads = downloads
  for (let i = 0; i < 4; i++) await runtime.request('assets', { owner })
  await runtime.waitForIdle(); assert.equal(downloads, initialDownloads)
  await runtime.close()
  runtime = createAccountPlugin('ethereum', options)
  await runtime.request('assets', { owner }); await runtime.waitForIdle()
  assert.equal(downloads, initialDownloads)
  clock += 31000; online = true; rpcOnline = false
  const whileDownloading = await runtime.request('assets', { owner, force: true })
  assert.equal(whileDownloading.tokens[0].amount, '1.234567')
  assert.equal(downloads, initialDownloads + 1)
  release(); await runtime.waitForIcons(); await runtime.waitForIdle()
  const recovered = await runtime.request('assets', { owner })
  assert.equal(recovered.tokens[0].icon.status, 'cached')
  assert.equal(recovered.tokens[0].status, 'unavailable') // Logo never certifies a balance.
  assert.equal(downloads, initialDownloads + 1)
  await runtime.close()
})
test('legacy explicit imports retry a missing logo; unsolicited discovered tokens do not opt in', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-legacy-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const other = '0x0000000000000000000000000000000000000001'
  const filename = require('node:crypto').createHash('sha256').update('ethereum:' + owner).digest('hex') + '.json'
  const token = id => ({ id, name: 'Unit', symbol: 'UNIT', decimals: 6, atomic: '1', amount: '0.000001', verifiedAt: 1, assessment: { classification: 'unverified' } })
  fs.writeFileSync(path.join(root, filename), JSON.stringify({ schemaVersion: 1, owner, candidates: [other], tokens: { [contract]: token(contract), [other]: token(other) } }))
  const downloads = [], cache = createIconCache('ethereum', root, { fetchImpl: async url => { downloads.push(url); return new Response(png()) } })
  const runtime = createAccountPlugin('ethereum', { dataDirectory: root, iconCache: cache,
    adapter: { validate: () => true, normalize: value => value, head: async () => { throw Error('offline') } } })
  await runtime.request('assets', { owner }); await runtime.waitForIcons(); await runtime.waitForIdle()
  const result = await runtime.request('assets', { owner })
  assert.equal(result.tokens.find(t => t.id === contract).icon.status, 'cached')
  assert.equal(result.tokens.find(t => t.id === other).icon, undefined)
  assert.deepEqual(downloads, [iconIdentity('ethereum', contract).url])
  await runtime.close()
})
test('adding a verified token and reading balances never wait for its slow logo download', { timeout: 3000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-background-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let finish, cached
  const runtime = createAccountPlugin('ethereum', { dataDirectory: root,
    iconCache: { peek: () => cached, load: async () => new Promise(resolve => { finish = () => { cached = { key: iconIdentity('ethereum', contract).key, status: 'cached' }; resolve(cached) } }) },
    adapter: { normalize: value => value, validate: () => true, head: async () => ({ height: 1 }), balance: async () => '99',
      discover: async () => ({ candidates: [], complete: false }),
      token: async () => ({ id: contract, name: 'Unit', symbol: 'UNIT', decimals: 6, atomic: '1234567', complete: true }) } })
  t.after(async () => { finish?.(); await runtime.close() })
  const imported = await runtime.request('importAsset', { owner, asset: contract })
  assert.equal(imported.tokens[0].amount, '1.234567'); assert.notEqual(imported.tokens[0].icon?.status, 'cached')
  const snapshot = await runtime.request('snapshot', { addresses: [owner] })
  assert.equal(snapshot.balances[owner].balance, '99')
  finish(); await runtime.waitForIcons(); await runtime.waitForIdle()
  assert.equal((await runtime.request('assets', { owner })).tokens[0].icon.status, 'cached')
})
