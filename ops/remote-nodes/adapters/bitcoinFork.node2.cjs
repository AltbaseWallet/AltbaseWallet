'use strict'

// Generic adapter for any Bitcoin-Core/Dash-fork daemon talking over JSON-RPC.
//
// Methods that work on every fork (vanilla Bitcoin Core в‰Ґ 0.18):
//   getblockchaininfo, getnetworkinfo, getmempoolinfo, sendrawtransaction,
//   validateaddress, estimatesmartfee, scantxoutset, getrawtransaction
//
// Methods that only work when the daemon was started with addressindex=1
// (Dash-style, available on several of our Bitcoin-like daemon builds):
//   getaddressbalance, getaddressutxos, getaddresstxids,
//   getaddressdeltas, getaddressmempool
//
// We try the indexed RPC first because it's free + fast; if the daemon
// reports "method not found" we fall back to `scantxoutset`, which scans
// the UTXO set on the fly (5вЂ“10 s per call, but always works).

const { createBitcoinRpc, RpcError } = require('../lib/rpc.cjs')
const { walletAddressVariants } = require('../lib/addressVariants.cjs')

const isMethodNotFound = (error) =>
  String(error?.message || '').toLowerCase().includes('method not found') ||
  Number(error?.code) === -32601

const isUnsupportedByConfig = (error) =>
  /address.*index|addressindex|not enabled|not maintained|not supported/i.test(String(error?.message || ''))

const isNoAddressInfo = (error) =>
  /no information available for address/i.test(String(error?.message || ''))

const SCAN_UTXO_CACHE_MS = 15 * 60_000
const RECENT_HISTORY_BLOCKS = 96
const RECENT_BLOCK_CACHE_MS = 60_000

/** Build an `addr(<address>)` descriptor for scantxoutset. */
const addrDescriptor = (address) => `addr(${address})`

const extractAddresses = (vout) => {
  const sp = vout?.scriptPubKey || {}
  const out = []
  if (sp.address) out.push(sp.address)
  if (Array.isArray(sp.addresses)) out.push(...sp.addresses)
  return out
}

/**
 * Fold a robust `getMempool` pending list (sourced from getrawmempool) into a
 * confirmed balance result. Some forks have a broken/stale `getaddressmempool`
 * (e.g. Firo returns ghost entries and omits fresh deposits), and the local
 * indexer can miss a deposit that landed before the address was watched — in
 * both cases the confirmed-only balance misses the unconfirmed deposit. This
 * adds any pending tx not already represented (deduped by txid) so an incoming
 * deposit is reflected in the balance at the same time it shows in /mempool.
 * Must run AFTER withLiveSpendableUtxos, which recomputes balance from utxos.
 */
const mergeLiveMempoolPending = (result, mempoolPending) => {
  if (!result || !Array.isArray(mempoolPending) || mempoolPending.length === 0) return result
  const known = new Set([
    ...(result.pendingTxids || []),
    ...(result.pendingOutgoingTxids || []),
    ...((result.utxos || []).map((u) => u?.txid).filter(Boolean)),
    ...((result.pendingTransactions || []).map((t) => t?.txid).filter(Boolean)),
  ])
  let balance = Math.round(Number(result.balance || 0))
  let spendable = Math.round(Number(result.balance_spendable || 0))
  let received = Math.round(Number(result.received || 0))
  let pendingIncoming = Math.round(Number(result.pendingIncoming || 0))
  let pendingOutgoing = Math.round(Number(result.pendingOutgoing || 0))
  const pendingTxids = new Set(result.pendingTxids || [])
  const pendingOutgoingTxids = new Set(result.pendingOutgoingTxids || [])
  const pendingTransactions = [...(result.pendingTransactions || [])]
  for (const tx of mempoolPending) {
    if (!tx?.txid || known.has(tx.txid)) continue
    const amountSats = Math.max(0, Math.round(Number(tx.amount || 0) * 1e8))
    const feeSats = Math.max(0, Math.round(Number(tx.fee || 0) * 1e8))
    if (tx.type === 'incoming' && amountSats > 0) {
      balance += amountSats
      received += amountSats
      pendingIncoming += amountSats
      pendingTxids.add(tx.txid)
      pendingTransactions.push(tx)
      known.add(tx.txid)
    } else if (tx.type === 'outgoing') {
      const spend = amountSats + (tx.to ? feeSats : 0)
      pendingOutgoing += spend
      balance = Math.max(0, balance - spend)
      spendable = Math.max(0, spendable - spend)
      pendingTxids.add(tx.txid)
      pendingOutgoingTxids.add(tx.txid)
      known.add(tx.txid)
    }
  }
  return {
    ...result,
    balance: Math.max(0, balance),
    balance_spendable: Math.max(0, spendable),
    received,
    pendingIncoming,
    pendingOutgoing,
    mempoolNet: pendingIncoming - pendingOutgoing,
    pendingTxids: [...pendingTxids],
    pendingOutgoingTxids: [...pendingOutgoingTxids],
    pendingTransactions,
  }
}

const firstOutputAddress = (vout) => extractAddresses(vout)[0]

const mapIndexedUtxo = (utxo) => ({
  txid: utxo.txid,
  outputIndex: utxo.outputIndex ?? utxo.vout,
  script: utxo.script,
  satoshis: utxo.satoshis,
  height: utxo.height,
})

const createBitcoinForkAdapter = ({ coin, rpcUrl, rpcUser, rpcPassword, readProfile = 'auto', indexer }) => {
  if (!coin) throw new Error('bitcoinFork adapter: missing `coin`')
  if (!rpcUrl || !rpcUser || !rpcPassword) {
    throw new Error(`bitcoinFork adapter (${coin}): missing rpcUrl/rpcUser/rpcPassword`)
  }

  const rpc = createBitcoinRpc({ url: rpcUrl, user: rpcUser, password: rpcPassword })
  const profile = ['auto', 'address-index', 'scan-utxo', 'local-index'].includes(String(readProfile || '').toLowerCase())
    ? String(readProfile || '').toLowerCase()
    : 'auto'
  const allowsAddressIndex = profile !== 'scan-utxo' && profile !== 'local-index'
  const allowsScanTxOutSet = profile !== 'address-index' && profile !== 'local-index'
  // Neoxa's daemon takes several seconds to decode a single verbose block.
  // Its persistent per-address index is updated by the background block and
  // mempool workers, so rescanning recent blocks on every interactive history
  // request only creates timeouts without adding authoritative data.
  const allowsRecentHistoryOverlay = profile !== 'address-index' && coin !== 'neoxa'
  const recentHistoryBlocks = RECENT_HISTORY_BLOCKS
  // Cache feature-detection results so we don't probe every call.
  let hasAddressIndex = null   // Dash-style getaddress* RPCs
  let hasScanTxOutSet = null   // Bitcoin Core 0.17+ scantxoutset RPC
  let scanQueue = Promise.resolve()
  let localIndexerRegistered = false
  const scannedUtxoCache = new Map()
  const recentBlockCache = new Map()
  let liveMempoolCache = null

  const normalizeUtxoList = (utxos) => {
    if (Array.isArray(utxos)) return utxos
    if (Array.isArray(utxos?.utxos)) return utxos.utxos
    return []
  }

  const cloneUtxos = (utxos) => normalizeUtxoList(utxos).map((utxo) => ({ ...utxo }))

  const readScannedUtxos = (address) => {
    const entry = scannedUtxoCache.get(address)
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) scannedUtxoCache.delete(address)
      return null
    }
    return {
      fromCache: true,
      utxos: cloneUtxos(entry.utxos),
    }
  }

  const writeScannedUtxos = (address, utxos) => {
    scannedUtxoCache.set(address, {
      createdAt: Date.now(),
      expiresAt: Date.now() + SCAN_UTXO_CACHE_MS,
      utxos: cloneUtxos(utxos),
    })
  }

  const ensureLocalIndexer = () => {
    if (!indexer) return null
    if (!localIndexerRegistered) {
      indexer.register(coin, rpc)
      localIndexerRegistered = true
    }
    return indexer
  }

  // A first-time address backfill scans up to 2,000 blocks. Keep that work in
  // the background after a short head start so balance/history endpoints stay
  // within the wallet and reverse-proxy request budgets. Later refreshes merge
  // the completed persistent index as usual.
  const warmLocalAddressBounded = async (localIndexer, address, waitMs = 1_500) => {
    if (!localIndexer) return
    if (typeof localIndexer.warmAddress !== 'function') {
      localIndexer.watch?.(coin, address)
      return
    }
    const warmup = Promise.resolve(localIndexer.warmAddress(coin, address)).catch(() => undefined)
    let timer
    try {
      await Promise.race([
        warmup,
        new Promise((resolve) => { timer = setTimeout(resolve, waitMs) }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const probeAddressIndex = async () => {
    if (!allowsAddressIndex) return false
    if (hasAddressIndex !== null) return hasAddressIndex
    try {
      await rpc('getaddressbalance', [{ addresses: [] }])
      hasAddressIndex = true
    } catch (error) {
      if (isMethodNotFound(error) || isUnsupportedByConfig(error)) {
        hasAddressIndex = false
      } else {
        hasAddressIndex = true
      }
    }
    return hasAddressIndex
  }

  const probeScanTxOutSet = async () => {
    if (!allowsScanTxOutSet) return false
    if (hasScanTxOutSet !== null) return hasScanTxOutSet
    try {
      await rpc('scantxoutset', ['status'])
      hasScanTxOutSet = true
    } catch (error) {
      hasScanTxOutSet = !isMethodNotFound(error)
    }
    return hasScanTxOutSet
  }

  const buildAddressSet = async (address) => {
    const set = new Set([address])
    for (const variant of walletAddressVariants(coin, address)) set.add(variant)
    try {
      const info = await rpc('validateaddress', [address])
      if (info?.address) set.add(info.address)
    } catch {
      // best effort only
    }
    return set
  }

  const runExclusiveScan = async (task) => {
    const run = scanQueue.catch(() => null).then(task)
    scanQueue = run.catch(() => null)
    return run
  }

  const liveMempoolTxids = async () => {
    const now = Date.now()
    if (liveMempoolCache && liveMempoolCache.expiresAt > now) return liveMempoolCache.txids
    const raw = await rpc('getrawmempool', [])
    const txids = new Set(Array.isArray(raw) ? raw : Object.keys(raw || {}))
    liveMempoolCache = { expiresAt: now + 3_000, txids }
    return txids
  }

  const scanAddressBalance = async (address, { force = false } = {}) => {
    const scan = await scanAddressUtxos(address, { force, withMeta: true })
    if (!Array.isArray(scan?.utxos)) return { sats: null, fromCache: false }
    const liveUtxos = await filterSpendableUtxos(scan.utxos)
    return {
      sats: liveUtxos.reduce((sum, utxo) => sum + Number(utxo.satoshis || 0), 0),
      fromCache: scan.fromCache === true,
      utxos: liveUtxos,
    }
  }

  const historyOverlayUtxos = async (address) => {
    if (await probeAddressIndex()) {
      try {
        const indexed = await rpc('getaddressutxos', [{ addresses: [address] }])
        if (Array.isArray(indexed) && indexed.length > 0) {
          return indexed.map(mapIndexedUtxo)
        }
      } catch (error) {
        if (!(isMethodNotFound(error) || isUnsupportedByConfig(error) || isNoAddressInfo(error))) {
          throw error
        }
      }
    }
    const scanned = await scanAddressUtxos(address)
    return Array.isArray(scanned) ? scanned : []
  }

  const scanAddressUtxos = async (address, { force = false, withMeta = false, cachedOnly = false } = {}) => {
    if (!force) {
      const cached = readScannedUtxos(address)
      if (cached) return withMeta ? cached : cached.utxos
    }
    if (cachedOnly) return withMeta ? { utxos: null, fromCache: false } : null
    if (!(await probeScanTxOutSet())) return withMeta ? { utxos: null, fromCache: false } : null
    return runExclusiveScan(async () => {
      const scan = await rpc('scantxoutset', ['start', [{ desc: addrDescriptor(address) }]])
      const utxos = (scan.unspents || []).map((u) => ({
        txid: u.txid,
        outputIndex: u.vout,
        script: u.scriptPubKey,
        satoshis: Math.round(Number(u.amount || 0) * 1e8),
        height: u.height,
      }))
      writeScannedUtxos(address, utxos)
      return withMeta ? { utxos, fromCache: false } : utxos
    }).catch(() => {
      return withMeta ? { utxos: null, fromCache: false } : null
    })
  }

  const getLiveTxOut = async (txid, outputIndex) => {
    try {
      return await rpc('gettxout', [txid, outputIndex, true])
    } catch (error) {
      if (!/too many parameters|wrong number of parameters|invalid parameter/i.test(String(error?.message || ''))) {
        throw error
      }
      return rpc('gettxout', [txid, outputIndex])
    }
  }

  const filterSpendableUtxos = async (utxos) => {
    const out = []
    for (const utxo of normalizeUtxoList(utxos)) {
      const outputIndex = Number(utxo.outputIndex ?? utxo.vout)
      if (!utxo?.txid || !Number.isInteger(outputIndex) || outputIndex < 0) continue

      let live
      try {
        live = await getLiveTxOut(utxo.txid, outputIndex)
      } catch {
        // If a fork cannot answer gettxout right now, keep the candidate so
        // older daemons can still send instead of failing closed.
        out.push({ ...utxo, outputIndex })
        continue
      }
      if (!live) continue

      out.push({
        ...utxo,
        outputIndex,
        script: utxo.script ?? live.scriptPubKey?.hex,
        satoshis: Number.isFinite(Number(utxo.satoshis))
          ? Number(utxo.satoshis)
          : Math.round(Number(live.value || 0) * 1e8),
      })
    }
    return out
  }

  const withLiveSpendableUtxos = async (balance) => {
    const sourceUtxos = normalizeUtxoList(balance?.utxos)
    if (sourceUtxos.length === 0) return balance
    const liveUtxos = await filterSpendableUtxos(sourceUtxos)
    const liveBalance = liveUtxos.reduce((sum, utxo) => sum + Number(utxo.satoshis || 0), 0)
    const liveSpendable = liveUtxos
      .filter((utxo) => Number(utxo.height ?? 0) > 0)
      .reduce((sum, utxo) => sum + Number(utxo.satoshis || 0), 0)
    return {
      ...balance,
      balance: Math.max(0, liveBalance),
      balance_spendable: Math.max(0, liveSpendable),
      utxos: liveUtxos,
    }
  }

  const blockTxCache = new Map()
  let chainTipCache = null
  const getChainTipHeight = async () => {
    const now = Date.now()
    if (chainTipCache && chainTipCache.expiresAt > now) return chainTipCache.height
    const info = await rpc('getblockchaininfo', [])
    const height = Number(info.blocks || 0)
    if (Number.isFinite(height) && height > 0) {
      chainTipCache = { height, expiresAt: now + 5_000 }
      return height
    }
    return null
  }

  const withBlockMeta = async (tx, heightHint = null, blockHint = null) => {
    if (!tx || typeof tx !== 'object') return tx
    let height = Number.isFinite(Number(tx.height)) ? Number(tx.height) : null
    let time = Number.isFinite(Number(tx.blocktime))
      ? Number(tx.blocktime)
      : (Number.isFinite(Number(tx.time)) ? Number(tx.time) : null)
    let confirmations = Number.isFinite(Number(tx.confirmations)) ? Number(tx.confirmations) : null
    let blockhash = tx.blockhash
    let block = blockHint

    if ((!Number.isFinite(height) || !Number.isFinite(time)) && (blockhash || heightHint !== null && heightHint !== undefined)) {
      try {
        if (!block) {
          if (blockhash) {
            block = await rpc('getblock', [blockhash])
          } else {
            blockhash = await rpc('getblockhash', [heightHint])
            block = await rpc('getblock', [blockhash])
          }
        }
        if (block && typeof block === 'object') {
          if (!Number.isFinite(height) && Number.isFinite(Number(block.height))) height = Number(block.height)
          if (!Number.isFinite(time) && Number.isFinite(Number(block.time))) time = Number(block.time)
          blockhash = blockhash ?? block.hash
        }
      } catch {
        // Some older forks omit block metadata; keep the transaction usable.
      }
    }
    if (Number.isFinite(height)) {
      try {
        const tip = await getChainTipHeight()
        const computed = Number.isFinite(tip) && tip >= height ? Math.max(1, tip - height + 1) : null
        if (Number.isFinite(computed) && (!Number.isFinite(confirmations) || computed > confirmations)) {
          confirmations = computed
        }
      } catch {
        // Leave unresolved; the client will still get height/time when available.
      }
    }

    return {
      ...tx,
      ...(Number.isFinite(height) ? { height } : {}),
      ...(Number.isFinite(time) ? { blocktime: tx.blocktime ?? time, time: tx.time ?? time } : {}),
      ...(Number.isFinite(confirmations) ? { confirmations } : {}),
      ...(blockhash ? { blockhash } : {}),
    }
  }

  const getRawTransactionVerbose = async (txid, heightHint = null) => {
    try {
      const tx = await rpc('getrawtransaction', [txid, true])
      return await withBlockMeta(tx, heightHint)
    } catch (error) {
      if (/integer as expected/i.test(String(error?.message || ''))) {
        try {
          const tx = await rpc('getrawtransaction', [txid, 1])
          return await withBlockMeta(tx, heightHint)
        } catch {
          // Fall through to the height-hint block lookup below.
        }
      }
      const indexedHeight = heightHint ?? (localIndexerRegistered ? indexer?.txHeight?.(coin, txid) : null) ?? null
      if (indexedHeight === null || indexedHeight === undefined) throw error
      const cacheKey = String(indexedHeight)
      let txs = blockTxCache.get(cacheKey)
      if (!txs) {
        const hash = await rpc('getblockhash', [indexedHeight])
        let block
        try {
          block = await rpc('getblock', [hash, 2])
        } catch (blockError) {
          if (!/boolean as expected/i.test(String(blockError?.message || ''))) throw blockError
          const legacyBlock = await rpc('getblock', [hash, true])
          const verboseTxs = []
          for (const id of legacyBlock.tx || []) verboseTxs.push(await getRawTransactionVerbose(id))
          block = { ...legacyBlock, tx: verboseTxs }
        }
        txs = new Map((block.tx || []).filter((tx) => tx?.txid).map((tx) => [tx.txid, tx]))
        blockTxCache.set(cacheKey, txs)
        if (blockTxCache.size > 32) blockTxCache.delete(blockTxCache.keys().next().value)
      }
      const tx = txs.get(txid)
      if (!tx) throw error
      return await withBlockMeta(tx, indexedHeight)
    }
  }

  const getConfirmedTransactionMeta = async (txid) => {
    let tx
    try {
      tx = await getRawTransactionVerbose(txid)
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
        // Some old forks have quirky getblock verbosity; confirmations below are enough.
      }
    }
    if (!Number.isFinite(height) && confirmations > 0) {
      try {
        const info = await rpc('getblockchaininfo', [])
        const tip = Number(info.blocks || 0)
        if (Number.isFinite(tip) && tip > 0) height = tip - confirmations + 1
      } catch {
        // Leave unresolved; callers will keep the pending row instead of deleting it.
      }
    }
    if (!Number.isFinite(height)) return null
    return { tx, height, time: Number.isFinite(time) ? time : null }
  }

  const getBlockVerboseByHeight = async (height) => {
    const key = String(height)
    const cached = recentBlockCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const hash = await rpc('getblockhash', [height])
    let block
    try {
      block = await rpc('getblock', [hash, 2])
    } catch (blockError) {
      if (!/boolean as expected/i.test(String(blockError?.message || ''))) throw blockError
      const legacyBlock = await rpc('getblock', [hash, true])
      const verboseTxs = []
      for (const id of legacyBlock.tx || []) verboseTxs.push(await getRawTransactionVerbose(id, height))
      block = { ...legacyBlock, tx: verboseTxs }
    }

    recentBlockCache.set(key, { expiresAt: Date.now() + RECENT_BLOCK_CACHE_MS, value: block })
    if (recentBlockCache.size > RECENT_HISTORY_BLOCKS * 2) {
      const first = recentBlockCache.keys().next().value
      if (first) recentBlockCache.delete(first)
    }
    return block
  }

  const enrichInputs = async (txs) => {
    const cache = new Map() // prev-txid -> raw tx
    const lookup = async (txid) => {
      if (cache.has(txid)) return cache.get(txid)
      try {
        const raw = await getRawTransactionVerbose(txid)
        cache.set(txid, raw)
        return raw
      } catch {
        cache.set(txid, null)
        return null
      }
    }
    const indexedPrevout = (txid, vout) => {
      const localIndexer = ensureLocalIndexer()
      const indexed = localIndexer?.findOutput?.(coin, txid, vout)
      if (!indexed) return null
      return {
        value: Number(indexed.sats || 0) / 1e8,
        scriptPubKey: {
          address: indexed.address,
          addresses: [indexed.address],
          hex: indexed.scriptHex ?? undefined,
        },
      }
    }
    for (const t of txs) {
      if (!t || !Array.isArray(t.vin)) continue
      let inputTotal = 0
      let inputsResolved = 0
      for (const vin of t.vin) {
        if (!vin.txid) { inputTotal = null; break }
        const prev = await lookup(vin.txid)
        const prevVout = prev?.vout?.[vin.vout] ?? indexedPrevout(vin.txid, vin.vout)
        if (!prevVout) { inputTotal = null; continue }
        const val = Number(prevVout.value || 0)
        if (typeof inputTotal === 'number') inputTotal += val
        inputsResolved++
        vin.address = firstOutputAddress(prevVout) ?? vin.address
        vin.value = val
      }
      if (typeof inputTotal === 'number' && inputsResolved === t.vin.length) {
        const outTotal = (t.vout || []).reduce((s, o) => s + Number(o.value || 0), 0)
        const fee = inputTotal - outTotal
        if (fee > 0) t.fee = fee
      }
    }
  }

  const txDeltaSatsForAddressSet = (tx, addressSet) => {
    if (!tx || typeof tx !== 'object') return 0
    const ownInputCoin = (tx.vin || []).reduce((sum, vin) =>
      vin.address && addressSet.has(vin.address) ? sum + Number(vin.value || 0) : sum,
    0)
    const ownOutputCoin = (tx.vout || []).reduce((sum, vout) => {
      const addrs = extractAddresses(vout)
      return addrs.some((addr) => addressSet.has(addr)) ? sum + Number(vout.value || 0) : sum
    }, 0)
    return Math.round((ownOutputCoin - ownInputCoin) * 1e8)
  }

  const verifiedAddressBalanceFromRawRows = async (address, rawRows, {
    heightByTxid = new Map(),
    timeByTxid = new Map(),
  } = {}) => {
    await enrichInputs(rawRows)

    const addressSet = await buildAddressSet(address)
    const incoming = new Map()
    const spent = new Set()
    const pendingTxids = new Set()
    const pendingOutgoingTxids = new Set()
    const pendingTransactions = new Map()
    let pendingOutgoing = 0

    for (const tx of rawRows) {
      const txid = tx?.txid || tx?.hash
      if (!txid) continue
      const height = Number.isFinite(Number(tx.height))
        ? Number(tx.height)
        : (Number.isFinite(Number(heightByTxid.get(txid))) ? Number(heightByTxid.get(txid)) : null)
      const confirmations = Number(tx.confirmations ?? 0)
      const confirmed = Number.isFinite(height) || confirmations > 0
      const timestamp = tx.blocktime ?? tx.time ?? timeByTxid.get(txid) ?? null

      let ownOutputSats = 0
      for (const vout of tx.vout || []) {
        const outputAddresses = extractAddresses(vout)
        if (!outputAddresses.some((item) => addressSet.has(item))) continue
        const voutIndex = Number(vout.n)
        if (!Number.isInteger(voutIndex) || voutIndex < 0) continue
        const satoshis = Math.round(Number(vout.value || 0) * 1e8)
        if (satoshis <= 0) continue
        ownOutputSats += satoshis
        incoming.set(`${txid}:${voutIndex}`, {
          txid,
          outputIndex: voutIndex,
          script: vout.scriptPubKey?.hex,
          satoshis,
          height: Number.isFinite(height) ? height : 0,
          confirmed,
          timestamp,
        })
      }

      let ownInputSats = 0
      for (const vin of tx.vin || []) {
        if (!vin.txid || !Number.isInteger(Number(vin.vout))) continue
        if (!vin.address || !addressSet.has(vin.address)) continue
        const satoshis = Math.round(Number(vin.value || 0) * 1e8)
        ownInputSats += Math.max(0, satoshis)
        spent.add(`${vin.txid}:${Number(vin.vout)}`)
      }

      if (!confirmed) {
        if (ownOutputSats > 0) {
          pendingTxids.add(txid)
          const amount = (ownOutputSats / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0'
          pendingTransactions.set(txid, {
            txid,
            type: 'incoming',
            amount,
            to: address,
            firstSeen: timestamp ?? Math.floor(Date.now() / 1000),
            confirmations: 0,
          })
        }
        if (ownInputSats > 0) {
          const netOutgoing = Math.max(0, ownInputSats - ownOutputSats)
          pendingOutgoing += netOutgoing
          pendingTxids.add(txid)
          pendingOutgoingTxids.add(txid)
        }
      }
    }

    const utxos = []
    let balance = 0
    let spendable = 0
    let received = 0
    let pendingIncoming = 0
    for (const utxo of incoming.values()) {
      received += utxo.satoshis
      if (spent.has(`${utxo.txid}:${utxo.outputIndex}`)) continue
      balance += utxo.satoshis
      if (utxo.confirmed) spendable += utxo.satoshis
      else pendingIncoming += utxo.satoshis
      if (utxo.script) {
        utxos.push({
          txid: utxo.txid,
          outputIndex: utxo.outputIndex,
          script: utxo.script,
          satoshis: utxo.satoshis,
          height: utxo.height,
        })
      }
    }

    return {
      hasData: rawRows.length > 0,
      result: {
        address,
        balance: Math.max(0, balance),
        balance_spendable: Math.max(0, spendable - pendingOutgoing),
        received,
        immature: 0,
        pendingIncoming,
        pendingOutgoing,
        mempoolNet: pendingIncoming - pendingOutgoing,
        pendingTxids: [...pendingTxids],
        pendingOutgoingTxids: [...pendingOutgoingTxids],
        pendingTransactions: [...pendingTransactions.values()],
        utxos,
      },
    }
  }

  const verifiedAddressBalanceFromHistory = async (address) => {
    const noInfo = Symbol('no-address-info')
    const indexedRead = (method) =>
      rpc(method, [{ addresses: [address] }]).catch((error) => {
        if (isNoAddressInfo(error)) return noInfo
        return []
      })
    const [indexedTxids, indexedDeltas, indexedMempool] = await Promise.all([
      indexedRead('getaddresstxids'),
      indexedRead('getaddressdeltas'),
      indexedRead('getaddressmempool'),
    ])
    const txids = indexedTxids === noInfo ? [] : (Array.isArray(indexedTxids) ? indexedTxids : [])
    const deltas = indexedDeltas === noInfo ? [] : (Array.isArray(indexedDeltas) ? indexedDeltas : [])
    let mempool = indexedMempool === noInfo ? [] : (Array.isArray(indexedMempool) ? indexedMempool : [])
    if (mempool.length > 0) {
      try {
        const live = await liveMempoolTxids()
        mempool = mempool.filter((entry) => entry?.txid && live.has(entry.txid))
      } catch {
        mempool = []
      }
    }

    const heightByTxid = new Map()
    const timeByTxid = new Map()
    for (const entry of [...deltas, ...mempool]) {
      if (!entry?.txid) continue
      if (entry.height !== null && entry.height !== undefined) heightByTxid.set(entry.txid, entry.height)
      if (entry.time !== null && entry.time !== undefined) timeByTxid.set(entry.txid, entry.time)
      else if (entry.timestamp !== null && entry.timestamp !== undefined) timeByTxid.set(entry.txid, entry.timestamp)
    }
    const orderedTxids = Array.from(new Set([
      ...deltas.map((entry) => entry?.txid).filter(Boolean),
      ...mempool.map((entry) => entry?.txid).filter(Boolean),
      ...txids.filter(Boolean),
    ]))
    if (orderedTxids.length === 0) {
      return {
        hasData: false,
        result: {
          address,
          balance: 0,
          balance_spendable: 0,
          received: 0,
          immature: 0,
          pendingIncoming: 0,
          pendingOutgoing: 0,
          mempoolNet: 0,
          pendingTxids: [],
          pendingOutgoingTxids: [],
          pendingTransactions: [],
          utxos: [],
        },
      }
    }

    const rawRows = []
    for (const txid of orderedTxids.slice(0, 5000)) {
      try {
        rawRows.push(await getRawTransactionVerbose(txid, heightByTxid.get(txid) ?? null))
      } catch {
        // A balance row must be backed by raw transaction data. Unreadable
        // address-index rows are ignored instead of becoming phantom funds.
      }
    }
    return verifiedAddressBalanceFromRawRows(address, rawRows, { heightByTxid, timeByTxid })
  }

  const verifiedAddressBalanceFromLocalIndex = async (address, entries) => {
    const rows = Array.isArray(entries) ? entries : []
    if (rows.length === 0) return null
    const heightByTxid = new Map()
    const timeByTxid = new Map()
    const orderedTxids = []
    const seen = new Set()
    for (const entry of rows) {
      if (!entry?.txid || seen.has(entry.txid)) continue
      seen.add(entry.txid)
      orderedTxids.push(entry.txid)
      if (entry.height !== null && entry.height !== undefined) heightByTxid.set(entry.txid, entry.height)
      if (entry.time !== null && entry.time !== undefined) timeByTxid.set(entry.txid, entry.time)
    }
    const rawRows = []
    for (const txid of orderedTxids.slice(0, 5000)) {
      try {
        rawRows.push(await getRawTransactionVerbose(txid, heightByTxid.get(txid) ?? null))
      } catch {
        // Local index rows from old cache files can outlive raw tx access.
        // Ignore those rows instead of rebuilding phantom UTXOs from them.
      }
    }
    return verifiedAddressBalanceFromRawRows(address, rawRows, { heightByTxid, timeByTxid })
  }

  const assertRelayFee = async (hex) => {
    let decoded
    try {
      decoded = await rpc('decoderawtransaction', [hex])
    } catch {
      return
    }
    await enrichInputs([decoded])
    const inputCoin = (decoded.vin || []).reduce((sum, vin) => sum + Number(vin.value || 0), 0)
    const outputCoin = (decoded.vout || []).reduce((sum, vout) => sum + Number(vout.value || 0), 0)
    if (!(inputCoin > 0) || !(outputCoin > 0) || inputCoin <= outputCoin) return

    let relayFee = 0
    try {
      const net = await rpc('getnetworkinfo', [])
      if (typeof net.relayfee === 'number' && net.relayfee > 0) relayFee = net.relayfee
    } catch {
      return
    }
    if (!(relayFee > 0)) return

    const size = Number(decoded.vsize || decoded.size || Math.ceil(hex.length / 2))
    const fee = inputCoin - outputCoin
    const minFee = (relayFee * size) / 1000
    if (fee + 1e-12 < minFee) {
      throw new RpcError(
        `transaction fee below network minimum: ${fee.toFixed(8)} ${coin} < ${minFee.toFixed(8)} ${coin}`,
        { status: 400 },
      )
    }
  }

  return {
    coin,
    kind: 'bitcoin-rpc',
    readProfile: profile,

    async getRawTransaction(txid, height) {
      const raw = await getRawTransactionVerbose(txid, height)
      return raw.hex || await rpc('getrawtransaction', [txid, false])
    },

    async getNetwork() {
      const [chain, net, mempool] = await Promise.all([
        rpc('getblockchaininfo'),
        rpc('getnetworkinfo'),
        rpc('getmempoolinfo'),
      ])
      return {
        coin,
        chain: chain.chain,
        blocks: chain.blocks,
        headers: chain.headers,
        bestBlockHash: chain.bestblockhash,
        difficulty: chain.difficulty,
        initialBlockDownload: chain.initialblockdownload,
        verificationProgress: chain.verificationprogress,
        connections: net.connections,
        version: net.buildversion ?? net.version,
        subversion: net.subversion,
        relayFee: net.relayfee,
        mempoolSize: mempool.size,
        readProfile: profile,
      }
    },

    async getBalance(address, { force = false } = {}) {
      // Fast path: Dash-style addressindex RPCs
      let addressIndexReturnedNoInfo = false
      if (await probeAddressIndex()) {
        const result = await rpc('getaddressbalance', [{ addresses: [address] }]).catch((error) => {
          if (isNoAddressInfo(error)) { addressIndexReturnedNoInfo = true; return null }
          throw error
        })
        if (result) {
          const indexedBalance = Number(result.balance ?? 0)
          const verified = await verifiedAddressBalanceFromHistory(address).catch((error) => {
            console.warn(JSON.stringify({
              ts: new Date().toISOString(),
              level: 'warn',
              msg: 'balance_verify_failed',
              coin,
              address,
              error: error?.message || String(error),
            }))
            return null
          })
          if (verified && (verified.hasData || indexedBalance > 0)) {
            const confirmedResult = await withLiveSpendableUtxos(verified.result)
            const liveMempool = await this.getMempool(address).catch(() => null)
            return mergeLiveMempoolPending(confirmedResult, liveMempool?.pending)
          }
          let confirmedBalance = indexedBalance
          let confirmedSpendable = Number(result.balance_spendable ?? result.balance ?? 0)
          let balanceUtxos = []
          let confirmedByLiveUtxos = false
          try {
            const indexedUtxos = await rpc('getaddressutxos', [{ addresses: [address] }])
            if (Array.isArray(indexedUtxos)) {
              const liveUtxos = await filterSpendableUtxos(indexedUtxos.map(mapIndexedUtxo))
              balanceUtxos = liveUtxos
              const liveBalance = liveUtxos.reduce((sum, utxo) => sum + Number(utxo.satoshis || 0), 0)
              confirmedBalance = liveBalance
              confirmedSpendable = liveBalance
              confirmedByLiveUtxos = true
            }
          } catch (error) {
            if (!(isMethodNotFound(error) || isUnsupportedByConfig(error) || isNoAddressInfo(error))) {
              throw error
            }
          }
          if (!confirmedByLiveUtxos) {
            const scanned = await scanAddressBalance(address, { force })
            if (scanned.sats !== null && hasScanTxOutSet === true) {
              confirmedBalance = scanned.sats
              confirmedSpendable = scanned.sats
              balanceUtxos = scanned.utxos ?? []
              confirmedByLiveUtxos = true
            }
          }
          let pendingIncoming = 0
          let pendingOutgoing = 0
          const pendingTxids = new Set()
          const pendingOutgoingTxids = new Set()
          const pendingTransactions = new Map()
          try {
            const rawMempool = await this.getMempool(address)
            for (const tx of rawMempool.pending ?? []) {
              if (!tx?.txid || pendingTxids.has(tx.txid)) continue
              const amountSats = Math.max(0, Math.round(Number(tx.amount || 0) * 1e8))
              const feeSats = Math.max(0, Math.round(Number(tx.fee || 0) * 1e8))
              if (tx.type === 'incoming') {
                pendingIncoming += amountSats
                pendingTxids.add(tx.txid)
                pendingTransactions.set(tx.txid, tx)
              } else if (tx.type === 'outgoing') {
                pendingOutgoing += amountSats + (tx.to ? feeSats : 0)
                pendingTxids.add(tx.txid)
                pendingOutgoingTxids.add(tx.txid)
              }
            }
          } catch {
            // Raw mempool scan is best-effort; confirmed UTXOs stay authoritative.
          }
          if (!confirmedByLiveUtxos) {
            const fallbackIndexer = ensureLocalIndexer()
            if (fallbackIndexer?.warmAddress) await fallbackIndexer.warmAddress(coin, address)
            else fallbackIndexer?.watch(coin, address)
            const fallbackBalance = fallbackIndexer?.balance?.(coin, address) ?? null
            const fallbackUtxos = fallbackIndexer?.unspent?.(coin, address)
              ?.filter((e) => e.scriptHex)
              ?.map((e) => ({
                txid: e.txid,
                outputIndex: e.vout,
                script: e.scriptHex,
                satoshis: e.sats,
                height: e.height ?? 0,
              })) ?? []
            const fallbackPendingIncoming = fallbackBalance?.pendingIncoming ?? 0
            const fallbackPendingOutgoing = fallbackBalance?.pendingOutgoing ?? 0
            const fallbackConfirmed = fallbackBalance?.confirmedSpendable ?? 0
            const fallbackVisible = Math.max(0, fallbackConfirmed + fallbackPendingIncoming - fallbackPendingOutgoing)
            if (fallbackVisible > 0 || fallbackUtxos.length > 0) {
              return {
                address,
                balance: fallbackVisible,
                balance_spendable: Math.max(0, fallbackConfirmed - fallbackPendingOutgoing),
                received: fallbackConfirmed + fallbackPendingIncoming,
                immature: 0,
                pendingIncoming: fallbackPendingIncoming,
                pendingOutgoing: fallbackPendingOutgoing,
                mempoolNet: fallbackPendingIncoming - fallbackPendingOutgoing,
                pendingTxids: fallbackBalance?.pendingTxids ?? [],
                pendingOutgoingTxids: fallbackBalance?.pendingOutgoingTxids ?? [],
                utxos: fallbackUtxos,
              }
            }
            confirmedBalance = 0
            confirmedSpendable = 0
            balanceUtxos = []
          }
          const mempoolNet = pendingIncoming - pendingOutgoing
          const visibleBalance = Math.max(0, confirmedBalance + mempoolNet)
          if (visibleBalance === 0 && pendingOutgoing === 0 && balanceUtxos.length === 0) {
            const fallbackIndexer = ensureLocalIndexer()
            if (fallbackIndexer?.warmAddress) await fallbackIndexer.warmAddress(coin, address)
            else fallbackIndexer?.watch(coin, address)
            const fallbackBalance = fallbackIndexer?.balance?.(coin, address) ?? null
            const fallbackUtxos = fallbackIndexer?.unspent?.(coin, address)
              ?.filter((e) => e.scriptHex)
              ?.map((e) => ({
                txid: e.txid,
                outputIndex: e.vout,
                script: e.scriptHex,
                satoshis: e.sats,
                height: e.height ?? 0,
              })) ?? []
            const fallbackPendingIncoming = fallbackBalance?.pendingIncoming ?? 0
            const fallbackPendingOutgoing = fallbackBalance?.pendingOutgoing ?? 0
            const fallbackConfirmed = fallbackBalance?.confirmedSpendable ?? 0
            const fallbackVisible = Math.max(0, fallbackConfirmed + fallbackPendingIncoming - fallbackPendingOutgoing)
            if (fallbackVisible > 0 || fallbackUtxos.length > 0) {
              return {
                address,
                balance: fallbackVisible,
                balance_spendable: Math.max(0, fallbackConfirmed - fallbackPendingOutgoing),
                received: fallbackConfirmed + fallbackPendingIncoming,
                immature: 0,
                pendingIncoming: fallbackPendingIncoming,
                pendingOutgoing: fallbackPendingOutgoing,
                mempoolNet: fallbackPendingIncoming - fallbackPendingOutgoing,
                pendingTxids: fallbackBalance?.pendingTxids ?? [],
                pendingOutgoingTxids: fallbackBalance?.pendingOutgoingTxids ?? [],
                utxos: fallbackUtxos,
              }
            }
            const cachedScan = readScannedUtxos(address)
            if (cachedScan) {
              const liveCachedUtxos = await filterSpendableUtxos(cachedScan.utxos)
              const cachedBalance = liveCachedUtxos.reduce((sum, utxo) => sum + Number(utxo.satoshis || 0), 0)
              if (cachedBalance > 0) {
                return {
                  address,
                  balance: cachedBalance,
                  balance_spendable: cachedBalance,
                  received: cachedBalance,
                  immature: 0,
                  pendingIncoming: 0,
                  pendingOutgoing: 0,
                  mempoolNet: 0,
                  pendingTxids: [],
                  pendingOutgoingTxids: [],
                  utxos: liveCachedUtxos,
                }
              }
            }
          }
          return {
            address,
            balance: visibleBalance,
            balance_spendable: Math.max(0, confirmedSpendable - pendingOutgoing),
            received: Number(result.received ?? 0) + pendingIncoming,
            immature: Number(result.immature ?? 0),
            pendingIncoming,
            pendingOutgoing,
            mempoolNet,
            pendingTxids: [...pendingTxids],
            pendingOutgoingTxids: [...pendingOutgoingTxids],
            pendingTransactions: [...pendingTransactions.values()],
            utxos: balanceUtxos,
          }
        }
      }

      // Some Dash-style forks (notably Neoxa) use RPC -5 to mean that a
      // perfectly valid address has no indexed activity. That answer is
      // authoritative for the current snapshot, so do not turn a zero-balance
      // read into a multi-thousand-block synchronous backfill. Keep a local
      // backfill running in the background for daemon variants whose address
      // index is incomplete; once it finds entries, the regular fallback below
      // will verify and return them on a later refresh.
      if (addressIndexReturnedNoInfo) {
        const fallbackIndexer = ensureLocalIndexer()
        const fallbackEntries = fallbackIndexer?.history?.(coin, address) ?? []
        if (fallbackEntries.length === 0) {
          void warmLocalAddressBounded(fallbackIndexer, address, 0).catch(() => undefined)
          return {
            address,
            balance: 0,
            balance_spendable: 0,
            received: 0,
            immature: 0,
            pendingIncoming: 0,
            pendingOutgoing: 0,
            mempoolNet: 0,
            pendingTxids: [],
            pendingOutgoingTxids: [],
            pendingTransactions: [],
            utxos: [],
          }
        }
        hasAddressIndex = false
      }

      const localIndexer = ensureLocalIndexer()
      await warmLocalAddressBounded(localIndexer, address)

      const indexedEntries = localIndexer?.history(coin, address) ?? []
      const indexedBalance = localIndexer?.balance(coin, address) ?? null
      const verifiedIndexedBalance = indexedEntries.length > 0
        ? await verifiedAddressBalanceFromLocalIndex(address, indexedEntries).catch((error) => {
          console.warn(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'warn',
            msg: 'local_balance_verify_failed',
            coin,
            address,
            error: error?.message || String(error),
          }))
          return null
        })
        : null
      if (verifiedIndexedBalance?.hasData) {
        const confirmedResult = await withLiveSpendableUtxos(verifiedIndexedBalance.result)
        const liveMempool = await this.getMempool(address).catch(() => null)
        return mergeLiveMempoolPending(confirmedResult, liveMempool?.pending)
      }
      // Some daemons expose the getaddress* RPCs but run with addressindex
      // disabled: the empty-address probe succeeds, yet every real address
      // answers "No information available for address". When the local index
      // proves this address actually has history, the daemon's addressindex is
      // not maintained — demote it so getHistory/getUtxos/getMempool also use
      // the local-index fallback. Otherwise an unconfirmed deposit shows up in
      // the balance (this fallthrough) but never in history until it is mined
      // into a block, so the wallet's balance moves before the tx row appears.
      if (addressIndexReturnedNoInfo && hasAddressIndex && indexedEntries.length > 0) {
        hasAddressIndex = false
      }
      if (indexedEntries.length > 0 && indexedBalance) {
        const indexedUtxos = localIndexer?.unspent(coin, address)
          ?.filter((e) => e.scriptHex)
          ?.map((e) => ({
            txid: e.txid,
            outputIndex: e.vout,
            script: e.scriptHex,
            satoshis: e.sats,
            height: e.height ?? 0,
          })) ?? []
        const pendingIncoming = indexedBalance.pendingIncoming ?? 0
        const pendingOutgoing = indexedBalance.pendingOutgoing ?? 0
        const confirmed = indexedBalance.confirmedSpendable ?? 0
        const mempoolNet = pendingIncoming - pendingOutgoing
        const visibleBalance = Math.max(0, confirmed + mempoolNet)
        return {
          address,
          balance: visibleBalance,
          balance_spendable: Math.max(0, confirmed - pendingOutgoing),
          received: confirmed + pendingIncoming,
          immature: 0,
          pendingIncoming,
          pendingOutgoing,
          mempoolNet,
          pendingTxids: indexedBalance.pendingTxids ?? [],
          pendingOutgoingTxids: indexedBalance.pendingOutgoingTxids ?? [],
          utxos: indexedUtxos,
        }
      }

      // Mid path: vanilla Bitcoin Core scantxoutset gives confirmed UTXOs.
      // Core only permits one active scan, so the adapter serializes scans.
      let confirmedSats = 0
      let scanFromCache = false

      const queuedScanBalance = await scanAddressBalance(address, { force })
      const haveScan = queuedScanBalance.sats !== null && hasScanTxOutSet === true
      if (haveScan) {
        confirmedSats = queuedScanBalance.sats
        scanFromCache = queuedScanBalance.fromCache === true
      }

      // Add mempool deltas (and, for chains without scantxoutset, the entire
      // balance) from our local index.
      let pendingIncoming = 0
      let pendingOutgoing = 0
      let pendingTxids = []
      let pendingOutgoingTxids = []
      let indexedConfirmed = 0
      if (localIndexer) {
        const b = indexedBalance ?? localIndexer.balance(coin, address)
        pendingIncoming = b.pendingIncoming
        pendingOutgoing = b.pendingOutgoing
        pendingTxids = b.pendingTxids ?? []
        pendingOutgoingTxids = b.pendingOutgoingTxids ?? []
        indexedConfirmed = b.confirmedSpendable
      }

      // A fresh scantxoutset result is authoritative. A cached scan is still
      // live-filtered with gettxout, but it can miss a UTXO that confirmed after
      // the cache was written; in that case merge in the local confirmed index.
      const confirmed = haveScan
        ? (scanFromCache ? Math.max(confirmedSats, indexedConfirmed) : confirmedSats)
        : indexedConfirmed
      const mempoolNet = pendingIncoming - pendingOutgoing
      const visibleBalance = Math.max(0, confirmed + mempoolNet)
      return {
        address,
        balance: visibleBalance,
        balance_spendable: Math.max(0, confirmed - pendingOutgoing),
        received: confirmed + pendingIncoming,
        immature: 0,
        pendingIncoming,
        pendingOutgoing,
        mempoolNet,
        pendingTxids,
        pendingOutgoingTxids,
        utxos: queuedScanBalance.utxos ?? [],
      }
    },

    async getUtxos(address, { force = false, fast = false } = {}) {
      const localIndexer = ensureLocalIndexer()
      localIndexer?.watch(coin, address)
      // A daemon address index already represents the current UTXO set. Read
      // it before replaying local transaction history, which is useful only as
      // a fallback and can take seconds for an old, fully-spent wallet.
      if (await probeAddressIndex()) {
        const live = await rpc('getaddressutxos', [{ addresses: [address] }]).catch((error) => {
          if (isNoAddressInfo(error)) return []
          if (isMethodNotFound(error) || isUnsupportedByConfig(error)) return null
          throw error
        })
        if (Array.isArray(live)) return { address, utxos: await filterSpendableUtxos(live.map(mapIndexedUtxo)) }
      }
      const indexedEntries = localIndexer?.unspent(coin, address) ?? []
      const indexedHistory = localIndexer?.history(coin, address) ?? []
      const indexedUtxos = indexedEntries.filter((e) => e.scriptHex).map((e) => ({
        txid: e.txid,
        outputIndex: e.vout,
        script: e.scriptHex,
        satoshis: e.sats,
        height: e.height ?? 0,
      }))
      if (coin === 'neoxa' && indexedUtxos.length > 0) {
        const verifiedGroups = await Promise.all(
          indexedUtxos.map((utxo) => filterSpendableUtxos([utxo])),
        )
        return { address, utxos: verifiedGroups.flat() }
      }
      if (indexedHistory.length > 0) {
        const verifiedIndexedBalance = await verifiedAddressBalanceFromLocalIndex(address, indexedHistory).catch((error) => {
          console.warn(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'warn',
            msg: 'local_utxo_verify_failed',
            coin,
            address,
            error: error?.message || String(error),
          }))
          return null
        })
        if (verifiedIndexedBalance?.hasData) {
          return { address, utxos: await filterSpendableUtxos(verifiedIndexedBalance.result.utxos ?? []) }
        }
      }
      if (!force && indexedUtxos.length > 0) {
        return { address, utxos: await filterSpendableUtxos(indexedUtxos) }
      }

      const cachedScanUtxos = !force ? readScannedUtxos(address) : null
      if (cachedScanUtxos) {
        return { address, utxos: await filterSpendableUtxos(cachedScanUtxos.utxos) }
      }

      // Fast path
      if (await probeAddressIndex()) {
        const addressIndexedUtxos = await rpc('getaddressutxos', [{ addresses: [address] }]).catch((error) => {
          if (isNoAddressInfo(error)) return []
          if (isMethodNotFound(error) || isUnsupportedByConfig(error)) return null
          throw error
        })
        if (Array.isArray(addressIndexedUtxos)) {
          return { address, utxos: await filterSpendableUtxos(addressIndexedUtxos.map(mapIndexedUtxo)) }
        }
        if (fast) return { address, utxos: [] }
        const scannedUtxos = await scanAddressUtxos(address, { force })
        if (Array.isArray(scannedUtxos)) {
          const liveScanned = await filterSpendableUtxos(scannedUtxos)
          if (liveScanned.length === 0 && indexedUtxos.length > 0) {
            return { address, utxos: await filterSpendableUtxos(indexedUtxos) }
          }
          return { address, utxos: liveScanned }
        }
      }

      // Mid path: confirmed UTXOs from the same serialized scantxoutset queue.
      if (fast) return { address, utxos: [] }

      const queuedScanUtxos = await scanAddressUtxos(address, { force })
      if (Array.isArray(queuedScanUtxos)) {
        const liveScanned = await filterSpendableUtxos(queuedScanUtxos)
        if (liveScanned.length > 0 || indexedUtxos.length === 0) {
          return {
            address,
            utxos: liveScanned,
          }
        }
      }
      if (indexedUtxos.length > 0) {
        return { address, utxos: await filterSpendableUtxos(indexedUtxos) }
      }

      // Slow path: build UTXO list from our local index (Pepecoin / old forks)
      if (profile === 'local-index') {
        // A first-use Neoxa address can require a 2,000-block backfill. The
        // wallet must not hold its UTXO request open for that entire scan;
        // keep the serialized warmup in the background and expose the indexed
        // result on a later refresh.
        void warmLocalAddressBounded(localIndexer, address, 0).catch(() => undefined)
        return { address, utxos: [] }
      }
      if (localIndexer?.warmAddress) await localIndexer.warmAddress(coin, address)
      else localIndexer?.watch(coin, address)
      if (!localIndexer) {
        throw new RpcError(`${coin}: no UTXO source available`, { status: 501 })
      }
      const entries = localIndexer.unspent(coin, address)
      return {
        address,
        utxos: await filterSpendableUtxos(entries.filter((e) => e.scriptHex).map((e) => ({
          txid: e.txid,
          outputIndex: e.vout,
          script: e.scriptHex,
          satoshis: e.sats,
          height: e.height ?? 0,
        }))),
      }
    },

    async getHistory(address, { limit = 25, offset = 0, utxoOverlay = false } = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100))
      const safeOffset = Math.max(0, Math.min(Math.floor(Number(offset) || 0), 10_000))

      // Resolve every input's previous-output: address + value. Lets the
      // wallet show real "from" addresses and compute the network fee
      // (sum(inputs) в€’ sum(outputs)). Best-effort, runs in parallel.
      const enrichInputs = async (txs) => {
        const cache = new Map() // prev-txid в†’ raw tx
        const lookup = async (txid) => {
          if (cache.has(txid)) return cache.get(txid)
          try {
            const raw = await getRawTransactionVerbose(txid)
            cache.set(txid, raw)
            return raw
          } catch {
            cache.set(txid, null)
            return null
          }
        }
        const indexedPrevout = (txid, vout) => {
          const localIndexer = ensureLocalIndexer()
          const indexed = localIndexer?.findOutput?.(coin, txid, vout)
          if (!indexed) return null
          return {
            value: Number(indexed.sats || 0) / 1e8,
            scriptPubKey: {
              address: indexed.address,
              addresses: [indexed.address],
              hex: indexed.scriptHex ?? undefined,
            },
          }
        }
        for (const t of txs) {
          if (!t || !Array.isArray(t.vin)) continue
          let inputTotal = 0
          let inputsResolved = 0
          for (const vin of t.vin) {
            if (!vin.txid) { inputTotal = null; break }
            const prev = await lookup(vin.txid)
            const prevVout = prev?.vout?.[vin.vout] ?? indexedPrevout(vin.txid, vin.vout)
            if (!prevVout) { inputTotal = null; continue }
            const val = Number(prevVout.value || 0)
            if (typeof inputTotal === 'number') inputTotal += val
            inputsResolved++
            vin.address =
              prevVout.scriptPubKey?.address ??
              prevVout.scriptPubKey?.addresses?.[0] ??
              vin.address
            vin.value = val
          }
          // Annotate fee in coin-units when every input was resolved.
          if (typeof inputTotal === 'number' && inputsResolved === t.vin.length) {
            const outTotal = (t.vout || []).reduce((s, o) => s + Number(o.value || 0), 0)
            const fee = inputTotal - outTotal
            if (fee > 0) t.fee = fee
          }
        }
      }

      const recentHistoryFromBlocks = async () => {
        if (safeOffset !== 0) return { txids: [], deltas: [], transactions: [] }
        const chain = await rpc('getblockchaininfo')
        const tip = Number(chain.blocks ?? 0)
        if (!Number.isFinite(tip) || tip <= 0) return { txids: [], deltas: [], transactions: [] }

        const addressSet = await buildAddressSet(address)
        const heights = []
        for (let height = tip; height >= Math.max(0, tip - recentHistoryBlocks + 1); height -= 1) {
          heights.push(height)
        }

        const byTxid = new Map()
        let cursor = 0
        const worker = async () => {
          while (cursor < heights.length && byTxid.size < safeLimit * 3) {
            const height = heights[cursor]
            cursor += 1
            const block = await getBlockVerboseByHeight(height).catch(() => null)
            const txs = Array.isArray(block?.tx) ? block.tx : []
            const candidates = txs.filter((tx) =>
              (tx?.vout || []).some((vout) => extractAddresses(vout).some((addr) => addressSet.has(addr))),
            )
            if (candidates.length === 0) continue
            await enrichInputs(candidates)
            for (const tx of candidates) {
              const txid = tx?.txid || tx?.hash
              if (!txid || byTxid.has(txid)) continue
              const ownInputCoin = (tx.vin || []).reduce((sum, vin) =>
                vin.address && addressSet.has(vin.address) ? sum + Number(vin.value || 0) : sum,
              0)
              const ownOutputCoin = (tx.vout || []).reduce((sum, vout) => {
                const addrs = extractAddresses(vout)
                return addrs.some((addr) => addressSet.has(addr)) ? sum + Number(vout.value || 0) : sum
              }, 0)
              const deltaCoin = ownOutputCoin - ownInputCoin
              if (Math.abs(deltaCoin) <= 0) continue
              byTxid.set(txid, {
                txid,
                delta: {
                  txid,
                  satoshis: Math.round(deltaCoin * 1e8),
                  height,
                  timestamp: block?.time ?? tx.time,
                },
                raw: {
                  ...tx,
                  txid,
                  blocktime: tx.blocktime ?? block?.time ?? tx.time,
                  confirmations: Math.max(1, tip - height + 1),
                },
              })
            }
          }
        }
        await Promise.all(Array.from({ length: 4 }, worker))
        const rows = Array.from(byTxid.values())
          .sort((a, b) => (b.delta.height ?? 0) - (a.delta.height ?? 0))
          .slice(0, safeLimit)
        return {
          txids: rows.map((row) => row.txid),
          deltas: rows.map((row) => row.delta),
          transactions: rows.map((row) => row.raw),
        }
      }

      if (await probeAddressIndex()) {
        // Fast path вЂ” daemon has Dash-style address-index RPCs
        const noInfo = Symbol('no-address-info')
        const indexedRead = (method) =>
          rpc(method, [{ addresses: [address] }]).catch((error) => {
            if (isNoAddressInfo(error)) return noInfo
            return []
          })
        const [indexedTxids, indexedDeltas, indexedMempool] = await Promise.all([
          indexedRead('getaddresstxids'),
          indexedRead('getaddressdeltas'),
          indexedRead('getaddressmempool'),
        ])
        const txids = indexedTxids === noInfo ? [] : indexedTxids
        const deltas = indexedDeltas === noInfo ? [] : indexedDeltas
        let mempool = indexedMempool === noInfo ? [] : indexedMempool
        if (mempool.length > 0) {
          const confirmedTxids = new Set((deltas || [])
            .filter((e) => e?.txid && e.height !== null && e.height !== undefined)
            .map((e) => e.txid))
          mempool = mempool.filter((e) => e?.txid && !confirmedTxids.has(e.txid))
          if (mempool.length > 0) {
            try {
              const rawMempool = await rpc('getrawmempool', [])
              const liveMempool = new Set(Array.isArray(rawMempool) ? rawMempool : Object.keys(rawMempool || {}))
              mempool = mempool.filter((e) => liveMempool.has(e.txid))
            } catch {
              mempool = []
            }
          }
        }
        let useLocalIndexHistory = false
        if (
          (indexedTxids === noInfo || indexedDeltas === noInfo)
          && txids.length === 0
          && deltas.length === 0
          && mempool.length === 0
        ) {
          const fallbackIndexer = ensureLocalIndexer()
          const fallbackEntries = fallbackIndexer?.history?.(coin, address) ?? []
          if (fallbackEntries.length > 0) {
            hasAddressIndex = false
            useLocalIndexHistory = true
          } else {
            // RPC -5 is Neoxa's normal empty-history result. Return it
            // immediately and let the persistent index warm in the background
            // instead of blocking the wallet on recent-block/local backfills.
            void warmLocalAddressBounded(fallbackIndexer, address, 0).catch(() => undefined)
            return {
              address,
              txids: [],
              deltas: [],
              mempool: [],
              transactions: [],
            }
          }
        }

        if (!useLocalIndexHistory) {
          const recent = allowsRecentHistoryOverlay
            ? await recentHistoryFromBlocks().catch(() => ({ txids: [], deltas: [], transactions: [] }))
            : { txids: [], deltas: [], transactions: [] }
          const recentRawByTxid = new Map((recent.transactions || []).map((tx) => [tx.txid || tx.hash, tx]))
          const indexedDeltaTxids = new Set((deltas || []).map((entry) => entry?.txid).filter(Boolean))
          const overlayDeltasByTxid = new Map()
          for (const delta of recent.deltas || []) {
            if (delta?.txid && !indexedDeltaTxids.has(delta.txid)) {
              deltas.push(delta)
              txids.push(delta.txid)
              indexedDeltaTxids.add(delta.txid)
            }
          }
          if (safeOffset === 0 && utxoOverlay) {
            const indexedDeltaTxids = new Set((deltas || [])
              .map((entry) => entry?.txid)
              .filter(Boolean))
            const overlayUtxos = await historyOverlayUtxos(address)
            if (Array.isArray(overlayUtxos)) {
              for (const utxo of overlayUtxos) {
                if (!utxo?.txid || indexedDeltaTxids.has(utxo.txid)) continue
                const overlayDelta = {
                  txid: utxo.txid,
                  satoshis: Number(utxo.satoshis || 0),
                  height: utxo.height ?? null,
                  timestamp: null,
                }
                deltas.push(overlayDelta)
                txids.push(utxo.txid)
                indexedDeltaTxids.add(utxo.txid)
                overlayDeltasByTxid.set(utxo.txid, overlayDelta)
              }
            }
          }

          const hasIndexedData = txids.length > 0 || deltas.length > 0 || mempool.length > 0
          if (hasIndexedData) {
            const addressSet = await buildAddressSet(address)
            const orderedSource = [...(deltas || []).slice().reverse(), ...(mempool || []).slice().reverse()]
            const heightByTxid = new Map()
            const timeByTxid = new Map()
            const pendingTxids = new Set()
            for (const e of orderedSource) {
              if (!e?.txid) continue
              if (e.height !== null && e.height !== undefined) heightByTxid.set(e.txid, e.height)
              if (e.time !== null && e.time !== undefined) timeByTxid.set(e.txid, e.time)
              else if (e.timestamp !== null && e.timestamp !== undefined) timeByTxid.set(e.txid, e.timestamp)
              if (e.height === null || e.height === undefined) pendingTxids.add(e.txid)
            }
            const indexedTxidsNewestFirst = (txids || []).slice().reverse().filter(Boolean)
            let orderedTxids = Array.from(new Set([
              ...orderedSource.map((e) => e.txid).filter(Boolean),
              ...indexedTxidsNewestFirst,
            ]))
            const rawRows = []
            for (const txid of orderedTxids.slice(safeOffset, safeOffset + safeLimit * 3)) {
              try {
                rawRows.push(recentRawByTxid.get(txid) ?? await getRawTransactionVerbose(txid, heightByTxid.get(txid) ?? null))
              } catch {
                // Drop unverified address-index rows; a real wallet row must be
                // backed by a raw transaction that touches this address.
              }
            }
            await enrichInputs(rawRows)
            const verifiedTxids = []
            const verifiedDeltas = []
            const verifiedMempool = []
            const verifiedTransactions = []
            for (const tx of rawRows) {
              const txid = tx?.txid || tx?.hash
              if (!txid || verifiedTxids.includes(txid)) continue
              const satoshis = txDeltaSatsForAddressSet(tx, addressSet)
              if (satoshis === 0) continue
              verifiedTxids.push(txid)
              const row = {
                txid,
                satoshis,
                height: heightByTxid.get(txid) ?? tx.height ?? null,
                timestamp: timeByTxid.get(txid) ?? tx.blocktime ?? tx.time ?? null,
              }
              if (pendingTxids.has(txid) || row.height === null || row.height === undefined) {
                verifiedMempool.push(row)
              } else {
                verifiedDeltas.push(row)
              }
              verifiedTransactions.push(tx)
              if (verifiedTransactions.length >= safeLimit) break
            }
            for (const [txid, delta] of overlayDeltasByTxid.entries()) {
              if (verifiedTxids.includes(txid)) continue
              verifiedTxids.push(txid)
              if (delta.height === null || delta.height === undefined) {
                verifiedMempool.push(delta)
              } else {
                verifiedDeltas.push(delta)
              }
              if (verifiedTxids.length >= safeLimit) break
            }
            return {
              address,
              txids: verifiedTxids,
              deltas: verifiedDeltas,
              mempool: verifiedMempool,
              transactions: verifiedTransactions,
            }
          }
        }
      }

      // Vanilla Bitcoin Core fork - assemble history from our own index.
      // The direct recent-block scan is only a fast overlay: it must never
      // replace the persistent local index, otherwise rows can blink while the
      // indexer catches up.
      const recent = allowsRecentHistoryOverlay
        ? await recentHistoryFromBlocks().catch(() => ({ txids: [], deltas: [], transactions: [] }))
        : { txids: [], deltas: [], transactions: [] }
      const recentRawByTxid = new Map((recent.transactions || []).map((tx) => [tx.txid || tx.hash, tx]))
      const recentDeltasByTxid = new Map((recent.deltas || [])
        .filter((delta) => delta?.txid)
        .map((delta) => [delta.txid, delta]))

      const localIndexer = ensureLocalIndexer()
      await warmLocalAddressBounded(localIndexer, address)
      if (!localIndexer) {
        throw new RpcError(`${coin}: address history requires addressindex=1 or local indexer`, { status: 501 })
      }
      let entries = localIndexer.history(coin, address)
      if (recentDeltasByTxid.size > 0) {
        entries = entries.filter((entry) => !recentDeltasByTxid.has(entry.txid))
        for (const delta of recentDeltasByTxid.values()) {
          entries.push({
            txid: delta.txid,
            vout: null,
            sats: Math.abs(Number(delta.satoshis || 0)),
            type: Number(delta.satoshis || 0) < 0 ? 'outgoing' : 'incoming',
            height: delta.height ?? null,
            time: delta.timestamp ?? null,
            scriptHex: null,
          })
        }
      }
      if (coin === 'neoxa') {
        // Neoxa verbose raw-transaction/input lookups are unusually slow.
        // The persistent index already stores the signed per-address deltas,
        // heights and timestamps required by the wallet, so serve that data
        // directly instead of turning history refreshes into RPC timeouts.
        const rowsByTxid = new Map()
        for (const entry of entries) {
          if (!entry?.txid) continue
          const row = rowsByTxid.get(entry.txid) ?? {
            txid: entry.txid,
            satoshis: 0,
            height: entry.height ?? null,
            timestamp: entry.time ?? null,
          }
          row.satoshis += entry.type === 'outgoing' ? -Number(entry.sats || 0) : Number(entry.sats || 0)
          if (row.height === null && entry.height !== null && entry.height !== undefined) row.height = entry.height
          row.timestamp ??= entry.time ?? null
          rowsByTxid.set(entry.txid, row)
        }
        const rows = [...rowsByTxid.values()]
          .sort((a, b) => (b.height ?? Number.MAX_SAFE_INTEGER) - (a.height ?? Number.MAX_SAFE_INTEGER))
          .slice(safeOffset, safeOffset + safeLimit)
        return {
          address,
          txids: rows.map((row) => row.txid),
          deltas: rows.filter((row) => row.height !== null).map((row) => ({ ...row })),
          mempool: rows.filter((row) => row.height === null).map((row) => ({ ...row })),
          transactions: [],
        }
      }
      const pendingTxids = new Set(
        entries
          .filter((e) => e.height === null || e.height === undefined)
          .map((e) => e.txid)
          .filter(Boolean),
      )
      if (pendingTxids.size > 0) {
        try {
          const currentMempool = new Set(await rpc('getrawmempool', []))
          const confirmedPending = new Map()
          for (const txid of pendingTxids) {
            if (currentMempool.has(txid)) continue
            const meta = await getConfirmedTransactionMeta(txid)
            if (meta) confirmedPending.set(txid, meta)
          }
          if (confirmedPending.size > 0) {
            entries = entries.map((e) => {
              const meta = confirmedPending.get(e.txid)
              if (!meta || e.height !== null && e.height !== undefined) return e
              const upgraded = { ...e, height: meta.height, time: meta.time ?? e.time }
              try {
                localIndexer.service?.ensure?.(coin)?.record?.({ address, ...upgraded })
              } catch {
                // The read response can still use the upgraded row.
              }
              return upgraded
            })
            try { localIndexer.service?.ensure?.(coin)?.flushIfDirty?.() } catch {}
          }
        } catch {
          // If mempool cannot be read right now, keep the indexed view unchanged.
        }
      }
      const entryKeys = new Set(entries.map((e) => `${e.txid}:${e.vout ?? -1}:${e.type}`))
      const incomingEntryTxids = new Set(entries
        .filter((entry) => entry?.type === 'incoming' && entry?.txid)
        .map((entry) => entry.txid))
      const shouldOverlayScannedUtxos = safeOffset === 0 && (utxoOverlay || entries.length === 0)
      const scannedUtxos = shouldOverlayScannedUtxos
        ? await scanAddressUtxos(address)
        : null
      if (Array.isArray(scannedUtxos)) {
        for (const utxo of scannedUtxos) {
          if (utxo?.txid && incomingEntryTxids.has(utxo.txid)) continue
          const key = `${utxo.txid}:${utxo.outputIndex ?? -1}:incoming`
          if (entryKeys.has(key)) continue
          const entry = {
            txid: utxo.txid,
            vout: utxo.outputIndex,
            sats: Number(utxo.satoshis || 0),
            type: 'incoming',
            height: utxo.height ?? null,
            time: null,
            scriptHex: utxo.script ?? null,
          }
          entries.push(entry)
          entryKeys.add(key)
          incomingEntryTxids.add(entry.txid)
          try {
            localIndexer.service?.ensure?.(coin)?.record?.({ address, ...entry })
          } catch {
            // Best-effort cache warmup only; the response can still use `entries`.
          }
        }
        try { localIndexer.service?.ensure?.(coin)?.flushIfDirty?.() } catch {}
      }
      // Group entries by txid в†’ emit deltas + mempool in the shape the wallet
      // already understands.
      const deltas = []
      const mempool = []
      const txids = []
      const transactions = []
      const seenTx = new Set()
      // Newest first (by height desc, mempool last seen wins)
      const sorted = [...entries].sort((a, b) => {
        const ha = a.height ?? Number.MAX_SAFE_INTEGER
        const hb = b.height ?? Number.MAX_SAFE_INTEGER
        return hb - ha
      })
      for (const e of sorted) {
        const sats = e.type === 'outgoing' ? -e.sats : e.sats
        const row = { txid: e.txid, satoshis: sats, height: e.height, timestamp: e.time }
        if (e.height === null || e.height === undefined) {
          mempool.push(row)
        } else {
          deltas.push(row)
        }
        if (!seenTx.has(e.txid)) {
          seenTx.add(e.txid)
          if (seenTx.size <= safeOffset) continue
          txids.push(e.txid)
          try {
            transactions.push(recentRawByTxid.get(e.txid) ?? await getRawTransactionVerbose(e.txid, e.height))
          } catch (err) {
            transactions.push({ txid: e.txid, error: err.message })
          }
          if (transactions.length >= safeLimit) break
        }
      }
      await enrichInputs(transactions)
      return { address, txids, deltas, mempool, transactions }
    },

    async getMempool(address) {
      if (coin === 'neoxa' && profile === 'local-index') {
        const localIndexer = ensureLocalIndexer()
        localIndexer?.watch?.(coin, address)
        const entries = localIndexer?.history?.(coin, address) ?? []
        const pendingByTxid = new Map()
        for (const entry of entries) {
          if (!entry?.txid || entry.height !== null && entry.height !== undefined) continue
          const row = pendingByTxid.get(entry.txid) ?? { satoshis: 0, firstSeen: entry.time ?? Math.floor(Date.now() / 1000) }
          row.satoshis += entry.type === 'outgoing' ? -Number(entry.sats || 0) : Number(entry.sats || 0)
          row.firstSeen ??= entry.time ?? Math.floor(Date.now() / 1000)
          pendingByTxid.set(entry.txid, row)
        }
        const pending = [...pendingByTxid.entries()].map(([txid, row]) => ({
          txid,
          type: row.satoshis < 0 ? 'outgoing' : 'incoming',
          amount: (Math.abs(row.satoshis) / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0',
          firstSeen: row.firstSeen,
          confirmations: 0,
        }))
        return {
          address,
          hasPendingOutgoing: pending.some((row) => row.type === 'outgoing'),
          pending,
        }
      }
      const addressSet = await buildAddressSet(address)
      if (await probeAddressIndex()) {
        const indexed = await rpc('getaddressmempool', [{ addresses: [address] }]).catch((error) => {
          if (isNoAddressInfo(error)) return []
          throw error
        })
        let liveMempool = null
        if (Array.isArray(indexed) && indexed.length > 0) {
          try {
            liveMempool = await liveMempoolTxids()
          } catch {
            liveMempool = new Set()
          }
        }
        const indexedTxids = Array.from(new Set((Array.isArray(indexed) ? indexed : [])
          .map((entry) => entry?.txid)
          .filter((txid) => txid && (!liveMempool || liveMempool.has(txid)))))
        if (indexedTxids.length > 0) {

        const pending = []
        for (const txid of indexedTxids.slice(0, 100)) {
          let tx
          try {
            tx = await rpc('getrawtransaction', [txid, true])
          } catch {
            continue
          }
          await enrichInputs([tx])
          const ownInputs = (tx.vin || []).filter((vin) => vin.address && addressSet.has(vin.address))
          const ownOutputCoin = (tx.vout || []).reduce((sum, vout) => {
            const addrs = extractAddresses(vout)
            return addrs.some((a) => addressSet.has(a)) ? sum + Number(vout.value || 0) : sum
          }, 0)
          if (ownInputs.length === 0) {
            if (ownOutputCoin <= 0) continue
            pending.push({
              txid: tx.txid || txid,
              type: 'incoming',
              amount: ownOutputCoin.toFixed(8).replace(/\.?0+$/, '') || '0',
              from: (tx.vin || []).map((vin) => vin.address).find((a) => a && !addressSet.has(a)),
              to: address,
              firstSeen: tx.time ?? Math.floor(Date.now() / 1000),
              confirmations: 0,
            })
            continue
          }

          const inputCoin = ownInputs.reduce((sum, vin) => sum + Number(vin.value || 0), 0)
          const outputToOthersCoin = (tx.vout || []).reduce((sum, vout) => {
            const addrs = extractAddresses(vout)
            return addrs.length > 0 && !addrs.some((a) => addressSet.has(a)) ? sum + Number(vout.value || 0) : sum
          }, 0)
          const totalOutputCoin = (tx.vout || []).reduce((sum, vout) => sum + Number(vout.value || 0), 0)
          const totalInputCoin = (tx.vin || []).reduce((sum, vin) => sum + Number(vin.value || 0), 0)
          const feeCoin = typeof tx.fee === 'number' && tx.fee > 0 ? tx.fee : Math.max(0, totalInputCoin - totalOutputCoin)
          const netSpentCoin = Math.max(0, inputCoin - ownOutputCoin)
          const amountCoin = outputToOthersCoin > 0 ? outputToOthersCoin : netSpentCoin
          pending.push({
            txid: tx.txid || txid,
            type: 'outgoing',
            amount: amountCoin.toFixed(8).replace(/\.?0+$/, '') || '0',
            fee: feeCoin > 0 ? feeCoin.toFixed(8).replace(/\.?0+$/, '') : undefined,
            from: address,
            to: (tx.vout || []).map(firstOutputAddress).find((a) => a && !addressSet.has(a)),
            firstSeen: tx.time ?? Math.floor(Date.now() / 1000),
            confirmations: 0,
          })
        }

        return {
          address,
          hasPendingOutgoing: pending.length > 0,
          pending,
        }
        }
      }

      let verbose = {}
      let txids = []
      try {
        verbose = await rpc('getrawmempool', [true])
        txids = Array.isArray(verbose) ? verbose : Object.keys(verbose || {})
      } catch {
        txids = await rpc('getrawmempool', [])
      }

      const pending = []
      for (const txid of txids) {
        let tx
        try {
          tx = await rpc('getrawtransaction', [txid, true])
        } catch {
          continue
        }
        await enrichInputs([tx])
        const ownInputs = (tx.vin || []).filter((vin) => vin.address && addressSet.has(vin.address))
        const ownOutputCoin = (tx.vout || []).reduce((sum, vout) => {
          const addrs = extractAddresses(vout)
          return addrs.some((a) => addressSet.has(a)) ? sum + Number(vout.value || 0) : sum
        }, 0)
        if (ownInputs.length === 0) {
          if (ownOutputCoin <= 0) continue
          pending.push({
            txid: tx.txid || txid,
            type: 'incoming',
            amount: ownOutputCoin.toFixed(8).replace(/\.?0+$/, '') || '0',
            from: (tx.vin || []).map((vin) => vin.address).find((a) => a && !addressSet.has(a)),
            to: address,
            firstSeen: verbose?.[txid]?.time ?? tx.time ?? Math.floor(Date.now() / 1000),
            confirmations: 0,
          })
          continue
        }

        const inputCoin = ownInputs.reduce((sum, vin) => sum + Number(vin.value || 0), 0)
        const outputToOthersCoin = (tx.vout || []).reduce((sum, vout) => {
          const addrs = extractAddresses(vout)
          return addrs.length > 0 && !addrs.some((a) => addressSet.has(a)) ? sum + Number(vout.value || 0) : sum
        }, 0)
        const totalOutputCoin = (tx.vout || []).reduce((sum, vout) => sum + Number(vout.value || 0), 0)
        const totalInputCoin = (tx.vin || []).reduce((sum, vin) => sum + Number(vin.value || 0), 0)
        const feeCoin = typeof tx.fee === 'number' && tx.fee > 0 ? tx.fee : Math.max(0, totalInputCoin - totalOutputCoin)
        const netSpentCoin = Math.max(0, inputCoin - ownOutputCoin)
        const amountCoin = outputToOthersCoin > 0 ? outputToOthersCoin : netSpentCoin
        pending.push({
          txid: tx.txid || txid,
          type: 'outgoing',
          amount: amountCoin.toFixed(8).replace(/\.?0+$/, '') || '0',
          fee: feeCoin > 0 ? feeCoin.toFixed(8).replace(/\.?0+$/, '') : undefined,
          from: address,
          to: (tx.vout || []).map(firstOutputAddress).find((a) => a && !addressSet.has(a)),
          firstSeen: verbose?.[txid]?.time ?? tx.time ?? Math.floor(Date.now() / 1000),
          confirmations: 0,
        })
      }

      return {
        address,
        hasPendingOutgoing: pending.length > 0,
        pending,
      }
    },

    async broadcastTx(hex) {
      if (typeof hex !== 'string' || hex.trim().length === 0) {
        throw new RpcError('hex is required', { status: 400 })
      }
      const normalized = hex.trim()
      await assertRelayFee(normalized)
      const txid = await rpc('sendrawtransaction', [normalized])
      scannedUtxoCache.clear()
      return { txid }
    },

    async validateAddress(address) {
      const result = await rpc('validateaddress', [address])
      return { address, ...result }
    },

    async estimateFee(targetBlocks = 6) {
      const blocks = Math.max(2, Math.min(Number(targetBlocks) || 6, 25))
      let estimate = -1
      let source = 'none'

      // Try estimatesmartfee first (modern Bitcoin Core)
      try {
        const smart = await rpc('estimatesmartfee', [blocks])
        if (smart && typeof smart.feerate === 'number' && smart.feerate > 0) {
          estimate = smart.feerate
          source = 'smart'
        }
      } catch (error) {
        if (!isMethodNotFound(error)) throw error
      }
      // Fallback: legacy estimatefee
      if (estimate < 0) {
        const legacy = await rpc('estimatefee', [blocks]).catch(() => -1)
        if (typeof legacy === 'number' && legacy > 0) {
          estimate = legacy
          source = 'legacy'
        }
      }

      // Floor: never go below the chain's own min relay fee, otherwise the tx
      // will be rejected (Pepecoin = 0.001 PEPE/kB,
      // Bitcoin-likes = 0.00001/kB).
      let relayFee = 0
      try {
        const net = await rpc('getnetworkinfo', [])
        if (typeof net.relayfee === 'number' && net.relayfee > 0) relayFee = net.relayfee
      } catch {
        /* keep 0 */
      }

      const feerate = Math.max(estimate > 0 ? estimate : relayFee, relayFee)
      return {
        coin,
        targetBlocks: blocks,
        feerate: feerate > 0 ? feerate : 0.00001,
        relayFee,
        source: source !== 'none' ? source : 'relay-floor',
      }
    },
  }
}

module.exports = { createBitcoinForkAdapter }
