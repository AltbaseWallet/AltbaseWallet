'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../ops/backend/blockbook.cjs'), 'utf8')
class RpcError extends Error { constructor(message, { status } = {}) { super(message); this.status = status } }
function fixture(reply) {
  const calls = [], module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, Buffer, URL,
    require: id => id === '../lib/rpc.cjs' ? { RpcError, httpRequest: async (url, options) => { calls.push({ url, options }); return reply(url, options) } } : require(id) })
  return { calls, adapter: module.exports.createBlockbookAdapter({ coin: 'pearl', baseUrl: 'https://first.invalid/api/v2,https://second.invalid/api/v2' }) }
}
const txid = '12'.repeat(32)
test('Blockbook submits large transactions as one raw POST body with a constant URL', async () => {
  const { adapter, calls } = fixture(async () => ({ status: 200, body: JSON.stringify({ result: txid }) }))
  const hex = 'ab'.repeat(200000)
  assert.equal((await adapter.broadcastTx(hex)).txid, txid)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.href, 'https://first.invalid/api/v2/sendtx/')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Content-Type'], 'text/plain')
  assert.equal(calls[0].options.headers['Content-Length'], hex.length)
  assert.equal(calls[0].options.body, hex)
})
test('Blockbook never retries a write via GET or another upstream after a lost response', async () => {
  const { adapter, calls } = fixture(async () => { throw Error('Fixture response timeout after upstream accepted data') })
  await assert.rejects(adapter.broadcastTx('abcd'), /timeout/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.method, 'POST')
})
test('Blockbook preserves deterministic node rejection and makes exactly one request', async () => {
  const { adapter, calls } = fixture(async () => ({ status: 400, body: JSON.stringify({ error: 'bad-txns-inputs-missingorspent' }) }))
  await assert.rejects(adapter.broadcastTx('abcd'), e => e.status === 400 && /missingorspent/.test(e.message))
  assert.equal(calls.length, 1)
})
test('Blockbook preserves non-JSON HTTP status without replaying the transaction', async () => {
  const { adapter, calls } = fixture(async () => ({ status: 414, body: '<html>URI too long</html>' }))
  await assert.rejects(adapter.broadcastTx('abcd'), e => e.status === 414)
  assert.equal(calls.length, 1)
})
test('Blockbook accepts a plain-text transaction id and rejects malformed successful replies', async () => {
  const plain = fixture(async () => ({ status: 200, body: txid }))
  assert.equal((await plain.adapter.broadcastTx('abcd')).txid, txid)
  const malformed = fixture(async () => ({ status: 200, body: JSON.stringify({ result: 'not-a-transaction-id' }) }))
  await assert.rejects(malformed.adapter.broadcastTx('abcd'), /valid txid/)
  assert.equal(malformed.calls.length, 1)
})
test('invalid and oversized Blockbook inputs fail before any transport call', async () => {
  const { adapter, calls } = fixture(async () => { throw Error('Must not reach transport') })
  for (const input of ['', 'abc', 'zz', null, 'ab'.repeat(4 * 1024 * 1024 + 1)]) {
    await assert.rejects(adapter.broadcastTx(input), e => e.status === 400)
  }
  assert.equal(calls.length, 0)
})
test('read-only Blockbook requests retain upstream failover', async () => {
  const { adapter, calls } = fixture(async url => {
    if (url.hostname === 'first.invalid') throw Error('Fixture first reader unavailable')
    return { status: 200, body: JSON.stringify({ blockbook: { bestHeight: 123, inSync: true }, backend: { blocks: 123 } }) }
  })
  assert.equal((await adapter.getNetwork()).blocks, 123)
  assert.equal(calls.length, 2)
})
