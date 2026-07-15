'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const Module = require('node:module')

const originalLoad = Module._load

test('CKB history treats a transaction with a block number as confirmed', async () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('/lib/rpc.cjs')) {
      return {
        RpcError: class RpcError extends Error {},
        httpRequest: async (url, options = {}) => {
          if (url.pathname.includes('/address_transactions/')) {
            return {
              status: 200,
              body: JSON.stringify({
                data: [{
                  id: '101927092',
                  attributes: {
                    transaction_hash: `0x${'a'.repeat(64)}`,
                    tx_status: 'pending',
                    block_number: 100,
                    block_timestamp: 1_700_000_000_000,
                    display_inputs: [],
                    display_outputs: [{ address_hash: 'ckb1qtest', capacity: '6100000000' }],
                  },
                }],
              }),
            }
          }

          if (url.pathname.includes('/addresses/')) {
            return {
              status: 200,
              body: JSON.stringify({
                data: {
                  attributes: {
                    lock_script: {
                      code_hash: `0x${'c'.repeat(64)}`,
                      hash_type: 'type',
                      args: `0x${'d'.repeat(40)}`,
                    },
                  },
                },
              }),
            }
          }

          const request = JSON.parse(options.body)
          if (request.method === 'get_cells') {
            return {
              status: 200,
              body: JSON.stringify({
                result: {
                  objects: [{
                    out_point: { tx_hash: `0x${'a'.repeat(64)}`, index: '0x0' },
                    output: {
                      capacity: '0x16b969d00',
                      lock: {
                        code_hash: `0x${'c'.repeat(64)}`,
                        hash_type: 'type',
                        args: `0x${'d'.repeat(40)}`,
                      },
                    },
                    output_data: '0x',
                    block_number: '0x64',
                    tx_index: '0x1',
                  }],
                  last_cursor: '0x1',
                },
              }),
            }
          }
          if (request.method === 'send_transaction') {
            assert.equal(request.params[0].cell_deps[0].dep_type, 'dep_group')
            return {
              status: 200,
              body: JSON.stringify({ result: `0x${'e'.repeat(64)}` }),
            }
          }
          assert.equal(request.method, 'get_tip_header')
          return {
            status: 200,
            body: JSON.stringify({ result: { number: '0x69', hash: `0x${'b'.repeat(64)}` } }),
          }
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve('../ops/remote-nodes/adapters/ckbRpc.cjs')
    delete require.cache[modulePath]
    const { createCkbRpcAdapter } = require(modulePath)
    const history = await createCkbRpcAdapter().getHistory('ckb1qtest')
    assert.equal(history.transactions[0].confirmations, 6)
    assert.equal(history.transactions[0].txid, `0x${'a'.repeat(64)}`)
    assert.equal(history.deltas[0].height, 100)
    assert.equal(history.mempool.length, 0)

    const liveCells = await createCkbRpcAdapter().getUtxos('ckb1qtest')
    assert.equal(liveCells.utxos[0].height, 100)

    const broadcast = await createCkbRpcAdapter().broadcastTx(JSON.stringify({
      transaction: {
        version: '0x0',
        cellDeps: [{
          outPoint: { txHash: `0x${'f'.repeat(64)}`, index: '0x0' },
          depType: 'depGroup',
        }],
        headerDeps: [],
        inputs: [],
        outputs: [],
        outputsData: [],
        witnesses: [],
      },
      from: 'ckb1qsender',
      to: 'ckb1qrecipient',
      amount: '6100000000',
      fee: '1001',
    }))
    assert.equal(broadcast.txid, `0x${'e'.repeat(64)}`)
  } finally {
    Module._load = originalLoad
  }
})
