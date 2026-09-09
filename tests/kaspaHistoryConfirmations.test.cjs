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
    ['/info/blockdag', { virtualDaaScore: 2_000_125 }],
    ['/info/virtual-chain-blue-score', { blueScore: 125 }],
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
    assert.equal(history.transactions[0].blocktime, 1_700_000_000)
  } finally {
    Module._load = originalLoad
  }
})

test('Kaspa sender history reads the current API previous-outpoint fields', async () => {
  const txid = 'c'.repeat(64)
  const sender = `kaspa:${'q'.repeat(61)}`
  const recipient = `kaspa:${'p'.repeat(61)}`
  const responses = new Map([
    [`/addresses/${encodeURIComponent(sender)}/full-transactions-page?limit=25&resolve_previous_outpoints=light`, [{
      transaction_id: txid,
      is_accepted: true,
      accepting_block_blue_score: 200,
      accepting_block_time: 1_700_000_000_000,
      inputs: [{
        previous_outpoint_address: sender,
        previous_outpoint_amount: '36083099800',
      }],
      outputs: [{
        amount: '36082937400',
        script_public_key_address: recipient,
      }],
    }]],
    ['/info/blockdag', { virtualDaaScore: 2_000_205 }],
    ['/info/virtual-chain-blue-score', { blueScore: 205 }],
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
    const history = await createKaspaRestAdapter().getHistory(sender)
    assert.equal(history.transactions[0].vin[0].address, sender)
    assert.equal(history.transactions[0].vin[0].value, '360.830998')
    assert.equal(history.deltas[0].satoshis, '-36083099800')
    assert.equal(history.transactions[0].confirmations, 6)
  } finally {
    Module._load = originalLoad
  }
})

test('Kaspa separates DAA scores, missing blue tips, and unaccepted rows', async () => {
  const rows = [
    { transaction_id:'1'.repeat(64), block_daa_score:2_000_200, is_accepted:true },
    { transaction_id:'2'.repeat(64), accepting_block_blue_score:200, is_accepted:true },
    { transaction_id:'3'.repeat(64), accepting_block_blue_score:200, is_accepted:false },
  ]
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('/lib/rpc.cjs')) {
      return {
        RpcError: class RpcError extends Error {},
        httpRequest: async (url) => {
          if (url.pathname === '/info/virtual-chain-blue-score') throw new Error('Unavailable blue score')
          return { status:200, body:JSON.stringify(url.pathname === '/info/blockdag'
            ? {virtualDaaScore:2_000_205} : rows) }
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve('../ops/remote-nodes/adapters/kaspaRest.cjs')
    delete require.cache[modulePath]
    const {createKaspaRestAdapter} = require(modulePath)
    const history = await createKaspaRestAdapter().getHistory('kaspa:qtest')
    assert.deepEqual(history.transactions.map(tx => tx.confirmations), [6,1,0])
    assert.equal(history.deltas.length, 2)
    assert.equal(history.mempool[0].txid, rows[2].transaction_id)
  } finally { Module._load = originalLoad }
})

test('Kaspa mempool exposes pending amounts in KAS rather than raw sompi', async () => {
  const txid = 'b'.repeat(64)
  const from = `kaspa:${'a'.repeat(61)}`
  const to = `kaspa:${'c'.repeat(61)}`

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('/lib/rpc.cjs')) {
      return {
        RpcError: class RpcError extends Error {},
        httpRequest: async (url, options = {}) => {
          if (url.pathname === '/transactions' && options.method === 'POST') {
            return { status: 200, body: JSON.stringify({ transactionId: txid }) }
          }
          if (url.pathname.endsWith('/full-transactions-page')) {
            return { status: 200, body: '[]' }
          }
          throw new Error(`Unexpected Kaspa API request: ${url.pathname}`)
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve('../ops/remote-nodes/adapters/kaspaRest.cjs')
    delete require.cache[modulePath]
    const { createKaspaRestAdapter } = require(modulePath)
    const adapter = createKaspaRestAdapter()
    await adapter.broadcastTx(JSON.stringify({
      transaction: { version: 0 },
      txid,
      from,
      to,
      amount: '10000000',
      fee: '315400',
    }))
    const incoming = await adapter.getMempool(to)
    assert.equal(incoming.pending[0].amount, '0.1')
    assert.equal(incoming.pending[0].fee, '0.003154')
    const outgoing = await adapter.getMempool(from)
    assert.equal(outgoing.pending[0].amount, '0.1')
    assert.equal(outgoing.pending[0].fee, '0.003154')
  } finally {
    Module._load = originalLoad
  }
})
