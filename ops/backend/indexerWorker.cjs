'use strict'

// Background worker that drives the AddressIndexService:
//   • Polls each coin's mempool every MEMPOOL_POLL_MS and records new entries.
//   • Watches for new blocks every BLOCK_POLL_MS — for each new block, scans
//     all transactions in it against the watched addresses.
//   • On first watch of an address, asynchronously back-fills the recent
//     BACKFILL_BLOCKS so we don't miss confirmed deposits that happened
//     before the wallet ever asked.
//
// Designed for vanilla Bitcoin-Core forks where `getaddressbalance` doesn't
// exist — we build the address-side view ourselves from chain data.

const logger = require('./logger.cjs')
const { MEMPOOL_POLL_MS, BLOCK_POLL_MS, BACKFILL_BLOCKS } = require('./addressIndex.cjs')

const PENDING_DROP_GRACE_MS = Math.max(2 * 60_000, BLOCK_POLL_MS * 6)
const RPC_OVERLOAD_BACKOFF_MS = 500
const EMPTY_BACKFILL_RETRY_MS = 10 * 60_000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isRpcOverloadError = (error) =>
  /non-json rpc response \(500\)|work queue depth|upstream timeout|socket hang up|econnreset/i
    .test(String(error?.message || ''))

/**
 * Build a Set of legacy + cashaddr representations for an address so we can
 * match a wide variety of fork formats in a single string-compare. For most
 * forks legacy is enough; BitcoinCashII emits cashaddr in raw-tx outputs.
 */
const matchAddress = (entry, watchSet) => {
  // BCH-style outputs may have `address` and `addresses[]` fields; vanilla has
  // a single `address`. Some have `addresses: ["X"]` only.
  if (entry.address && watchSet.has(entry.address)) return entry.address
  if (Array.isArray(entry.addresses)) {
    for (const a of entry.addresses) if (watchSet.has(a)) return a
  }
  return null
}

const extractAddresses = (vout) => {
  const sp = vout.scriptPubKey || {}
  const candidates = []
  if (sp.address) candidates.push(sp.address)
  if (Array.isArray(sp.addresses)) candidates.push(...sp.addresses)
  return candidates
}

const isLegacyVerboseRawTxError = (error) =>
  /integer as expected/i.test(String(error?.message || ''))

const isLegacyGetBlockError = (error) =>
  /boolean as expected/i.test(String(error?.message || ''))

const getRawTransactionVerbose = async (rpc, txid) => {
  try {
    return await rpc('getrawtransaction', [txid, true])
  } catch (error) {
    if (!isLegacyVerboseRawTxError(error)) throw error
    return rpc('getrawtransaction', [txid, 1])
  }
}

const getBlockWithTransactions = async (rpc, hash) => {
  try {
    const block = await rpc('getblock', [hash, 2])
    if ((block.tx || []).every((tx) => tx && typeof tx === 'object')) return block
  } catch (error) {
    if (!isLegacyGetBlockError(error)) throw error
  }

  const block = await rpc('getblock', [hash, true])
  const txs = []
  for (const txid of block.tx || []) {
    txs.push(await getRawTransactionVerbose(rpc, txid))
  }
  return { ...block, tx: txs }
}

const getConfirmedTxContext = async (rpc, txid) => {
  let tx
  try {
    tx = await getRawTransactionVerbose(rpc, txid)
  } catch {
    return null
  }
  const confirmations = Number(tx?.confirmations ?? 0)
  if (!(confirmations > 0) && !tx?.blockhash) return null

  let height = Number.isFinite(Number(tx.height)) ? Number(tx.height) : null
  let time = Number.isFinite(Number(tx.blocktime)) ? Number(tx.blocktime) : Number.isFinite(Number(tx.time)) ? Number(tx.time) : null
  if (tx.blockhash) {
    try {
      const block = await rpc('getblock', [tx.blockhash])
      if (block && typeof block === 'object') {
        if (!Number.isFinite(height) && Number.isFinite(Number(block.height))) height = Number(block.height)
        if (!Number.isFinite(time) && Number.isFinite(Number(block.time))) time = Number(block.time)
      }
    } catch {
      // Height can still be reconstructed from confirmations below.
    }
  }
  if (!Number.isFinite(height) && confirmations > 0) {
    try {
      const info = await rpc('getblockchaininfo', [])
      const tip = Number(info.blocks || 0)
      if (Number.isFinite(tip) && tip > 0) height = tip - confirmations + 1
    } catch {
      // Keep null height; caller will treat it as unresolved.
    }
  }
  if (!Number.isFinite(height)) return null
  return { tx, height, time: Number.isFinite(time) ? time : null }
}

const promotePendingTxIfConfirmed = async (idx, rpc, txid) => {
  const context = await getConfirmedTxContext(rpc, txid)
  if (!context) return false
  const recorded = await processTx(idx, context.tx, context.height, context.time, rpc)
  idx.markPendingSeen?.(txid)
  if (recorded > 0) {
    logger.info('indexer.pendingConfirmed', { coin: idx.coin, txid, height: context.height, recorded })
  }
  return true
}

/** Build a flat watch-set of all addresses + their cashaddr equivalents. */
const buildWatchSet = async (idx, rpc) => {
  const set = new Set()
  for (const addr of idx.watched) {
    set.add(addr)
    // Also try cashaddr equivalent (only for BCH-style forks — daemon will
    // happily convert via validateaddress). We cache below to avoid hammering.
    if (!idx._cashCache) idx._cashCache = new Map()
    if (!idx._cashCache.has(addr)) {
      try {
        const info = await rpc('validateaddress', [addr])
        if (info?.address && info.address !== addr) {
          idx._cashCache.set(addr, info.address)
        } else {
          idx._cashCache.set(addr, null)
        }
      } catch {
        idx._cashCache.set(addr, null)
      }
    }
    const cash = idx._cashCache.get(addr)
    if (cash) set.add(cash)
  }
  return set
}

/** Iterate the inputs/outputs of one raw-tx and record matches into idx. */
const processTx = async (idx, tx, height, time, rpc) => {
  const watchSet = await buildWatchSet(idx, rpc)
  idx.recordTxHeight?.(tx.txid, height)
  if (watchSet.size === 0) return 0
  let recorded = 0

  // Outputs → incoming
  for (const vout of tx.vout || []) {
    for (const addr of extractAddresses(vout)) {
      if (!watchSet.has(addr)) continue
      // Use whichever form the user originally watched (legacy)
      let userAddr = addr
      for (const watched of idx.watched) {
        if (watched === addr) { userAddr = watched; break }
        const cash = idx._cashCache?.get(watched)
        if (cash === addr) { userAddr = watched; break }
      }
      const sats = Math.round(Number(vout.value || 0) * 1e8)
      const isNew = idx.record({
        address: userAddr,
        txid: tx.txid,
        vout: vout.n,
        sats,
        type: 'incoming',
        height,
        time,
        // Save the script so the wallet can use this UTXO for signing
        scriptHex: vout.scriptPubKey?.hex ?? null,
      })
      if (isNew) recorded++
    }
  }

  // Inputs → outgoing.  Inputs in BCH/BTC raw tx carry the prev txid+vout but
  // not the address — we look up the previous output to find which address
  // funded this spend. We do this for both confirmed AND mempool transactions
  // so the user immediately sees "outgoing" entries on their own sends
  // (without this the wallet sees only the change-output and shows it as
  // a fresh incoming transfer until the block confirms).
  for (const vin of tx.vin || []) {
    if (!vin.txid) continue
    try {
      const indexedPrev = idx.findOutput?.(vin.txid, vin.vout)
      let prevVout = null
      if (indexedPrev) {
        prevVout = {
          value: Number(indexedPrev.sats || 0) / 1e8,
          scriptPubKey: {
            addresses: [indexedPrev.address],
          },
        }
      } else {
        const prev = await getRawTransactionVerbose(rpc, vin.txid)
        prevVout = prev?.vout?.[vin.vout]
      }
      if (!prevVout) continue
      for (const addr of extractAddresses(prevVout)) {
        if (!watchSet.has(addr)) continue
        let userAddr = addr
        for (const watched of idx.watched) {
          if (watched === addr) { userAddr = watched; break }
          const cash = idx._cashCache?.get(watched)
          if (cash === addr) { userAddr = watched; break }
        }
        const sats = Math.round(Number(prevVout.value || 0) * 1e8)
        const isNew = idx.record({
          address: userAddr,
          txid: tx.txid,
          vout: vin.vout,
          sats,
          type: 'outgoing',
          height,
          time,
          // Track the outpoint that's being spent so balance/UTXO logic can
          // mark the corresponding incoming entry as spent.
          spentPrevTxid: vin.txid,
          spentPrevVout: vin.vout,
        })
        if (isNew) recorded++
      }
    } catch {
      // prevtx may have been pruned or otherwise unavailable; skip
    }
  }

  return recorded
}

/** One full mempool sweep for a single coin. */
const sweepMempool = async (idx, rpc) => {
  if (idx.watched.size === 0) return
  let txids
  try {
    txids = await rpc('getrawmempool', [])
  } catch (err) {
    logger.warn('indexer.mempoolFailed', { coin: idx.coin, error: err.message })
    return
  }
  const stillIn = new Set(txids)
  for (const pendingTxid of idx.pendingTxids?.() ?? []) {
    if (stillIn.has(pendingTxid)) {
      idx.markPendingSeen?.(pendingTxid)
      continue
    }
    if (await promotePendingTxIfConfirmed(idx, rpc, pendingTxid)) continue
    const missingSince = idx.notePendingMissing?.(pendingTxid, Date.now()) ?? Date.now()
    if (Date.now() - missingSince < PENDING_DROP_GRACE_MS) continue
    const removed = idx.removePendingTx?.(pendingTxid) ?? 0
    if (removed > 0) {
      logger.info('indexer.mempoolDropped', { coin: idx.coin, txid: pendingTxid, removed })
    }
  }
  for (const txid of txids) {
    if (idx.knownMempool.has(txid)) continue
    try {
      const tx = await getRawTransactionVerbose(rpc, txid)
      const n = await processTx(idx, tx, null, Math.floor(Date.now() / 1000), rpc)
      if (n > 0) logger.info('indexer.mempoolHit', { coin: idx.coin, txid, recorded: n })
    } catch {
      // ignore — tx may have been mined/dropped
    }
    idx.knownMempool.add(txid)
  }
  // Trim known-mempool memory: drop entries that left the mempool
  for (const txid of idx.knownMempool) {
    if (!stillIn.has(txid)) idx.knownMempool.delete(txid)
  }
}

/** Scan blocks (height1..height2 inclusive) for any watched-address matches. */
const scanBlocks = async (idx, rpc, fromHeight, toHeight, { reverse = false } = {}) => {
  if (idx.watched.size === 0 || fromHeight > toHeight) return
  const step = reverse ? -1 : 1
  for (let h = reverse ? toHeight : fromHeight; reverse ? h >= fromHeight : h <= toHeight; h += step) {
    try {
      const hash = await rpc('getblockhash', [h])
      const block = await getBlockWithTransactions(rpc, hash)
      for (const tx of block.tx || []) {
        await processTx(idx, tx, h, block.time, rpc)
      }
    } catch (err) {
      logger.warn('indexer.blockScanFailed', { coin: idx.coin, height: h, error: err.message })
      // A saturated Bitcoin-fork RPC returns a plain HTTP 500 instead of a
      // JSON-RPC error. Continuing the block loop immediately creates a
      // retry storm that starves live wallet network/balance requests.
      if (isRpcOverloadError(err)) {
        await delay(RPC_OVERLOAD_BACKOFF_MS)
      }
      // Do not advance scannedHeight past a missing block. Recorded entries
      // are idempotent, so the next bounded sweep can retry this range.
      throw err
    }
  }
}

/** Back-fill a single address — scan the last BACKFILL_BLOCKS for it. */
const backfillForAddress = async (idx, rpc, address) => {
  try {
    const info = await rpc('getblockchaininfo', [])
    const tip = Number(info.blocks || 0)
    const from = Math.max(0, tip - BACKFILL_BLOCKS + 1)
    logger.info('indexer.backfillStart', { coin: idx.coin, address, from, to: tip })
    // Save current watched-set size — we want to scan ONLY for this address.
    // The easiest is to scan the full block range and let watch-set matching
    // filter; since this address is now in the set, it'll be picked up.
    await scanBlocks(idx, rpc, from, tip, { reverse: true })
    idx.flushIfDirty()
  } catch (err) {
    logger.warn('indexer.backfillFailed', { coin: idx.coin, address, error: err.message })
  }
}

/**
 * Public service: register a coin (with its RPC client) and the worker will
 * keep its address index up to date.
 */
class IndexerWorker {
  constructor(service) {
    this.service = service
    this.coins = new Map() // coinId → { rpc, mempoolTimer, blockTimer }
  }

  /** Register a coin with the worker. `rpc(method, params)` is the same kind
   *  of function the adapter uses. */
  register(coin, rpc) {
    if (this.coins.has(coin)) return
    const idx = this.service.ensure(coin)
    const ctx = {
      rpc,
      idx,
      backfillQueue: Promise.resolve(),
      pendingBackfillAddresses: new Set(),
      backfillBatch: null,
      blockInFlight: false,
      mempoolInFlight: false,
      // Loaded watched addresses were already scheduled before the previous
      // clean persistence. Do not immediately rescan 2,000 blocks for every
      // empty address after each gateway restart.
      backfillAttemptedAt: new Map([...idx.watched].map((address) => [address, Date.now()])),
    }
    this.coins.set(coin, ctx)

    // First-time: scan from `scannedHeight` to current tip to catch up.
    const catchUp = async () => {
      try {
        const info = await rpc('getblockchaininfo', [])
        const tip = Number(info.blocks || 0)
        const recentFrom = Math.max(0, tip - BACKFILL_BLOCKS + 1)
        const pruneFrom = info.pruned && Number.isFinite(Number(info.pruneheight))
          ? Number(info.pruneheight)
          : 0
        const from = Math.max(
          idx.scannedHeight ? idx.scannedHeight + 1 : recentFrom,
          recentFrom,
          pruneFrom,
        )
        if (from <= tip && idx.watched.size > 0) {
          await scanBlocks(idx, rpc, from, tip, { reverse: true })
        }
        idx.scannedHeight = tip
        idx.dirty = true
        idx.flushIfDirty()
      } catch (err) {
        logger.warn('indexer.catchUpFailed', { coin, error: err.message })
      }
    }
    // A restart catch-up and first-use address backfills share one queue per
    // coin. Multiple restored wallets must not scan 2,000 blocks in parallel.
    ctx.backfillQueue = catchUp().catch(() => null)

    // Periodic mempool sweep
    ctx.mempoolTimer = setInterval(() => {
      if (ctx.mempoolInFlight) return
      ctx.mempoolInFlight = true
      sweepMempool(idx, rpc).then(() => idx.flushIfDirty()).catch(() => null)
        .finally(() => { ctx.mempoolInFlight = false })
    }, MEMPOOL_POLL_MS)
    ctx.mempoolTimer.unref?.()

    // Periodic block scan
    ctx.blockTimer = setInterval(() => {
      if (ctx.blockInFlight) return
      ctx.blockInFlight = true
      // Keep periodic scans in the existing per-coin backfill queue.
      const sweep = ctx.backfillQueue.catch(() => null).then(async () => {
        const info = await rpc('getblockchaininfo', [])
        const tip = Number(info.blocks || 0)
        if (tip > idx.scannedHeight) {
          const pruneFrom = info.pruned && Number.isSafeInteger(info.pruneheight) ? info.pruneheight : 0
          const from = Math.max(idx.scannedHeight + 1, pruneFrom, Math.max(0, tip - BACKFILL_BLOCKS + 1))
          await scanBlocks(idx, rpc, from, tip)
          idx.scannedHeight = tip
          idx.dirty = true
          idx.flushIfDirty()
        }
      })
      ctx.backfillQueue = sweep.catch(() => null)
      void sweep.catch(() => null).finally(() => { ctx.blockInFlight = false })
    }, BLOCK_POLL_MS)
    ctx.blockTimer.unref?.()
  }

  /** Mark an address as watched and asynchronously back-fill its history. */
  watch(coin, address) {
    void this.warmAddress(coin, address)
  }

  /** Mark an address as watched and wait for a recent backfill if it has no indexed data yet. */
  async warmAddress(coin, address) {
    const ctx = this.coins.get(coin)
    if (!ctx) return
    const wasNew = !ctx.idx.isWatched(address)
    ctx.idx.watch(address)
    const lastAttemptAt = ctx.backfillAttemptedAt.get(address) ?? 0
    if (!wasNew && (
      ctx.idx.history(address).length > 0
      || Date.now() - lastAttemptAt < EMPTY_BACKFILL_RETRY_MS
    )) return
    ctx.pendingBackfillAddresses.add(address)
    if (!ctx.backfillBatch) {
      // scanBlocks matches the complete watched-address set, not just the
      // address passed to backfillForAddress. Coalesce addresses that arrive
      // together into one scan instead of serially repeating the same 2,000
      // blocks for every restored wallet. Addresses added while a scan is in
      // flight form one follow-up batch so none can miss its early blocks.
      const batch = ctx.backfillQueue
        .catch(() => null)
        .then(async () => {
          while (true) {
            await delay(50)
            if (ctx.pendingBackfillAddresses.size === 0) return
            const addresses = [...ctx.pendingBackfillAddresses]
            ctx.pendingBackfillAddresses.clear()
            const attemptedAt = Date.now()
            for (const pendingAddress of addresses) {
              ctx.backfillAttemptedAt.set(pendingAddress, attemptedAt)
            }
            await backfillForAddress(ctx.idx, ctx.rpc, addresses[0])
          }
        })
        .finally(() => {
          if (ctx.backfillBatch === batch) ctx.backfillBatch = null
        })
      ctx.backfillBatch = batch
      ctx.backfillQueue = batch.catch(() => null)
    }
    await ctx.backfillBatch
  }

  /** Read the recorded history for an address. Empty array if unknown. */
  history(coin, address) {
    return this.service.history(coin, address)
  }

  /** Unspent incoming entries (used as UTXOs when the daemon has no scantxoutset). */
  unspent(coin, address) {
    return this.service.unspent(coin, address)
  }

  findOutput(coin, txid, vout) {
    return this.service.findOutput(coin, txid, vout)
  }

  /** Confirmed + pending balance from index alone (in sats). */
  balance(coin, address) {
    return this.service.balance(coin, address)
  }

  /** Known block height for a txid, used as a raw-tx fallback without txindex. */
  txHeight(coin, txid) {
    return this.service.txHeight(coin, txid)
  }

  /** Whether the worker knows about a given coin. */
  knows(coin) {
    return this.coins.has(coin)
  }
}

module.exports = { IndexerWorker }
