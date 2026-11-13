'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { bundle } = require('./bundle-helper.cjs')
test('identified submissions make one attempt and classify mismatches, timeouts and explicit rejections', async () => {
  const { submitIdentifiedTransaction, BroadcastError } = await bundle('src/utils/broadcastOutcome.ts', {})
  for (const [outcome, uncertain] of [
    [Error('fixture timeout'), true],
    [Object.assign(Error('fixture 503'), { status: 503 }), true],
    [Object.assign(Error('fixture 400'), { status: 400 }), false],
    [Object.assign(Error('fixture 408'), { status: 408 }), true],
    ['different-fixture-id', true],
  ]) {
    let calls = 0
    await assert.rejects(submitIdentifiedTransaction('fixture-id', async () => {
      calls++; if (outcome instanceof Error) throw outcome; return outcome
    }), error => error instanceof BroadcastError && error.txid === 'fixture-id' && error.uncertain === uncertain)
    assert.equal(calls, 1)
  }
  for (const outcome of ['FIXTURE-ID', Error('already known')]) {
    let calls = 0
    await submitIdentifiedTransaction('fixture-id', async () => { calls++; if (outcome instanceof Error) throw outcome; return outcome })
    assert.equal(calls, 1)
  }
})
test('Quai registry dispatch retains the approved maximum fee', async () => {
  const calls = []
  const { quaiEngine } = await bundle('src/wallet-engines/account/quaiEngine.ts', {
    'services/quaiWalletService': { quaiWalletService: { send: async params => { calls.push(params); return { txid: 'fixture-id' } } } },
  })
  await quaiEngine.send({ coin: { id: 'quai' }, mnemonic: 'MOCK_ONLY', fromAddress: 'fixture-owner', toAddress: 'fixture-to', amountCoin: '1', maxFeeCoin: '0.1' })
  assert.equal(calls.length, 1); assert.equal(calls[0].maxFeeCoin, '0.1')
})
for (const id of ['zcash', 'nexa']) test(`${id} signed SDK bytes are checkpointed before the relay can receive them`, async () => {
  let broadcasts = 0
  const { createSdkUtxoEngine } = await bundle('src/wallet-engines/sdk/sdkUtxoEngine.ts', {
    'services/coinApiService': { coinApiService: { getUtxos: async () => [], getNetwork: async () => ({ blocks: 100 }), getFeeRate: async () => ({ feerate: 3 }),
      broadcast: async () => { broadcasts++; return 'fixture-id' } } },
  }, { window: { altbaseWallet: { coinSdk: async () => ({ ok: true, result: { hex: 'MOCK_BYTES', txid: 'fixture-id', amountCoin: '1', feeCoin: '0.1' } }) } } })
  const engine = createSdkUtxoEngine(id + '-utxo'), input = { coin: { id }, mnemonic: 'MOCK_ONLY', fromAddress: 'fixture-owner', toAddress: 'fixture-to', amountCoin: '1' }
  await assert.rejects(engine.send({ ...input, onPrepared: async prepared => { assert.equal(prepared.txid, 'fixture-id'); throw Error('fixture checkpoint failure') } }), /checkpoint failure/)
  assert.equal(broadcasts, 0)
  assert.equal((await engine.send(input)).txid, 'fixture-id'); assert.equal(broadcasts, 1)
})
