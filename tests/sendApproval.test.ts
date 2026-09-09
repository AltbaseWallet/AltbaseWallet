import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { getBytes, hexlify, sha256 } from 'ethers'

const require = createRequire(import.meta.url)
const jiti = require('jiti').createJiti(import.meta.url)
const { coinTxService, UtxoBroadcastError } = jiti('../src/services/coinTxService.ts')
const { coinApiService } = jiti('../src/services/coinApiService.ts')
const { nativeCoreService } = jiti('../src/services/nativeCoreService.ts')
const script = `76a914${'11'.repeat(20)}88ac`
const raw = `0100000001${'aa'.repeat(32)}0000000000ffffffff0100e1f5050000000019${script}00000000`
const txid = hexlify(getBytes(sha256(sha256(`0x${raw}`))).reverse()).slice(2)
const address = '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'

test('the send pipeline rejects unapproved fees and false input values before signing or broadcasting', async (t) => {
  let inputValue = 100_000_000
  let fee = 1_000
  t.mock.method(coinApiService, 'getUtxosForAddresses', async () => [
    { txid, outputIndex: 0, satoshis: inputValue, script, height: 100 },
  ])
  t.mock.method(coinApiService, 'getRawTransaction', async () => raw)
  t.mock.method(coinApiService, 'getFeeRate', async () => ({ feerate: 0.00001 }))
  t.mock.method(nativeCoreService, 'addressToScript', async () => script)
  t.mock.method(nativeCoreService, 'planTransaction', async () => ({
    selectedInputs: [{ txid, vout: 0, satoshis: inputValue, script }],
    outputs: [{ satoshis: BigInt(inputValue - fee), script }],
    amountSatoshis: BigInt(inputValue - fee), feeSatoshis: fee, inputCount: 1,
  }))
  const sign = t.mock.method(nativeCoreService, 'signTransaction', async () => ({ txid: 'test-only', txHex: '00' }))
  const broadcast = t.mock.method(coinApiService, 'broadcast', async () => 'test-only')
  const params = { coinId: 'bitcoin', satsPerCoin: 100_000_000,
    cryptoParams: { p2pkhPrefix: 0, p2shPrefix: 5, wifPrefix: 128, derivationPath: "m/44'/0'/0'/0/0" },
    mnemonic: 'unused by mocked signer', fromAddress: address, toAddress: address,
    amountCoin: '0.99999', maxFeeCoin: '0.00001', sendMax: true }

  inputValue = 1_000_000
  await assert.rejects(coinTxService.send(params), /does not match its transaction/)
  inputValue = 100_000_000
  fee = 1_001
  await assert.rejects(coinTxService.send(params), /fee increased/)
  fee = 1_000
  await assert.rejects(coinTxService.send({ ...params, amountCoin: '0.99998' }), /MAX amount changed/)
  assert.equal(sign.mock.callCount(), 0)
  assert.equal(broadcast.mock.callCount(), 0)

  const result = await coinTxService.send(params)
  assert.equal(result.txid, 'test-only')
  assert.equal(sign.mock.callCount(), 1)
  assert.equal(broadcast.mock.callCount(), 1)

  broadcast.mock.mockImplementation(async () => {
    throw new Error('mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)')
  })
  await assert.rejects(coinTxService.send(params), (error: unknown) =>
    error instanceof UtxoBroadcastError && (error as { uncertain: boolean }).uncertain === false)
})

test('native planner dust omitted from change is included in the actual fee', async (t) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  // Only the bridge response is mocked; use the production parser and fee calculation.
  globalThis.window = { altbaseWallet: { core: async () => ({ ok: true, result: {
    selectedInputs: `${txid}:0:100000:${script}`, outputs: `98700:${script}`,
    amountSatoshis: '98700', feeSatoshis: '1000', inputCount: '1',
  } }) } } as unknown as Window & typeof globalThis
  const plan = await nativeCoreService.planTransaction({ mode: 'send', utxos: [], satsPerCoin: 100_000_000, feeRatePerKb: 0.00001 })
  assert.equal(plan.feeSatoshis, 1_300)
})
