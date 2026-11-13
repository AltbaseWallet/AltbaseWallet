'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { tronAdapter } = require('../modules/trx/adapter.cjs'), { NETWORKS } = require('../modules/account-common/networks.cjs')
const { Interface, AbiCoder } = require('ethers'), { TronWeb } = require('tronweb')
const owner = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', to = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
test('Tron height checks use only headers, share in-flight reads and recover from an identity timeout', async () => {
  let rejectIdentity = true
  const calls = [], adapter = tronAdapter(NETWORKS.tron, { url: 'https://tron-rpc.publicnode.com', tron: async (route, params) => {
    calls.push({ route, params }); await new Promise(resolve => setImmediate(resolve))
    assert.equal(params.detail, false)
    if (route === '/wallet/getblock') {
      assert.equal(params.id_or_num, '0')
      if (rejectIdentity) throw Error('Temporary identity read failure')
      return { blockID: NETWORKS.tron.genesis }
    }
    assert.equal(route, '/walletsolidity/getblock')
    return { blockID: 'ab'.repeat(32), block_header: { raw_data: { number: 100 } } }
  } })
  await assert.rejects(adapter.head(), /Temporary/)
  rejectIdentity = false
  const results = await Promise.all([adapter.head(), adapter.head(), adapter.head()])
  assert.ok(results.every(result => result.height === 100))
  await adapter.head()
  assert.equal(calls.filter(call => call.route === '/wallet/getblock').length, 2)
  assert.equal(calls.filter(call => call.route === '/walletsolidity/getblock').length, 2)
})
test('Tron rejects and does not cache a wrong network identity', async () => {
  let attempts = 0
  const adapter = tronAdapter(NETWORKS.tron, { url: 'https://tron-rpc.publicnode.com', tron: async () => { attempts++; return { blockID: 'cd'.repeat(32) } } })
  await assert.rejects(adapter.head(), /Unexpected Tron network/)
  await assert.rejects(adapter.head(), /Unexpected Tron network/)
  assert.equal(attempts, 2)
})
test('TRC-20 preparation preserves uint256 token units and constructs only the reviewed transfer locally', async () => {
  const abi = new Interface(['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function name() view returns(string)', 'function symbol() view returns(string)'])
  const calls = [], block = { blockID: '0000000000000064' + 'ab'.repeat(24), block_header: { raw_data: { number: 100, timestamp: Date.now() } } }
  const adapter = tronAdapter(NETWORKS.tron, { url: 'https://tron-rpc.publicnode.com', tron: async (route, args) => {
    calls.push(route)
    if (route.endsWith('getnowblock')) return block
    if (route.endsWith('getaccount')) return { address: args.address, balance: 100000000 }
    if (route.endsWith('getchainparameters')) return { chainParameter: [{ key: 'getTransactionFee', value: 1000 }, { key: 'getEnergyFee', value: 100 }] }
    if (route.endsWith('triggerconstantcontract')) {
      const method = args.function_selector.split('(')[0]
      const value = { transfer: true, balanceOf: route === '/wallet/triggerconstantcontract' ? 1000000000000000000000n : 99999999999999999999999999n, decimals: 18, symbol: 'UNIT', name: 'Test token' }[method]
      return { result: { result: true }, energy_used: 20000, constant_result: [abi.encodeFunctionResult(method, [value]).slice(2)] }
    }
    throw Error('Unexpected method')
  } })
  const token = await adapter.token(contract, owner, { height: 100 })
  const prepared = await adapter.prepare({ owner, to, amount: '123.000000000000000001', asset: token }, { height: 100 })
  assert.equal(prepared.atomic, '123000000000000000001')
  const transfer = prepared.unsigned.raw_data.contract[0]
  assert.equal(transfer.type, 'TriggerSmartContract')
  assert.equal(transfer.parameter.value.owner_address, TronWeb.address.toHex(owner))
  assert.equal(transfer.parameter.value.contract_address, TronWeb.address.toHex(contract))
  const payload = 'a9059cbb' + AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], ['0x' + TronWeb.address.toHex(to).slice(2), 123000000000000000001n]).slice(2)
  assert.equal(transfer.parameter.value.data, payload)
  assert.equal(prepared.unsigned.raw_data.fee_limit, 3000000)
  assert.ok(BigInt(prepared.feeAtomic) > 3000000n)
  const maximum = await adapter.prepare({ owner, to, amount: '', asset: token, max: true }, { height: 100 })
  assert.equal(maximum.atomic, '1000000000000000000000')
  assert.ok(calls.every(route => !/broadcast|triggersmartcontract|createtransaction/.test(route)))
})
test('Tron error-shaped account responses do not become zero balances', async () => {
  const adapter = tronAdapter(NETWORKS.tron, { url: 'https://tron-rpc.publicnode.com', tron: async () => ({ code: 'UNAVAILABLE', message: 'busy' }) })
  await assert.rejects(adapter.balance(owner), /identity/)
})
test('TRC-20 metadata reads run together; optional failures preserve only the same contract metadata', async () => {
  const abi = new Interface(['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)'])
  let release, started = 0
  const gate = new Promise(resolve => { release = resolve })
  const adapter = tronAdapter(NETWORKS.tron, { url: 'https://tron-rpc.publicnode.com', tron: async (_route, args) => {
    started++; if (started % 4 === 0) release()
    await gate
    const method = args.function_selector.split('(')[0]
    if (['symbol', 'name'].includes(method)) throw Error('Metadata unavailable')
    return { result: { result: true }, constant_result: [abi.encodeFunctionResult(method, [method === 'decimals' ? 6 : 1234567n]).slice(2)] }
  } })
  const operation = adapter.token(contract, owner, {}, { id: contract, name: 'Previous name', symbol: 'PREV' })
  assert.equal(started, 4)
  const token = await operation
  assert.equal(token.name, 'Previous name'); assert.equal(token.symbol, 'PREV'); assert.equal(token.atomic, '1234567')
  const other = await adapter.token(contract, owner, {}, { id: to, name: 'Wrong token', symbol: 'WRONG' })
  assert.notEqual(other.name, 'Wrong token'); assert.notEqual(other.symbol, 'WRONG')
})
