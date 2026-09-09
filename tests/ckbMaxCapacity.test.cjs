'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const {createJiti} = require('jiti')
const jiti = createJiti(__filename)
const {Address, ClientPublicMainnet, Transaction, SignerCkbPrivateKey} = require('@ckb-ccc/core')
const {coinApiService} = jiti('../src/services/coinApiService.ts')
const {ckbWalletService} = jiti('../src/services/ckbWalletService.ts')
// Public test vector; never funded or broadcast.
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('CKB MAX accepts balances between 61 and 62 CKB and plans exactly without signing the available capacity less its fee', async (t) => {
  const address = await ckbWalletService.deriveAddress(mnemonic)
  const lock = (await Address.fromString(address, new ClientPublicMainnet())).script
  const parent = Transaction.from({outputs: [{capacity: 6150000000n, lock}], outputsData: ['0x']})
  t.mock.method(coinApiService, 'getUtxos', async () => [{txid: parent.hash(), outputIndex: 0, cellOutput: parent.outputs[0], outputData: '0x'}])
  t.mock.method(coinApiService, 'getFeeRate', async () => ({feerate: 0.00001}))
  t.mock.method(ClientPublicMainnet.prototype, 'getTransaction', async () => ({transaction: parent}))
  const sign = t.mock.method(SignerCkbPrivateKey.prototype, 'signOnlyTransaction', async () => {throw Error('Signing is forbidden in MAX')})
  const estimate = await ckbWalletService.estimateMaxSend('ckb', address, address)
  assert.equal(sign.mock.callCount(), 0)
  assert.ok(Number(estimate.amountCoin) > 61)
  assert.ok(estimate.feeSatoshis > 0 && estimate.feeSatoshis < 10000)
  assert.equal(Math.round(Number(estimate.amountCoin) * 1e8) + estimate.feeSatoshis, 6150000000)
})

test('CKB MAX rejects exactly the minimum cell capacity before requesting transaction proofs', async (t) => {
  const address = await ckbWalletService.deriveAddress(mnemonic)
  const lock = (await Address.fromString(address, new ClientPublicMainnet())).script
  t.mock.method(coinApiService, 'getUtxos', async () => [{txid: `0x${'11'.repeat(32)}`, outputIndex: 0, cellOutput: {capacity: 6100000000n, lock}, outputData: '0x'}])
  t.mock.method(coinApiService, 'getFeeRate', async () => ({feerate: 0.00001}))
  const lookup = t.mock.method(ClientPublicMainnet.prototype, 'getTransaction', async () => {throw Error('Unexpected network request')})
  await assert.rejects(ckbWalletService.estimateMaxSend('ckb', address, address), /61 CKB.*plus the network fee/)
  assert.equal(lookup.mock.callCount(), 0)
})

// Proof requests stay bounded while independent parents are fetched concurrently.
test('CKB MAX fetches parent proofs concurrently with a limit of four', async (t) => {
  const address = await ckbWalletService.deriveAddress(mnemonic)
  const lock = (await Address.fromString(address, new ClientPublicMainnet())).script
  const parents = Array.from({length:9}, (_, i) => Transaction.from({
    outputs:[{capacity:BigInt(6200000000+i),lock}], outputsData:['0x'],
  }))
  const byHash = new Map(parents.map(p => [p.hash(),p]))
  let active=0, peak=0, calls=0
  t.mock.method(coinApiService, 'getUtxos', async () => parents.map(p => ({txid:p.hash(),outputIndex:0,cellOutput:p.outputs[0],outputData:'0x'})))
  t.mock.method(coinApiService, 'getFeeRate', async () => ({feerate:0.00001}))
  t.mock.method(ClientPublicMainnet.prototype, 'getTransaction', async (hash) => {
    active++;calls++;peak=Math.max(peak,active)
    await new Promise(resolve => setTimeout(resolve,5))
    active--;return {transaction:byHash.get(hash)}
  })
  const sign=t.mock.method(SignerCkbPrivateKey.prototype,'signOnlyTransaction',async () => {throw Error('Signing forbidden')})
  const result=await ckbWalletService.estimateMaxSend('ckb',address,address)
  assert.equal(calls,9);assert.equal(peak,4);assert.equal(sign.mock.callCount(),0)
  assert.equal(BigInt(Math.round(Number(result.amountCoin)*1e8))+BigInt(result.feeSatoshis),parents.reduce((sum,p)=>sum+p.outputs[0].capacity,0n))
})
