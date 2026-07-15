'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const Module = require('node:module')

const originalLoad = Module._load

test('Kaspa history derives confirmations from accepting_block_blue_score', async () => {
  const responses = new Map([
    ['/addresses/kaspa%3Aqtest/full-transactions-page?limit=25&resolve_previous_outpoints=light', [{
      transaction_id: 'a'.repeat(64),
      is_accepted: true,
      accepting_block_blue_score: 120,
      accepting_block_time: 1_700_000_000_000,
      inputs: [],
      outputs: [],
    }]],
    ['/info/blockdag', { virtualDaaScore: 125 }],
  ])

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('/lib/rpc.cjs')) {
      return {
        RpcError: class RpcError extends Error {},
        httpRequest: async (url) => ({
          status: 200,
          body: JSON.stringify(responses.get(`${url.pathname}${url.search}`)),
        }),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve('../ops/remote-nodes/adapters/kaspaRest.cjs')
    delete require.cache[modulePath]
    const { createKaspaRestAdapter } = require(modulePath)
    const history = await createKaspaRestAdapter().getHistory('kaspa:qtest')
    assert.equal(history.transactions[0].confirmations, 6)
    assert.equal(history.deltas[0].height, 120)
  } finally {
    Module._load = originalLoad
  }
})
