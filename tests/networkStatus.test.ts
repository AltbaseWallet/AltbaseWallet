import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createJiti } = require('jiti')
const { networkToStatus } = createJiti(import.meta.url)('../src/services/coinApiService.ts')

test('a daemon stuck after a fork is syncing even when progress is close to one', () => {
  assert.equal(networkToStatus({
    blocks: 1_371_001,
    headers: 1_372_964,
    verificationProgress: 0.9990416823810232,
  }), 'syncing')
})

test('a small propagation delay keeps an otherwise ready daemon active', () => {
  assert.equal(networkToStatus({ blocks: 1_372_963, headers: 1_372_964 }), 'active')
  assert.equal(networkToStatus({ blocks: 100, headers: 100, initialBlockDownload: true }), 'syncing')
})
