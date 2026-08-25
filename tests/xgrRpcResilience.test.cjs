'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const Module = require('node:module')

const originalLoad = Module._load

test('XGR fee estimate returns a bounded safe envelope when RPC is slow', async () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('/lib/rpc.cjs')) {
      return {
        RpcError: class RpcError extends Error {
          constructor(message, details = {}) {
            super(message)
            Object.assign(this, details)
          }
        },
        httpRequest: async () => new Promise(() => undefined),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve('../ops/remote-nodes/adapters/xgrRpc.cjs')
    delete require.cache[modulePath]
    const { createXgrRpcAdapter } = require(modulePath)
    const adapter = createXgrRpcAdapter({ feeRpcTimeoutMs: 10 })
    const startedAt = Date.now()
    const fee = await adapter.estimateFee()
    assert.equal(fee.chainId, 1643)
    assert.equal(fee.gasLimit, '21000')
    assert.equal(fee.fee, '0.042021')
    assert.equal(fee.source, 'xgr-safe-fallback')
    assert.ok(Date.now() - startedAt < 500)
  } finally {
    Module._load = originalLoad
  }
})
