'use strict'

const { createBitcoinRpc, RpcError } = require('../lib/rpc.cjs')
const { mapConcurrent } = require('../lib/mapConcurrent.cjs')

// Junkcoin v4 consensus/consensus.h sets COINBASE_MATURITY to 70.
const MATURITY = 70
const fail = message => { throw new RpcError(`Junkcoin: ${message}`, { status: 503 }) }
const atomic = value => {
  const m = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!m) return fail('invalid output amount')
  let n = BigInt(m[1] + (m[2] || ''))
  const shift = 8 + Number(m[3] || 0) - (m[2] || '').length
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 100) return fail('invalid amount precision')
  if (shift >= 0) n *= 10n ** BigInt(shift)
  else {
    const d = 10n ** BigInt(-shift)
    if (n % d) return fail('fractional atomic amount')
    n /= d
  }
  const result = Number(n)
  if (!Number.isSafeInteger(result)) return fail('amount exceeds exact integer range')
  return result
}
const outpoint = (txid, n) => {
  if (!/^[0-9a-f]{64}$/i.test(txid) || !Number.isSafeInteger(n) || n < 0) return fail('invalid outpoint')
  return `${txid}:${n}`
}
const poolKey = txids => {
  if (!Array.isArray(txids) || txids.some(id => !/^[0-9a-f]{64}$/i.test(id))) return fail('incomplete mempool response')
  return txids.slice().sort().join(',')
}

// Override only reads. Existing validation, fee, history and broadcast methods
// remain on the original adapter. A bounded history index is never a balance.
function createJunkcoinUtxoReads({ rpcUrl, rpcUser, rpcPassword, rpc: injectedRpc }) {
  const rpc = injectedRpc || createBitcoinRpc({ url: rpcUrl, user: rpcUser, password: rpcPassword, timeoutMs: 20_000 })
  const cache = new Map(), pending = new Map()
  let scanQueue = Promise.resolve()
  const scan = address => {
    const operation = scanQueue.then(() => rpc('scantxoutset', ['start', [{ desc: `addr(${address})` }]]))
    scanQueue = operation.catch(() => undefined)
    return operation
  }
  const snapshot = async (address, { force = false } = {}) => {
    if (pending.has(address)) return pending.get(address)
    const operation = (async () => {
      const validation = await rpc('validateaddress', [address])
      if (!validation?.isvalid || !/^(?:[0-9a-f]{2})+$/i.test(validation.scriptPubKey || '')) return fail('invalid transparent address')
      const chain = await rpc('getblockchaininfo')
      if (!Number.isSafeInteger(chain?.blocks) || chain.blocks < 1 || chain.initialblockdownload === true || chain.headers > chain.blocks) return fail('node is still synchronizing')
      const txids = await rpc('getrawmempool', []), pool = poolKey(txids)
      const previous = cache.get(address)
      if (!force && previous && previous.expires > Date.now() && previous.hash === chain.bestblockhash && previous.pool === pool) return previous.value
      const scanned = await scan(address)
      if (scanned?.success !== true || !Array.isArray(scanned.unspents) || !Number.isSafeInteger(scanned.height) || scanned.bestblock !== chain.bestblockhash || scanned.height !== chain.blocks) return fail('UTXO scan did not complete at the current tip; retry')
      const own = new Map()
      for (const row of scanned.unspents) {
        const key = outpoint(row.txid, row.vout)
        if (own.has(key) || row.scriptPubKey !== validation.scriptPubKey || !Number.isSafeInteger(row.height) || row.height < 1 || row.height > scanned.height) return fail('invalid or duplicate scan output')
        own.set(key, { txid: row.txid, outputIndex: row.vout, script: row.scriptPubKey, satoshis: atomic(row.amount), height: row.height })
      }
      const total = [...own.values()].reduce((sum, row) => sum + row.satoshis, 0)
      if (!Number.isSafeInteger(total) || atomic(scanned.total_amount) !== total) return fail('UTXO scan total does not match its outputs')
      // The complete scan proves old outputs are unspent. Only recent outputs
      // need gettxout(false) to distinguish immature rewards, avoiding one RPC
      // per historical output on large addresses. No txindex is required.
      const rows = await mapConcurrent([...own.values()], 4, async row => {
        const confirmations = scanned.height - row.height + 1
        if (confirmations >= MATURITY) return { ...row, confirmations, immature: false }
        const live = await rpc('gettxout', [row.txid, row.outputIndex, false])
        if (!live || live.bestblock !== scanned.bestblock || live.scriptPubKey?.hex !== row.script || atomic(live.value) !== row.satoshis || !Number.isSafeInteger(live.confirmations) || live.confirmations < 1 || typeof live.coinbase !== 'boolean') return fail('UTXO snapshot changed or could not be verified; retry')
        return { ...row, confirmations: live.confirmations, isCoinbase: live.coinbase, immature: live.coinbase && live.confirmations < MATURITY }
      })
      const transactions = await mapConcurrent(txids, 4, async txid => {
        const tx = await rpc('getrawtransaction', [txid, true])
        if (tx?.txid !== txid || !Array.isArray(tx.vin) || !Array.isArray(tx.vout)) return fail('incomplete mempool transaction')
        return tx
      })
      for (const tx of transactions) for (const output of tx.vout) {
        if (output.scriptPubKey?.hex === validation.scriptPubKey) own.set(outpoint(tx.txid, output.n), { satoshis: atomic(output.value) })
      }
      const spent = new Set(), pendingTransactions = []
      let incoming = 0, outgoing = 0
      for (const tx of transactions) {
        let inputValue = 0, outputValue = 0
        for (const input of tx.vin) {
          const key = outpoint(input.txid, input.vout)
          if (spent.has(key)) return fail('conflicting mempool snapshot')
          spent.add(key); inputValue += own.get(key)?.satoshis || 0
        }
        for (const output of tx.vout) if (output.scriptPubKey?.hex === validation.scriptPubKey) outputValue += atomic(output.value)
        const delta = outputValue - inputValue
        if (!delta) continue
        if (delta > 0) incoming += delta
        else outgoing -= delta
        pendingTransactions.push({ txid: tx.txid, type: delta > 0 ? 'incoming' : 'outgoing', amount: (Math.abs(delta) / 1e8).toFixed(8), confirmations: 0 })
      }
      const finalChain = await rpc('getblockchaininfo'), finalPool = poolKey(await rpc('getrawmempool', []))
      if (finalChain.bestblockhash !== scanned.bestblock || finalPool !== pool) return fail('chain or mempool changed during the scan; retry')
      const unspent = rows.filter(row => !spent.has(outpoint(row.txid, row.outputIndex)))
      const immature = unspent.filter(row => row.immature).reduce((sum, row) => sum + row.satoshis, 0)
      const spendable = unspent.filter(row => !row.immature)
      const value = {
        address, balance: total + incoming - outgoing,
        balance_spendable: spendable.reduce((sum, row) => sum + row.satoshis, 0),
        received: total + incoming, immature, pendingIncoming: incoming, pendingOutgoing: outgoing,
        mempoolNet: incoming - outgoing, pendingTxids: pendingTransactions.map(tx => tx.txid),
        pendingOutgoingTxids: pendingTransactions.filter(tx => tx.type === 'outgoing').map(tx => tx.txid),
        pendingTransactions, utxos: spendable, confirmedBalance: total,
        blockHeight: scanned.height, bestBlockHash: scanned.bestblock,
      }
      if ([value.balance, value.balance_spendable, incoming, outgoing].some(n => !Number.isSafeInteger(n) || n < 0)) return fail('inconsistent mempool balance')
      if (cache.size >= 100) cache.delete(cache.keys().next().value)
      cache.set(address, { value, hash: scanned.bestblock, pool, expires: Date.now() + 5_000 })
      return value
    })()
    pending.set(address, operation)
    try { return await operation } finally { pending.delete(address) }
  }
  return {
    authoritativeBalance: true,
    // Gateway must not add a second, best-effort mempool calculation.
    preserveAtomicBalances: true,
    balanceTimeoutMs: 20_000,
    getBalance: snapshot,
    async getUtxos(address, options) { const result = await snapshot(address, options); return { address, utxos: result.utxos } },
    async getMempool(address) { const result = await snapshot(address); return { address, hasPendingOutgoing: result.pendingOutgoingTxids.length > 0, pending: result.pendingTransactions } },
  }
}

module.exports = { createJunkcoinUtxoReads }
