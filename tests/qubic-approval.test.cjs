'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { webcrypto } = require('node:crypto'), { bundle } = require('./bundle-helper.cjs')
async function fixture(balance, tick = 42) {
  let signatures = 0, broadcasts = 0
  const owner = 'A'.repeat(60), to = 'B'.repeat(60)
  const { qubicWalletService } = await bundle('src/services/qubicWalletService.ts', {
    '@qubic-lib/qubic-ts-library/dist/qubicHelper': { QubicHelper: class {
      async createIdPackage() { return { publicId: owner } }
      async verifyIdentity() { return true }
      async createTransaction() { signatures++; return new Uint8Array(144).fill(1) }
      async getHumanReadableBytes() { return 'c'.repeat(60) }
    } },
    '@qubic-lib/qubic-ts-library/dist/crypto': { default: Promise.resolve({ K12: (_input, output) => output.fill(1) }) },
    'services/coinApiService': { coinApiService: {
      getBalance: async () => ({ balance, balance_spendable: balance }),
      getAccountTxContext: async () => ({ targetTick: tick }),
      broadcast: async () => { broadcasts++; return 'c'.repeat(60) },
    } },
  }, { crypto: webcrypto, btoa: value => Buffer.from(value, 'binary').toString('base64') })
  return { service: qubicWalletService, params: { coinId: 'qubic', mnemonic: 'MOCK_ONLY', fromAddress: owner, toAddress: to, amountCoin: '100', sendMax: true },
    signatures: () => signatures, broadcasts: () => broadcasts }
}
for (const balance of ['99', '101']) test(`Qubic MAX balance changing to ${balance} requires a new approval before signing`, async () => {
  const f = await fixture(balance)
  await assert.rejects(f.service.send(f.params), error => error.code === 'SPEND_APPROVAL_CHANGED')
  assert.equal(f.signatures(), 0); assert.equal(f.broadcasts(), 0)
})
test('Qubic rejects a target tick that would wrap the signing library uint32 field', async () => {
  const f = await fixture('100', 0x100000000)
  await assert.rejects(f.service.send(f.params), /valid target tick/)
  assert.equal(f.signatures(), 0); assert.equal(f.broadcasts(), 0)
})
test('Qubic awaits its checkpoint before any submission', async () => {
  const f = await fixture('100')
  await assert.rejects(f.service.send({ ...f.params, onPrepared: async prepared => {
    assert.equal(prepared.txid, 'c'.repeat(60)); assert.equal(f.broadcasts(), 0)
    throw Error('fixture storage failure')
  } }), /storage failure/)
  assert.equal(f.broadcasts(), 0)
})
test('Qubic unchanged MAX and explicit ordinary amounts retain their approved values', async () => {
  const max = await fixture('100'), result = await max.service.send(max.params)
  assert.equal(result.amountCoin, '100'); assert.equal(max.signatures(), 1); assert.equal(max.broadcasts(), 1)
  const normal = await fixture('101'), sent = await normal.service.send({ ...normal.params, amountCoin: '10', sendMax: false })
  assert.equal(sent.amountCoin, '10'); assert.equal(normal.signatures(), 1)
})
