'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { entropyToMnemonic } = require('@scure/bip39'), { wordlist } = require('@scure/bip39/wordlists/english')
const { derive } = require('../modules/account-common/keys.cjs')
const { NETWORKS } = require('../modules/account-common/networks.cjs')
const { evmAdapter, ERC20 } = require('../modules/evm/adapter.cjs')
const { solAdapter } = require('../modules/sol/adapter.cjs')
const { tronAdapter } = require('../modules/trx/adapter.cjs')
const { createAccountPlugin } = require('../modules/account-common/runtime.cjs')
const { Transaction, getAddress } = require('ethers')
// Public BIP-39 zero-entropy vector, generated in memory; never logged.
const mnemonic = () => entropyToMnemonic(new Uint8Array(16), wordlist)
const evmOwner = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', recipient = '0x000000000000000000000000000000000000dEaD'
const hex = n => '0x' + BigInt(n).toString(16)
test('account balance outages and damaged token caches preserve a verified network without inventing zero', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-account-outage-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let failBalance = true
  const runtime = createAccountPlugin('tron', { dataDirectory: directory, adapter: {
    validate: () => true, normalize: value => value, head: async () => ({ height: 100 }),
    balance: async () => { if (failBalance) throw Error('Temporary read failure'); return '1234567' },
    discover: async () => ({ candidates: [], complete: false }),
  } })
  t.after(() => runtime.close())
  const first = await runtime.request('snapshot', { addresses: ['PUBLIC_TRON_FIXTURE'] })
  assert.equal(first.network.ok, true); assert.equal(first.network.blocks, 100)
  assert.deepEqual(first.balances, {})
  assert.equal(first.errors['balance:PUBLIC_TRON_FIXTURE'], 'Current balance could not be verified')
  await runtime.waitForIdle()
  failBalance = false
  const recovered = await runtime.request('snapshot', { addresses: ['PUBLIC_TRON_FIXTURE'] })
  assert.equal(recovered.balances.PUBLIC_TRON_FIXTURE.balance, '1234567')
  assert.equal(recovered.errors['balance:PUBLIC_TRON_FIXTURE'], undefined)
  const filename = path.join(directory, require('node:crypto').createHash('sha256').update('tron:OTHER_PUBLIC_TRON_FIXTURE').digest('hex') + '.json')
  fs.writeFileSync(filename, '{damaged public token cache')
  const damaged = await runtime.request('snapshot', { addresses: ['OTHER_PUBLIC_TRON_FIXTURE'] })
  assert.equal(damaged.network.ok, true)
  assert.equal(damaged.balances.OTHER_PUBLIC_TRON_FIXTURE.balance, '1234567')
  assert.equal(damaged.errors.assets, 'Saved token state is unavailable')
})
test('standard account paths have known public BIP-39/SLIP-10 addresses', () => {
  for (const network of ['ethereum', 'bsc', 'polygon', 'arbitrum']) assert.equal(derive(network, mnemonic()), evmOwner)
  assert.equal(derive('solana', mnemonic()), 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk')
  assert.equal(derive('tron', mnemonic()), 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')
})
function evmMock({ chain = 1, gas = 1000000000000n, fail = false } = {}) {
  const calls = []
  return { calls, rpc: async (method, params) => {
    calls.push({ method, params })
    if (method === 'eth_chainId') return hex(chain)
    if (method === 'eth_blockNumber') return '0x64'
    if (method === 'eth_getBalance') { if (fail) throw Error('timeout'); return hex(10n ** 20n) }
    if (method === 'eth_getTransactionCount') return '0x7'
    if (method === 'eth_gasPrice') return hex(gas)
    if (method === 'eth_estimateGas') return '0x5208'
    if (method === 'eth_getLogs') return []
    if (method === 'eth_call') {
      const call = ERC20.parseTransaction({ data: params[0].data })
      return ERC20.encodeFunctionResult(call.name, [({ balanceOf: 123456789012345678901n, decimals: 18, symbol: 'UNIT', name: 'Unit token', transfer: true })[call.name]])
    }
    throw Error('Unexpected method: ' + method)
  } }
}
test('EVM token amounts and MAX fee remain exact above 2^53; signatures have correct chain and sender', async () => {
  const transport = evmMock(), adapter = evmAdapter('ethereum', NETWORKS.ethereum, transport), block = await adapter.head()
  const token = await adapter.token(recipient, evmOwner, block)
  assert.equal(token.atomic, '123456789012345678901')
  const prepared = await adapter.prepare({ owner: evmOwner, to: recipient, amount: '0', max: true }, block)
  assert.equal(prepared.feeAtomic, '26250000000000000')
  assert.equal(BigInt(prepared.atomic) + BigInt(prepared.feeAtomic), 10n ** 20n)
  const signed = await adapter.sign({ ...prepared, owner: evmOwner }, mnemonic()), decoded = Transaction.from(signed.serialized)
  assert.equal(decoded.from, evmOwner); assert.equal(decoded.to, recipient); assert.equal(decoded.chainId, 1n)
  assert.equal(decoded.nonce, 7); assert.equal(decoded.hash, signed.txid)
  const transfer = await adapter.prepare({ owner: evmOwner, to: recipient, asset: token, amount: '1.000000000000000001' }, block)
  assert.equal(ERC20.decodeFunctionData('transfer', transfer.unsigned.data)[1], 1000000000000000001n)
  assert.equal(transfer.unsigned.value, '0')
  assert.ok(!transport.calls.some(c => /send|broadcast/i.test(c.method)))
})
test('EVM rejects wrong network, preserves read failures, bounds discovery to individual blocks', async () => {
  await assert.rejects(evmAdapter('ethereum', NETWORKS.ethereum, evmMock({ chain: 56 })).head(), /Unexpected/)
  const adapter = evmAdapter('ethereum', NETWORKS.ethereum, evmMock({ fail: true }))
  await assert.rejects(adapter.balance(evmOwner, { tag: 'latest' }), /timeout/)
  const transport = evmMock(), working = evmAdapter('ethereum', NETWORKS.ethereum, transport)
  const discovery = await working.discover(evmOwner, { cursor: 10 }, { height: 100 })
  assert.equal(discovery.complete, false); assert.equal(discovery.cursor, 100)
  assert.equal(transport.calls.length, 4)
  assert.ok(transport.calls.every(x => x.params[0].fromBlock === x.params[0].toBlock))
})
test('EVM native snapshot works without downloading a full block and rejects invalid heights', async () => {
  const transport = evmMock({ chain: 137 }), adapter = evmAdapter('polygon', NETWORKS.polygon, transport)
  const head = await adapter.head()
  assert.equal(head.height, 100)
  assert.equal(await adapter.balance(evmOwner, head), '100000000000000000000')
  assert.ok(!transport.calls.some(c => c.method === 'eth_getBlockByNumber'))
  for (const value of [null, '0x20000000000000', 'bad-height']) {
    const broken = evmAdapter('polygon', NETWORKS.polygon, { rpc: async m => m === 'eth_chainId' ? '0x89' : value })
    await assert.rejects(broken.head())
  }
})
test('EVM token MAX accepts an empty amount and reads pending units once without redundant metadata', async () => {
  const transport = evmMock(), adapter = evmAdapter('ethereum', NETWORKS.ethereum, transport)
  const asset = await adapter.token(recipient, evmOwner, { tag: 'latest' })
  transport.calls.length = 0
  const prepared = await adapter.prepare({ owner: evmOwner, to: recipient, asset, amount: '', max: true }, { tag: 'latest' })
  assert.equal(prepared.atomic, asset.atomic)
  const reads = transport.calls.filter(c => c.method === 'eth_call')
  assert.deepEqual(reads.map(c => ERC20.parseTransaction({ data: c.params[0].data }).name), ['balanceOf', 'transfer'])
  assert.equal(reads[0].params[1], 'pending')
  assert.ok(!transport.calls.some(c => /send|broadcast/i.test(c.method)))
})
test('an optional EVM metadata timeout retains that contract name while its balance refreshes', async () => {
  const base = evmMock(), adapter = evmAdapter('ethereum', NETWORKS.ethereum, { rpc: async (method, args) => {
    if (method === 'eth_call' && ['name', 'symbol'].includes(ERC20.parseTransaction({ data: args[0].data }).name)) throw Error('Metadata timeout')
    return base.rpc(method, args)
  } })
  const previous = { id: recipient, name: 'Previously read name', symbol: 'PREV' }
  const token = await adapter.token(recipient, evmOwner, { tag: 'latest' }, previous)
  assert.equal(token.name, previous.name); assert.equal(token.symbol, previous.symbol)
  assert.equal(token.atomic, '123456789012345678901')
  const wrong = await adapter.token(recipient, evmOwner, { tag: 'latest' }, { ...previous, id: evmOwner })
  assert.notEqual(wrong.name, previous.name)
})
test('Solana native preparation is unsigned; offline serialization/signature verifies and MAX retains fee', async () => {
  const kit = require('@solana/kit'), { ed25519 } = require('@noble/curves/ed25519'), { base58 } = require('@scure/base')
  const owner = derive('solana', mnemonic()), calls = []
  const adapter = solAdapter(NETWORKS.solana, { rpc: async (method, args) => {
    calls.push(method)
    if (method === 'getGenesisHash') return NETWORKS.solana.genesis
    if (method === 'getSlot') return 100
    if (method === 'getBlockHeight') return 100
    if (method === 'getBalance') return { context: { slot: 100 }, value: '10000000000' }
    if (method === 'getLatestBlockhash') return { value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 200 } }
    if (method === 'getFeeForMessage') return { value: 5000 }
    if (method === 'simulateTransaction') { assert.equal(args[1].sigVerify, false); return { value: { err: null } } }
    throw Error('Unexpected RPC')
  } })
  const prepared = await adapter.prepare({ owner, to: base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(7))), amount: '1', max: true }, await adapter.head())
  assert.equal(prepared.atomic, '9999995000'); assert.equal(prepared.feeAtomic, '5000')
  assert.ok(Object.values(prepared.unsigned.signatures).every(v => v === null))
  const signed = await adapter.sign({ ...prepared, owner }, mnemonic())
  const decoded = kit.getTransactionDecoder().decode(Buffer.from(signed.serialized, 'base64'))
  assert.ok(ed25519.verify(decoded.signatures[owner], decoded.messageBytes, base58.decode(owner)))
  assert.equal(kit.getSignatureFromTransaction(decoded), signed.txid)
  assert.ok(!calls.includes('sendTransaction'))
})
test('Tron constructs reference-bound transaction locally; offline SDK signature matches txID', async () => {
  const owner = derive('tron', mnemonic()), calls = [], { TronWeb } = require('tronweb')
  const to = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
  const block = { blockID: '0000000000000064' + 'ab'.repeat(24), block_header: { raw_data: { number: 100, timestamp: Date.now() } } }
  const adapter = tronAdapter(NETWORKS.tron, { url: 'https://tron-rpc.publicnode.com', tron: async (route, args) => {
    calls.push(route)
    if (route === '/wallet/getblock' && args.id_or_num === '0') return { blockID: NETWORKS.tron.genesis }
    if (route.endsWith('getnowblock') || route === '/walletsolidity/getblock') return block
    if (route.endsWith('getaccount')) return { address: args.address, balance: 100000000 }
    if (route.endsWith('getchainparameters')) return { chainParameter: [{ key: 'getTransactionFee', value: 1000 }, { key: 'getEnergyFee', value: 100 }] }
    throw Error('Unexpected Tron route')
  } })
  const prepared = await adapter.prepare({ owner, to, amount: '1' }, await adapter.head())
  assert.equal(prepared.unsigned.raw_data.contract[0].parameter.value.amount, 1000000)
  assert.equal(prepared.unsigned.raw_data.ref_block_bytes, '0064')
  assert.equal(prepared.unsigned.raw_data.ref_block_hash, 'abababababababab')
  assert.equal(prepared.unsigned.signature, undefined)
  const signed = await adapter.sign({ ...prepared, owner }, mnemonic())
  assert.equal(signed.serialized.signature.length, 1)
  assert.equal(signed.serialized.txID, signed.txid)
  assert.equal(require('tronweb').utils.transaction.txCheck(signed.serialized), true)
  const { secp256k1 } = require('@noble/curves/secp256k1'), key = require('../modules/account-common/keys.cjs').keyFor('tron', mnemonic())
  assert.ok(secp256k1.verify(Buffer.from(signed.serialized.signature[0].slice(0, 128), 'hex'), Buffer.from(signed.txid, 'hex'), secp256k1.getPublicKey(Buffer.from(key.privateKey, 'hex'))))
  assert.ok(!calls.some(x => /broadcast|create|triggerSmart/.test(x)))
})
test('account runtime separates discovery restrictions from native balance, persists spam override per address, consumes previews once', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-accounts-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let time = 1000000, broadcasts = 0, unavailable = false
  const adapter = { normalize: getAddress, validate: value => { try { getAddress(value); return true } catch { return false } },
    head: async () => { if (unavailable) throw Error('timeout'); return { height: 100 } }, balance: async () => '1230000000000000000',
    discover: async () => ({ candidates: [recipient], complete: false, reason: 'history-not-indexed' }),
    token: async () => ({ id: recipient, name: 'Claim free reward at example.xyz', symbol: 'GIFT', decimals: 18, atomic: '7', complete: true }),
    prepare: async () => ({ atomic: '7', feeAtomic: '10000000000000001', nativeRequired: '10000000000000001', unsigned: {} }),
    sign: async () => ({ txid: '0x' + 'ab'.repeat(32), serialized: 'offline-fixture' }) }
  const runtime = createAccountPlugin('ethereum', { dataDirectory: directory, adapter, now: () => time, transport: { broadcast: async () => { broadcasts++; throw Error('timeout after acceptance') } } })
  const snapshot = await runtime.request('snapshot', { addresses: [evmOwner] })
  assert.equal(snapshot.balances[evmOwner].balance, '1230000000000000000'); assert.equal(snapshot.network.initialBlockDownload, false)
  await runtime.waitForIdle()
  let assets = await runtime.request('assets', { owner: evmOwner })
  assert.equal(assets.discovery.complete, false); assert.equal(assets.tokens[0].visible, false)
  await runtime.request('setAssetVisibility', { owner: evmOwner, asset: recipient, visibility: 'show' })
  const other = await runtime.request('assets', { owner: recipient }); assert.equal(other.tokens.length, 0)
  const preview = await runtime.request('prepareTransfer', { owner: evmOwner, to: recipient, asset: recipient, amount: '0.000000000000000007' })
  assert.equal(preview.fee, '0.010000000000000001'); assert.equal(broadcasts, 0)
  const result = await runtime.request('send', { planId: preview.planId, confirmed: true, mnemonic: 'mock-not-a-seed' })
  assert.equal(result.status, 'unknown'); assert.equal(broadcasts, 1)
  assert.ok((await runtime.request('send', { planId: preview.planId, confirmed: true })).error)
  assert.equal(broadcasts, 1)
  unavailable = true; time += 40000
  await runtime.request('assets', { owner: evmOwner, force: true }); await runtime.waitForIdle()
  assets = await runtime.request('assets', { owner: evmOwner }); assert.equal(assets.tokens[0].status, 'unavailable'); assert.equal(assets.tokens[0].atomic, '7')
  await runtime.close()
  const restored = createAccountPlugin('ethereum', { dataDirectory: directory, adapter, now: () => time })
  assert.equal((await restored.request('assets', { owner: evmOwner })).tokens[0].visible, true)
  assert.ok(fs.readdirSync(directory).every(name => !fs.readFileSync(path.join(directory, name), 'utf8').includes('mock-not-a-seed')))
  await restored.close()
})
test('parallel token reads cannot overflow persistent capacity; existing tokens can be reimported at the limit', async t => {
  const os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto')
  const { createAccountPlugin } = require('../modules/account-common/runtime.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-token-capacity-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const owner = 'PUBLIC_CAPACITY_OWNER', record = id => ({ id, name: 'Fixture', symbol: 'UNIT', decimals: 0, atomic: '1', amount: '1', status: 'verified', verifiedAt: 1, complete: true })
  const tokens = Object.fromEntries(Array.from({ length: 499 }, (_, i) => ['TOKEN_' + i, record('TOKEN_' + i)]))
  fs.writeFileSync(path.join(root, crypto.createHash('sha256').update('ethereum:' + owner).digest('hex') + '.json'), JSON.stringify({ schemaVersion: 1, owner, tokens, candidates: [], discovery: { complete: false }, receipts: [] }))
  const runtime = createAccountPlugin('ethereum', { dataDirectory: root, iconCache: { load: async () => ({ status: 'missing' }) }, adapter: {
    validate: () => true, normalize: value => value, head: async () => ({ height: 1 }), discover: async () => ({ candidates: ['NEW_A', 'NEW_B'], complete: false }),
    token: async id => { await new Promise(resolve => setImmediate(resolve)); return record(id) },
  } })
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => runtime.request('importAsset', { owner, asset: 'NEW_' + i })))
  assert.equal(results.filter(r => !r.error).length, 1)
  await runtime.request('assets', { owner, force: true }); await runtime.waitForIdle()
  assert.equal((await runtime.request('assets', { owner })).tokens.length, 500)
  assert.equal((await runtime.request('importAsset', { owner, asset: 'TOKEN_0' })).error, undefined)
  await runtime.close()
})

test('account submission retains its transaction ID if saving the post-submission status fails', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-receipt-io-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const txid = '0x' + '12'.repeat(32); let broadcasts = 0
  const adapter = { normalize: value => value, validate: () => true, head: async () => ({ height: 1 }),
    prepare: async () => ({ atomic: '1', feeAtomic: '1', nativeRequired: '1', unsigned: {} }),
    sign: async () => ({ txid, serialized: 'OFFLINE_RECEIPT_FIXTURE' }) }
  const original = fs.renameSync
  const runtime = createAccountPlugin('ethereum', { dataDirectory: directory, adapter, transport: {
    broadcast: async () => { broadcasts++; fs.renameSync = () => { throw Object.assign(Error('fixture disk full'), { code: 'ENOSPC' }) }; return txid },
  } })
  try {
    const plan = await runtime.request('prepareTransfer', { owner: evmOwner, to: recipient, amount: '0.000000000000000001' })
    const result = await runtime.request('send', { planId: plan.planId, confirmed: true, mnemonic: 'MOCK_ONLY' })
    assert.equal(result.txid, txid); assert.equal(result.status, 'submitted'); assert.equal(broadcasts, 1)
    const stored = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json'))), 'utf8'))
    assert.equal(stored.receipts[0].txid, txid); assert.equal(stored.receipts[0].status, 'unknown')
    assert.ok((await runtime.request('send', { planId: plan.planId, confirmed: true })).error)
    assert.equal(broadcasts, 1)
  } finally { fs.renameSync = original; await runtime.close() }
})

test('account submission stops before broadcasting when its durable checkpoint cannot be saved', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-checkpoint-io-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let broadcasts = 0
  const adapter = { normalize: value => value, validate: () => true, head: async () => ({ height: 1 }),
    prepare: async () => ({ atomic: '1', feeAtomic: '1', nativeRequired: '1', unsigned: {} }),
    sign: async () => ({ txid: '0x' + '34'.repeat(32), serialized: 'OFFLINE_CHECKPOINT_FIXTURE' }) }
  const runtime = createAccountPlugin('ethereum', { dataDirectory: directory, adapter, transport: { broadcast: async () => { broadcasts++ } } })
  const plan = await runtime.request('prepareTransfer', { owner: evmOwner, to: recipient, amount: '0.000000000000000001' })
  const original = fs.renameSync
  try {
    fs.renameSync = () => { throw Object.assign(Error('fixture disk full'), { code: 'ENOSPC' }) }
    const result = await runtime.request('send', { planId: plan.planId, confirmed: true, mnemonic: 'MOCK_ONLY' })
    assert.match(result.error, /Nothing was submitted/); assert.equal(broadcasts, 0)
  } finally { fs.renameSync = original; await runtime.close() }
})
