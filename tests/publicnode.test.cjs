'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { createTransport, parseJson } = require('../modules/account-common/publicnode.cjs')
const response = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
test('PublicNode uses its own honest User-Agent and preserves large atomic balances', async () => {
  const transport = createTransport('ethereum', { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://ethereum-rpc.publicnode.com')
    assert.equal(options.headers['User-Agent'], 'AltbaseWallet/' + require('../package.json').version)
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    return response({ jsonrpc: '2.0', id: JSON.parse(options.body).id, result: '0x20000000000001' })
  } })
  assert.equal(await transport.rpc('eth_getBalance', ['0x' + '0'.repeat(40), 'latest']), '0x20000000000001')
  assert.equal(parseJson('{"balance":18446744073709551615,"slot":123}').balance, '18446744073709551615')
  assert.equal(parseJson('{"slot":123}').slot, 123)
})
test('read retries are bounded; invalid or denied responses are never empty balances', async () => {
  let calls = 0
  const t = createTransport('solana', { sleep: async () => {}, fetchImpl: async (_url, options) => ++calls === 1 ? response({}, 429) : response({ jsonrpc: '2.0', id: JSON.parse(options.body).id, result: { value: 0 } }) })
  assert.deepEqual(await t.rpc('getBalance', []), { value: 0 }); assert.equal(calls, 2)
  for (const bad of [() => response({}, 403), () => response('<html>unavailable</html>'), () => response({ jsonrpc: '2.0', id: 999, result: 0 })]) {
    const t = createTransport('ethereum', { fetchImpl: async () => bad() })
    await assert.rejects(t.rpc('eth_getBalance', []))
  }
})
test('node read methods cannot submit transfers and uncertain broadcast is attempted once', async () => {
  let calls = 0
  const t = createTransport('ethereum', { fetchImpl: async () => { calls++; throw Error('closed') } })
  await assert.rejects(t.rpc('eth_sendRawTransaction', ['fixture']), /read RPC/)
  assert.equal(calls, 0)
  await assert.rejects(t.broadcast('fixture'), /connection/)
  assert.equal(calls, 1)
  await assert.rejects(createTransport('tron').tron('/wallet/broadcasttransaction', {}), /read Tron/)
})
test('PublicNode HTTP 529 overload retries reads within limits and never repeats a submission', async () => {
  let reads = 0, writes = 0
  const transport = createTransport('polygon', { sleep: async () => {}, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    if (body.method === 'eth_sendRawTransaction') { writes++; return response({}, 529) }
    if (++reads === 1) return response({}, 529)
    return response({ jsonrpc: '2.0', id: body.id, result: '0x2a' })
  } })
  assert.equal(await transport.rpc('eth_getBalance', []), '0x2a')
  assert.equal(reads, 2)
  await assert.rejects(transport.broadcast('offline-fixture'), error => error.code === 529)
  assert.equal(writes, 1)
  let unavailableReads = 0
  const unavailable = createTransport('polygon', { sleep: async () => {}, fetchImpl: async () => {
    unavailableReads++; return response({}, 529)
  } })
  await assert.rejects(unavailable.rpc('eth_getBalance', []), error => error.code === 529)
  assert.equal(unavailableReads, 2)
})
test('PublicNode discovery restriction stays an explicit error', async () => {
  const t = createTransport('bsc', { fetchImpl: async () => response({ jsonrpc: '2.0', id: 1, error: { code: -32701, message: 'untrusted upstream text' } }) })
  await assert.rejects(t.rpc('eth_getLogs', []), /token contract filter/)
})
test('personal-token requirement remains explicit and is not retried or hidden', async () => {
  let calls = 0
  const t = createTransport('solana', { fetchImpl: async () => { calls++; return response({ error: { message: 'Indexed requests require a personal token. Get one at: https://www.allnodes.com/publicnode' } }, 403) } })
  await assert.rejects(t.rpc('getTokenAccountsByOwner', []), error => error.code === 'AUTH_REQUIRED')
  assert.equal(calls, 1)
})
test('oversized bodies, invalid retry limits and stalled requests are rejected', async () => {
  assert.throws(() => createTransport('ethereum', { attempts: 100 }))
  const oversized = createTransport('ethereum', { fetchImpl: async () => response('{}', 200, { 'content-length': String(9 * 1024 * 1024) }) })
  await assert.rejects(oversized.rpc('eth_chainId'), error => error.code === 'SIZE')
  const stalled = createTransport('ethereum', { attempts: 1, timeoutMs: 10, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('abort')), { once: true })) })
  await assert.rejects(stalled.rpc('eth_chainId'), /timed out/)
})
test('read retries share a deadline and a Retry-After cannot exceed it', async () => {
  let calls = 0, sleeps = 0
  const t = createTransport('polygon', { timeoutMs: 100, attempts: 3,
    sleep: async () => { sleeps++ },
    fetchImpl: async () => { calls++; return response({}, 503, { 'retry-after': '5' }) },
  })
  await assert.rejects(t.rpc('eth_getBalance', []), /timed out/)
  assert.equal(calls, 1); assert.equal(sleeps, 0)
})
test('slow contract reads have their own bounded budget without extending writes or native reads', async () => {
  let broadcasts = 0
  const t = createTransport('polygon', { timeoutMs: 10, contractTimeoutMs: 100, attempts: 1,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      const body = JSON.parse(options.body)
      if (body.method === 'eth_sendRawTransaction') broadcasts++
      const timer = setTimeout(() => resolve(response({ jsonrpc: '2.0', id: body.id, result: '0x01' })), 30)
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('abort')) }, { once: true })
    }),
  })
  await assert.rejects(t.rpc('eth_getBalance', []), /timed out/)
  assert.equal(await t.rpc('eth_call', []), '0x01')
  await assert.rejects(t.broadcast('offline-fixture'), /timed out/)
  assert.equal(broadcasts, 1)
  assert.throws(() => createTransport('polygon', { contractTimeoutMs: 30001 }))
})
