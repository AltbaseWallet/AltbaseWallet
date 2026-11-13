'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { solAdapter, PROGRAMS } = require('../modules/sol/adapter.cjs')
const { NETWORKS } = require('../modules/account-common/networks.cjs')
const { base58 } = require('@scure/base'), { ed25519 } = require('@noble/curves/ed25519')
const address = value => base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(value)))
const owner = address(1), other = address(2), mint = address(3), tokenAccount = address(4), destination = address(5)
const mintData = (program = PROGRAMS[0], extensions = []) => ({ owner: program, data: { parsed: { type: 'mint', info: { decimals: 6, isInitialized: true, extensions } } } })
const holding = (who, amount = '12500000', program = PROGRAMS[0]) => ({ owner: program, data: { parsed: { type: 'account', info: { owner: who, mint, state: 'initialized', tokenAmount: { amount, decimals: 6 } } } } })
test('Solana inventory is owner-scoped; a restricted scan rechecks known non-associated accounts', async () => {
  let restricted = false, currentOwner = owner
  const adapter = solAdapter(NETWORKS.solana, { rpc: async (method, params) => {
    if (method === 'getTokenAccountsByOwner') {
      if (restricted) { const e = Error('blocked'); e.code = 403; throw e }
      currentOwner = params[0]
      return { context: { slot: 90 }, value: params[1].programId === PROGRAMS[0] ? [{ pubkey: tokenAccount, account: holding(params[0]) }] : [] }
    }
    if (method === 'getAccountInfo') return { context: { slot: 90 }, value: mintData() }
    if (method === 'getMultipleAccounts') return { context: { slot: 90 }, value: params[0].map(a => a === tokenAccount ? holding(currentOwner) : null) }
    throw Error('Unexpected method')
  } })
  await adapter.discover(owner, {}, { height: 100 })
  const first = await adapter.token(mint, owner, { height: 100 })
  assert.equal(first.atomic, '12500000'); assert.equal(first.complete, true)
  await adapter.discover(other, {}, { height: 100 })
  // A different owner cannot read that owner's discovered account as its own.
  await assert.rejects(adapter.token(mint, owner, { height: 100 }), /identity mismatch/)
  currentOwner = owner; restricted = true
  await adapter.discover(owner, {}, { height: 100 })
  const restored = await adapter.token(mint, owner, { height: 100 }, first)
  assert.equal(restored.atomic, '12500000'); assert.equal(restored.complete, false)
  assert.ok(restored.accounts.some(a => a.address === tokenAccount))
})
test('bounded validator skew succeeds, stale context and missing integer never become zero', async () => {
  let response = { context: { slot: 80 }, value: '9007199254740993' }
  const adapter = solAdapter(NETWORKS.solana, { rpc: async () => response })
  assert.equal(await adapter.balance(owner, { height: 100 }), '9007199254740993')
  await assert.rejects(adapter.balance(owner, { height: 300 }), /stale/)
  response = { context: { slot: 100 } }
  await assert.rejects(adapter.balance(owner, { height: 100 }), /atomic amount/)
})
test('SPL transfer creates recipient ATA, includes rent in native cost and serializes exact units', async () => {
  const kit = require('@solana/kit'), sdk = require('@solana-program/token')
  const [sourceAta] = await sdk.findAssociatedTokenPda({ owner, mint, tokenProgram: PROGRAMS[0] })
  const adapter = solAdapter(NETWORKS.solana, { rpc: async (method, params) => {
    if (method === 'getBalance') return { context: { slot: 100 }, value: 1000000000 }
    if (method === 'getLatestBlockhash') return { value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 200 } }
    if (method === 'getAccountInfo') return { context: { slot: 100 }, value: params[0] === mint ? mintData() : null }
    if (method === 'getMultipleAccounts') return { context: { slot: 100 }, value: params[0].map(a => a === sourceAta ? holding(owner) : null) }
    if (method === 'getMinimumBalanceForRentExemption') { assert.equal(params[0], 165); return 2039280 }
    if (method === 'getFeeForMessage') return { value: 5000 }
    if (method === 'simulateTransaction') return { value: { err: null } }
    throw Error('Unexpected RPC: ' + method)
  } })
  const result = await adapter.prepare({ owner, to: destination, asset: { id: mint, decimals: 6 }, amount: '1.000001' }, { height: 100 })
  assert.equal(result.atomic, '1000001'); assert.equal(result.rentAtomic, '2039280'); assert.equal(result.nativeRequired, '2044280')
  const message = kit.getCompiledTransactionMessageDecoder().decode(result.unsigned.messageBytes)
  assert.equal(message.instructions.length, 2)
  const data = Buffer.from(message.instructions[1].data)
  assert.equal(data[0], 12); assert.equal(data.readBigUInt64LE(1), 1000001n); assert.equal(data[9], 6)
})
test('Token-2022 transfer extensions are rejected before creating a misleading unsigned transfer', async () => {
  const adapter = solAdapter(NETWORKS.solana, { rpc: async method => {
    if (method === 'getLatestBlockhash') return { value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 200 } }
    if (method === 'getBalance') return { context: { slot: 100 }, value: 1000000000 }
    if (method === 'getAccountInfo') return { context: { slot: 100 }, value: mintData(PROGRAMS[1], [{ extension: 'transferFeeConfig' }]) }
    if (method === 'getMultipleAccounts') return { context: { slot: 100 }, value: [null] }
    throw Error('Unexpected method')
  } })
  await assert.rejects(adapter.prepare({ owner, to: destination, asset: { id: mint, decimals: 6 }, amount: '1' }, { height: 100 }), /Token-2022 extension/)
})
test('SPL MAX aggregates unlocked accounts, excludes frozen funds, and reuses a freshly verified asset', async () => {
  const kit = require('@solana/kit'), sdk = require('@solana-program/token')
  const [ata] = await sdk.findAssociatedTokenPda({ owner: destination, mint, tokenProgram: PROGRAMS[0] })
  const calls = []
  const adapter = solAdapter(NETWORKS.solana, { rpc: async (method, params) => {
    calls.push(method)
    if (method === 'getLatestBlockhash') return { value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 200 } }
    if (method === 'getBalance') return { context: { slot: 100 }, value: 1000000000 }
    if (method === 'getAccountInfo') { assert.equal(params[0], ata); return { context: { slot: 100 }, value: holding(destination) } }
    if (method === 'getFeeForMessage') return { value: 5000 }
    if (method === 'simulateTransaction') { assert.equal(params[1].sigVerify, false); return { value: { err: null } } }
    throw Error('Unexpected RPC')
  } })
  const asset = { id: mint, decimals: 6, program: PROGRAMS[0], extensions: [], atomic: '9000000',
    accounts: [{ address: tokenAccount, state: 'initialized', amount: '2000000' },
      { address: address(6), state: 'initialized', amount: '3000000' }, { address: address(7), state: 'frozen', amount: '4000000' }] }
  const prepared = await adapter.prepare({ owner, to: destination, asset, assetVerified: true, amount: '', max: true }, { height: 100 })
  assert.equal(prepared.atomic, '5000000'); assert.equal(prepared.rentAtomic, '0')
  const message = kit.getCompiledTransactionMessageDecoder().decode(prepared.unsigned.messageBytes)
  assert.deepEqual(message.instructions.map(instruction => Buffer.from(instruction.data).readBigUInt64LE(1)), [2000000n, 3000000n])
  assert.equal(Object.values(prepared.unsigned.signatures).every(value => value === null), true)
  assert.equal(calls.filter(method => method === 'getAccountInfo').length, 1)
  assert.ok(!calls.includes('sendTransaction'))
  const partial = await adapter.prepare({ owner, to: destination, asset, assetVerified: true, amount: '4' }, { height: 100 })
  const partialMessage = kit.getCompiledTransactionMessageDecoder().decode(partial.unsigned.messageBytes)
  assert.deepEqual(partialMessage.instructions.map(instruction => Buffer.from(instruction.data).readBigUInt64LE(1)), [2000000n, 2000000n])
})
test('classic SPL names come from the chain- and mint-bound Metaplex account', async () => {
  const { decodeMetadata, METADATA_PROGRAM } = require('../modules/sol/adapter.cjs'), kit = require('@solana/kit')
  const string = value => { const bytes = Buffer.from(value), length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]) }
  const bytes = Buffer.concat([Buffer.from([4]), Buffer.alloc(32), Buffer.from(kit.getAddressEncoder().encode(mint)), string('Fixture Dollar\0\0'), string('UNIT\0'), string('https://example.invalid/metadata.json')])
  const metadata = { owner: METADATA_PROGRAM, data: [bytes.toString('base64'), 'base64'] }
  assert.equal(decodeMetadata(metadata, mint).symbol, 'UNIT')
  assert.throws(() => decodeMetadata(metadata, other), /identity/)
  assert.throws(() => decodeMetadata({ ...metadata, owner }, mint), /account/)
  const broken = Buffer.from(bytes); broken.writeUInt32LE(0xffffffff, 65)
  assert.throws(() => decodeMetadata({ ...metadata, data: [broken.toString('base64'), 'base64'] }, mint), /string/)
  const [pda] = await kit.getProgramDerivedAddress({ programAddress: METADATA_PROGRAM, seeds: [Buffer.from('metadata'), kit.getAddressEncoder().encode(METADATA_PROGRAM), kit.getAddressEncoder().encode(mint)] })
  const adapter = solAdapter(NETWORKS.solana, { rpc: async (method, params) => {
    if (method === 'getAccountInfo') return { context: { slot: 100 }, value: params[0] === mint ? mintData() : params[0] === pda ? metadata : null }
    if (method === 'getMultipleAccounts') return { context: { slot: 100 }, value: [null] }
    throw Error('Unexpected metadata request')
  } })
  const result = await adapter.token(mint, owner, { height: 100 })
  assert.equal(result.name, 'Fixture Dollar'); assert.equal(result.symbol, 'UNIT'); assert.equal(result.complete, false)
})
