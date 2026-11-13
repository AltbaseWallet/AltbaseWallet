'use strict'
// Read-only endpoint qualification. Uses public system/burn addresses, never
// wallet profiles or recovery data. No signing, simulation or broadcast calls.
const fs = require('node:fs')
const { createTransport } = require('../modules/account-common/publicnode.cjs')
const result = { startedAt: new Date().toISOString(), runtime: { platform: process.platform, node: process.versions.node, electron: process.versions.electron }, checks: [], transactions: 0, profilesAccessed: false }
const output = process.argv.find(x => x.startsWith('--output='))?.slice(9)
const save = () => { if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
async function check(network, method, operation, validate = () => true) {
  const started = Date.now(), row = { network, method, at: new Date().toISOString() }
  try {
    const value = await operation()
    if (!validate(value)) throw Error('Network response failed validation')
    row.status = 'PASS'; row.value = value
  } catch (error) {
    row.status = ['AUTH_REQUIRED', -32701, -32601].includes(error.code) ? 'RESTRICTED' : 'FAIL'
    row.error = error.message; row.code = error.code
  }
  row.ms = Date.now() - started; result.checks.push(row); save()
  console.log(JSON.stringify({ ...row, ...(Array.isArray(row.value) ? { value: { count: row.value.length } } : {}) }))
  return row
}
async function main() {
  const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  for (const [network, chain] of Object.entries({ ethereum: '0x1', bsc: '0x38', polygon: '0x89', arbitrum: '0xa4b1' })) {
    const t = createTransport(network)
    await check(network, 'eth_chainId', () => t.rpc('eth_chainId'), v => v === chain)
    const tip = await check(network, 'eth_blockNumber', () => t.rpc('eth_blockNumber'), v => /^0x[0-9a-f]+$/.test(v) && BigInt(v) > 0n)
    await check(network, 'eth_gasPrice', () => t.rpc('eth_gasPrice'), v => /^0x[0-9a-f]+$/.test(v))
    if (tip.status === 'PASS') await check(network, 'eth_getLogs/no-contract', () => t.rpc('eth_getLogs', [{ fromBlock: tip.value, toBlock: tip.value, topics: [topic, null, '0x' + '0'.repeat(64)] }]), Array.isArray)
  }
  const sol = createTransport('solana'), owner = 'SysvarRent111111111111111111111111111111111'
  await check('solana', 'getGenesisHash', () => sol.rpc('getGenesisHash'), v => v === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
  await check('solana', 'getAccountInfo/wrapped-SOL-mint', async () => {
    const v = await sol.rpc('getAccountInfo', ['So11111111111111111111111111111111111111112', { encoding: 'jsonParsed', commitment: 'finalized' }])
    return { slot: v.context?.slot, owner: v.value?.owner, decimals: v.value?.data?.parsed?.info?.decimals }
  }, v => Number.isSafeInteger(v.slot) && v.decimals === 9)
  for (const program of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
    await check('solana', 'getTokenAccountsByOwner/' + program, async () => {
      const v = await sol.rpc('getTokenAccountsByOwner', [owner, { programId: program }, { encoding: 'jsonParsed', commitment: 'finalized' }])
      return { slot: v.context?.slot, count: Array.isArray(v.value) ? v.value.length : null }
    }, v => Number.isSafeInteger(v.slot) && Number.isInteger(v.count))
  }
  const tron = createTransport('tron')
  await check('tron', 'getblockbynum/genesis', async () => (await tron.tron('/wallet/getblockbynum', { num: 0 })).blockID,
    v => v === '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc')
  await check('tron', 'getnowblock/finalized', async () => (await tron.tron('/walletsolidity/getnowblock')).block_header?.raw_data?.number, v => Number.isSafeInteger(v) && v > 0)
  await check('tron', 'triggerconstantcontract/USDT-decimals', async () => {
    const v = await tron.tron('/wallet/triggerconstantcontract', { owner_address: '410000000000000000000000000000000000000000', contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c', function_selector: 'decimals()', parameter: '' })
    if (v.result?.result !== true || !/^[a-f0-9]{64}$/.test(v.constant_result?.[0])) throw Error('Invalid contract read response')
    return Number(BigInt('0x' + v.constant_result[0]))
  }, v => v === 6)
  result.finishedAt = new Date().toISOString()
  result.connectivity = result.checks.filter(x => ['eth_chainId', 'getGenesisHash', 'getblockbynum/genesis'].includes(x.method)).every(x => x.status === 'PASS') ? 'PASS' : 'FAIL'
  result.fullTokenDiscovery = result.checks.filter(x => /eth_getLogs|getTokenAccountsByOwner/.test(x.method)).every(x => x.status === 'PASS') ? 'AVAILABLE_METHODS_ONLY' : 'RESTRICTED'
  save(); console.log(JSON.stringify({ connectivity: result.connectivity, fullTokenDiscovery: result.fullTokenDiscovery, output }))
  if (result.connectivity !== 'PASS') process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
