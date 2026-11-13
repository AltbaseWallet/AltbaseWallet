'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { EventEmitter } = require('node:events')
const { entropyToMnemonic } = require('@scure/bip39'), { wordlist } = require('@scure/bip39/wordlists/english')
const { createRuntime } = require('../modules/xelis/runtime/index.cjs'), keys = require('../modules/xelis/runtime/keys.cjs')
const { bundle } = require('./bundle-helper.cjs')
const txid = 'ab'.repeat(32)
async function fixture(t, submit = async () => true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-xelis-fixture-'))
  const phrase = entropyToMnemonic(new Uint8Array(16), wordlist), derived = keys.derive(phrase), owner = derived.address
  derived.key.fill(0); derived.nativeMnemonic = ''; derived.password = ''
  const calls = [], child = new EventEmitter(); child.exitCode = null
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0) }
  const runtime = createRuntime({ baseDir: directory, nodeUrl: 'https://offline.invalid', binary: '/never-executed',
    getNetwork: async () => ({ blocks: 100, stableTopoheight: 98 }),
    spawnWithPrivateConfig: async () => child,
    rpc: async (_state, method, params) => {
      calls.push({ method, params })
      if (method === 'get_address') return owner
      if (method === 'is_online') return true
      if (method === 'get_topoheight') return 100
      if (method === 'get_balance') return 1000000000
      if (method === 'estimate_fees') return 2000
      if (method === 'build_transaction') {
        assert.equal(params.broadcast, false); assert.equal(params.tx_as_hex, true)
        assert.deepEqual(params.fee, { fixed: 2000 }); assert.equal(params.fee_limit, 2000)
        return { tx_as_hex: 'deadbeef', hash: txid, fee: 2000 }
      }
      throw Error('Unexpected wallet fixture operation')
    },
    submitTransaction: async hex => { assert.equal(hex, 'deadbeef'); calls.push({ method: 'submit_transaction' }); return submit() },
  })
  t.after(async () => { await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  await runtime.derive({ mnemonic: phrase })
  for (let i = 0; i < 100; i++) {
    const snapshot = await runtime.snapshot({ address: owner, network: { blocks: 100, stableTopoheight: 98 }, includeHistory: false })
    if (!snapshot.syncing) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return { runtime, calls, input: { fromAddress: owner, toAddress: owner, amountCoin: '1', maxFeeCoin: '0.00002' } }
}
test('Xelis prepares a known hash without broadcasting and consumes the prepared transaction once', async t => {
  const f = await fixture(t), prepared = await f.runtime.prepare(f.input)
  assert.equal(prepared.txid, txid)
  assert.equal(f.calls.filter(c => c.method === 'submit_transaction').length, 0)
  assert.equal((await f.runtime.broadcastPrepared(prepared)).txid, txid)
  await assert.rejects(f.runtime.broadcastPrepared(prepared), e => e.txid === txid && e.uncertain === true)
  assert.equal(f.calls.filter(c => c.method === 'submit_transaction').length, 1)
})
test('Xelis preserves the known hash after a lost response and never retries it', async t => {
  const f = await fixture(t, async () => { throw Error('Fixture relay response lost') }), prepared = await f.runtime.prepare(f.input)
  await assert.rejects(f.runtime.broadcastPrepared(prepared), e => e.txid === txid && e.uncertain === true)
  await assert.rejects(f.runtime.broadcastPrepared(prepared), e => e.txid === txid && e.uncertain === true)
  assert.equal(f.calls.filter(c => c.method === 'submit_transaction').length, 1)
})
test('Xelis does not prepare or submit a transaction above the approved fee', async t => {
  const f = await fixture(t)
  await assert.rejects(f.runtime.prepare({ ...f.input, maxFeeCoin: '0.00001' }), /Fee changed/)
  assert.equal(f.calls.filter(c => ['build_transaction', 'submit_transaction'].includes(c.method)).length, 0)
})
test('Xelis renderer persists its checkpoint before the SDK can submit', async () => {
  const calls = []
  const globals = { window: { altbaseWallet: { coinSdk: async request => {
    calls.push(request.method)
    return { ok: true, result: { txid, amountCoin: '1', feeCoin: '0.00002' } }
  } } } }
  const { createLocalWalletEngine } = await bundle('src/wallet-engines/sdk/localWalletEngine.ts', {}, globals)
  const engine = createLocalWalletEngine('xelis-local'), input = { coin: { id: 'xelis' }, fromAddress: 'fixture', toAddress: 'fixture', amountCoin: '1' }
  await assert.rejects(engine.send({ ...input, onPrepared: async () => { throw Error('Fixture profile storage unavailable') } }), /storage/)
  assert.deepEqual(calls, ['prepare'])
  calls.length = 0
  await engine.send({ ...input, onPrepared: async prepared => { assert.equal(prepared.txid, txid); calls.push('checkpoint') } })
  assert.deepEqual(calls, ['prepare', 'checkpoint', 'broadcastPrepared'])
})
test('Xelis bridge retains uncertainty metadata rather than losing the transaction identity', async () => {
  const { createLocalWalletEngine } = await bundle('src/wallet-engines/sdk/localWalletEngine.ts', {}, { window: { altbaseWallet: { coinSdk: async request =>
    request.method === 'prepare' ? { ok: true, result: { txid, amountCoin: '1', feeCoin: '0.00002' } }
      : { ok: false, error: 'Fixture gateway timeout', txid, uncertain: true } } } })
  const engine = createLocalWalletEngine('xelis-local')
  await assert.rejects(engine.send({ coin: { id: 'xelis' }, fromAddress: 'fixture', toAddress: 'fixture', amountCoin: '1', onPrepared: async () => {} }), e => e.txid === txid && e.uncertain === true)
})
