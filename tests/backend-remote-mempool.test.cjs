'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const root = path.resolve(__dirname, '..'), file = path.join(root, 'ops/backend/grandpool.cjs')
const instrumented = new Module(file, module)
instrumented.paths = Module._nodeModulePaths(root)
instrumented._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__test={...require_remoteUtxo(),...require_nexaRemote()};', file)
const { createGrandpoolAdapters, __test: { createRemoteUtxoAdapter, createNexaRemoteAdapter, createBlockbookProvider } } = instrumented.exports
const utxo = require('@bitgo/utxo-lib'), n = require('libnexa-ts')
const address = utxo.payments.p2pkh({ hash: Buffer.alloc(20, 1), network: utxo.networks.bitcoin }).address
const ownScript = utxo.address.toOutputScript(address, utxo.networks.bitcoin).toString('hex')
const txid = 'aa'.repeat(32), parent = 'bb'.repeat(32)
test('all five installed public UTXO adapters implement the mempool route', () => {
  const adapters = createGrandpoolAdapters()
  assert.equal(adapters.length, 5)
  for (const adapter of adapters) assert.equal(typeof adapter.getMempool, 'function', adapter.coin)
})
test('Electrum pending reads hydrate only the complete mempool result, with change accounted once', async () => {
  const reads = []
  const provider = { mempool: async () => [{ tx_hash: txid, height: 0 }], history: () => { throw Error('Confirmed history must not be scanned') },
    transaction: async id => { reads.push(id); return id === parent
      ? { vin: [{ coinbase: 'fixture' }], vout: [{ value: '10', scriptPubKey: { hex: ownScript } }] }
      : { vin: [{ txid: parent, vout: 0 }], vout: [{ value: '9', scriptPubKey: { hex: '6a' } }, { value: '0.9', scriptPubKey: { hex: ownScript } }] } } }
  const adapter = createRemoteUtxoAdapter({ coin: 'fixture', network: utxo.networks.bitcoin, provider })
  const result = await adapter.getMempool(address)
  assert.equal(result.hasPendingOutgoing, true)
  assert.equal(result.pending[0].txid, txid)
  assert.equal(result.pending[0].amount, '9.1')
  assert.deepEqual(reads, [txid, parent])
})
test('verified empty and failed pending reads remain distinct', async () => {
  const empty = createRemoteUtxoAdapter({ coin: 'fixture', network: utxo.networks.bitcoin, provider: { mempool: async () => [] } })
  assert.equal((await empty.getMempool(address)).hasPendingOutgoing, false)
  const failed = createRemoteUtxoAdapter({ coin: 'fixture', network: utxo.networks.bitcoin, provider: { mempool: async () => { throw Error('Fixture mempool outage') } } })
  await assert.rejects(failed.getMempool(address), /outage/)
})
test('Blockbook pending-only reads reject a stale or truncated address index', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous })
  let count = 2, synchronized = true
  global.fetch = async url => new Response(JSON.stringify(String(url).includes('/address/')
    ? { unconfirmedTxs: count, txids: [txid] }
    : { blockbook: { inSyncMempool: synchronized } }), { status: 200 })
  const provider = createBlockbookProvider({ baseUrls: ['https://fixture.invalid/api/v2'], decimals: 8 })
  await assert.rejects(provider.mempool(address), /incomplete/)
  count = 1
  assert.equal((await provider.mempool(address))[0].tx_hash, txid)
  synchronized = false
  await assert.rejects(provider.mempool(address), /not verified/)
})
test('Blockbook does not report an outgoing transaction from a changed confirmed index row', async () => {
  const provider = { blockbook: true, network: async () => ({ initialBlockDownload: false }), mempool: async () => [{ tx_hash: txid, height: 0 }],
    transaction: async () => ({ confirmations: 1, vin: [], vout: [] }) }
  const adapter = createRemoteUtxoAdapter({ coin: 'fixture', network: utxo.networks.bitcoin, provider })
  await assert.rejects(adapter.getMempool(address), /changed/)
})
test('Nexa pending reads exclude confirmed history before hydrating transactions', async () => {
  const owner = n.HDPrivateKey.fromSeed(Buffer.alloc(32, 1), 'mainnet').privateKey.toAddress().toString()
  const script = n.ScriptFactory.buildOutFromAddress(n.Address.fromString(owner)).toHex(), calls = []
  const adapter = createNexaRemoteAdapter({ request: async (_url, method, params) => {
    calls.push([method, params])
    if (method === 'blockchain.address.get_history') return [{ tx_hash: parent, height: 100 }, { tx_hash: txid, height: 0 }]
    if (method === 'blockchain.transaction.get') return { vin: [{ addresses: [owner], value_satoshi: 1000 }], vout: [{ value_satoshi: 50, scriptPubKey: { hex: script } }] }
    throw Error('Unexpected read')
  } })
  const result = await adapter.getMempool(owner)
  assert.equal(result.hasPendingOutgoing, true)
  assert.equal(result.pending[0].amount, '9.50')
  assert.equal(calls.filter(([method]) => method === 'blockchain.transaction.get').length, 1)
})
