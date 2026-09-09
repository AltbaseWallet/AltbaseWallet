'use strict'

const insertBefore = (source, marker, addition) => {
  if (!source.includes(marker)) throw new Error(`Cannot apply transaction proof patch: missing ${marker}`)
  return source.replace(marker, addition + marker)
}

const patchTransactionProofs = (filename, source) => {
  if (filename === 'gateway.cjs') {
    if (source.includes("'/api/v1/:coin/tx/raw'")) return source
    return insertBefore(source, "router.get('/api/v1/:coin/network'", `router.post('/api/v1/:coin/tx/raw', async ({ params, body }, response) => {
  const adapter = requireAdapter(params.coin)
  const txid = String(body.txid || '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new RpcError('Invalid transaction id', { status: 400 })
  if (typeof adapter.getRawTransaction !== 'function') throw new RpcError('Transaction proofs unavailable for this coin', { status: 501 })
  const height = Number.isSafeInteger(body.height) && body.height >= 0 ? body.height : undefined
  const hex = await wrapRead('rawtx:' + adapter.coin + ':' + txid, 'validate', () => adapter.getRawTransaction(txid, height))
  if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(hex) || hex.length > 8000000) {
    throw new RpcError('Invalid raw transaction from upstream', { status: 502 })
  }
  ok(response, { txid, hex })
})

`)
  }
  const blockbookMethod = `    async getRawTransaction(txid, height) {
      // Prefer the local daemon when the explorer is unavailable or slow.
      if (localAdapter) {
        try { return await localAdapter.getRawTransaction(txid, height) } catch { /* Try the archival explorer below. */ }
      }
      const data = await request('/tx-specific/' + txid)
      return data.hex || data.result?.hex
    },

`
  if (filename === 'adapters/blockbook.cjs' && source.includes('const localAdapter =')
    && source.includes('    async getRawTransaction(txid) {')) {
    return source.replace(/    async getRawTransaction\(txid\) \{[\s\S]*?\n    \},\n\n/, blockbookMethod)
  }
  if (source.includes('async getRawTransaction(')) return source
  const methods = {
    'adapters/bitcoinFork.cjs': `    async getRawTransaction(txid, height) {
      const raw = await getRawTransactionVerbose(txid, height)
      return raw.hex || await rpc('getrawtransaction', [txid, false])
    },

`,
    'adapters/blockbook.cjs': source.includes('const localAdapter =') ? blockbookMethod : `    async getRawTransaction(txid) {
      const data = await request('/tx-specific/' + txid)
      return data.hex || data.result?.hex
    },

`,
    'adapters/mempoolSpace.cjs': `    async getRawTransaction(txid) {
      return requestText('/tx/' + txid + '/hex')
    },

`,
    'adapters/remoteApi.cjs': `    async getRawTransaction(txid, height) {
      const data = await request('POST', '/tx/raw', { txid, height })
      return data.hex
    },

`,
  }
  if (!methods[filename]) throw new Error('Unknown transaction proof adapter')
  return insertBefore(source, '    async getNetwork()', methods[filename])
}

module.exports = { patchTransactionProofs }
