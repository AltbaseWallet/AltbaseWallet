'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createJiti } = require('jiti')
const jiti = createJiti(__filename)
const { coinApiService } = jiti('../src/services/coinApiService.ts')
const { nativeCoreService } = jiti('../src/services/nativeCoreService.ts')

test('previous transaction reads recover from one transport timeout', async (t) => {
  let calls = 0
  t.mock.method(nativeCoreService, 'coinNodeRequest', async (request) => {
    assert.equal(request.path, '/tx/raw')
    if (++calls === 1) throw new Error('Timeout was reached')
    return { status: 200, body: JSON.stringify({ ok: true, hex: 'abcd' }) }
  })
  assert.equal(await coinApiService.getRawTransaction('firo', 'ab'.repeat(32)), 'abcd')
  assert.equal(calls, 2)
})

test('a persistent preparation failure has only one transport retry', async (t) => {
  const request = t.mock.method(nativeCoreService, 'coinNodeRequest', async () => {
    throw new Error('Timeout was reached')
  })
  await assert.rejects(coinApiService.getRawTransaction('firo', 'cd'.repeat(32)), /timeout|timed out/i)
  assert.equal(request.mock.callCount(), 2)
})

test('a broadcast timeout is returned without repeating the write', async (t) => {
  const request = t.mock.method(nativeCoreService, 'coinNodeRequest', async () => {
    throw new Error('Timeout was reached')
  })
  await assert.rejects(coinApiService.broadcast('firo', 'abcd', 'ef'.repeat(32)), /timeout|timed out/i)
  assert.equal(request.mock.callCount(), 1)
})
