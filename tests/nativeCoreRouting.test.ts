import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

// This is CommonJS because it is consumed by Electron's main process.
const require = createRequire(import.meta.url)
const { priorityNodePoolKey } = require('../electron/native-core-routing.cjs') as {
  priorityNodePoolKey: (coin: string, path: string, poolSize: number) => string
}

test('interactive node helpers stay bounded after visiting every coin', () => {
  const coins = Array.from({ length: 25 }, (_, index) => `coin-${index}`)
  const keys = new Set(
    coins.flatMap((coin) => [
      priorityNodePoolKey(coin, '/fee/estimate', 2),
      priorityNodePoolKey(coin, '/address/utxos', 2),
    ]),
  )

  assert.equal(keys.size, 4)
  assert.deepEqual([...keys].sort(), [
    'fee:pool-0',
    'fee:pool-1',
    'transaction:pool-0',
    'transaction:pool-1',
  ])
})

test('fee and transaction requests never share a blocking lane', () => {
  assert.notEqual(
    priorityNodePoolKey('xgr', '/fee/estimate', 2),
    priorityNodePoolKey('xgr', '/transaction/context', 2),
  )
})
