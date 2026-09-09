'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createJiti } = require('jiti')
const jiti = createJiti(__filename)
const { coinApiService } = jiti('../src/services/coinApiService.ts')
const { nativeCoreService } = jiti('../src/services/nativeCoreService.ts')
const { coinTxService } = jiti('../src/services/coinTxService.ts')

const params = {
  coinId: 'scash', satsPerCoin: 100_000_000,
  fromAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/805'/0'/0/0" },
}

test('MAX waits for the current fee and funding set instead of approving a display fallback', async (t) => {
  t.mock.method(coinApiService, 'getUtxosForAddresses', async (_coin, _addresses, options) => {
    assert.equal(options.force, true)
    assert.equal(options.fast, false)
    return [{ txid: 'ab'.repeat(32), outputIndex: 0, satoshis: '100000000', script: '51' }]
  })
  t.mock.method(coinApiService, 'getFeeRate', async (_coin, _blocks, timeout, options) => {
    assert.ok(timeout >= 30_000)
    assert.equal(options.force, true)
    return { feerate: 0.0002, relayFee: 0.00001 }
  })
  t.mock.method(nativeCoreService, 'planTransaction', async (plan) => {
    assert.equal(plan.feeRatePerKb, 0.0002)
    return { amountSatoshis: 99995392n, feeSatoshis: 4608, inputCount: 1 }
  })
  assert.deepEqual(await coinTxService.estimateMaxSend(params), {
    amountCoin: '0.99995392', feeCoin: '0.00004608', feeSatoshis: 4608, inputCount: 1,
  })
})

test('an unavailable fee cannot silently become an approved MAX amount', async (t) => {
  t.mock.method(coinApiService, 'getUtxosForAddresses', async () => [
    { txid: 'ab'.repeat(32), outputIndex: 0, satoshis: '100000000', script: '51' },
  ])
  t.mock.method(coinApiService, 'getFeeRate', async () => { throw new Error('fee server unavailable') })
  const planner = t.mock.method(nativeCoreService, 'planTransaction', async () => { throw new Error('must not plan') })
  await assert.rejects(coinTxService.estimateMaxSend(params), /fee server unavailable/)
  assert.equal(planner.mock.callCount(), 0)
})
