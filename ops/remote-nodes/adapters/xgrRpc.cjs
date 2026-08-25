'use strict'

const { RpcError, httpRequest } = require('../lib/rpc.cjs')

const WEI_PER_XGR = 1_000_000_000_000_000_000n
const WEI_PER_BASE = 10_000_000_000n
const XGR_CHAIN_ID = 1643
const DEFAULT_GAS_LIMIT = 21_000n
const DEFAULT_BASE_FEE = 1_000_000_000_000n
const MIN_PRIORITY_FEE = 1_000_000_000n
const LOCAL_PENDING_TTL_MS = 30 * 60_000

const normalizeAddress = (value) => String(value || '').trim()
const lower = (value) => normalizeAddress(value).toLowerCase()
const isHexAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(normalizeAddress(value))
const isRawTransaction = (value) => /^0x[0-9a-fA-F]+$/.test(String(value || ''))

const asBigInt = (value, fallback = 0n) => {
  try {
    if (value === null || value === undefined || value === '') return fallback
    return BigInt(String(value))
  } catch {
    return fallback
  }
}

const asNumber = (value, fallback = 0) => {
  const parsed = Number(asBigInt(value, BigInt(fallback)))
  return Number.isFinite(parsed) ? parsed : fallback
}

const weiToBaseFloor = (wei) => (wei / WEI_PER_BASE).toString()
const weiToBaseCeil = (wei) => (wei === 0n ? 0n : (wei + WEI_PER_BASE - 1n) / WEI_PER_BASE).toString()

const formatWei = (wei, decimals = 18) => {
  const value = asBigInt(wei)
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / WEI_PER_XGR
  const fraction = (absolute % WEI_PER_XGR)
    .toString()
    .padStart(18, '0')
    .slice(0, decimals)
    .replace(/0+$/, '')
  const text = fraction ? `${whole}.${fraction}` : whole.toString()
  return negative ? `-${text}` : text
}

const formatWeiCeil = (wei, decimals = 8) => {
  const factor = 10n ** BigInt(18 - decimals)
  const value = asBigInt(wei)
  const rounded = value === 0n ? 0n : ((value + factor - 1n) / factor) * factor
  return formatWei(rounded, decimals)
}

const withTimeout = (promise, timeoutMs, fallback) =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ])

const mapLimit = async (items, concurrency, mapper) => {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

const createXgrRpcAdapter = ({
  coin = 'xgr',
  rpcUrl = 'https://rpc.xgr.network',
  explorerBaseUrl = 'https://explorer.xgr.network',
  feeRpcTimeoutMs = 4_000,
  gasEstimateTimeoutMs = 4_000,
  nonceRpcTimeoutMs = 12_000,
} = {}) => {
  const rpcTarget = new URL(rpcUrl)
  const explorerBase = String(explorerBaseUrl).replace(/\/+$/, '')
  const localPending = new Map()
  let rpcId = 0

  const parseHttpJson = (status, body, label) => {
    let parsed
    try {
      parsed = body ? JSON.parse(body) : {}
    } catch {
      throw new RpcError(`Non-JSON ${label} response (${status})`, { status: 502 })
    }
    if (status >= 400) {
      throw new RpcError(parsed.error || parsed.message || `${label} HTTP ${status}`, {
        status: status === 404 ? 404 : 502,
      })
    }
    return parsed
  }

  const rpc = async (method, params = []) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    const { status, body } = await httpRequest(rpcTarget, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      body: payload,
      timeoutMs: 25_000,
    })
    const parsed = parseHttpJson(status, body, 'XGR RPC')
    if (parsed.error) {
      throw new RpcError(parsed.error.message || `XGR RPC ${method} failed`, {
        code: parsed.error.code,
        status: status >= 400 ? status : 502,
      })
    }
    return parsed.result
  }

  const explorerGet = async (route) => {
    const url = new URL(`${explorerBase}${route}`)
    const { status, body } = await httpRequest(url, {
      headers: { Accept: 'application/json' },
      timeoutMs: 20_000,
    })
    return parseHttpJson(status, body, 'XGR Explorer')
  }

  const activePending = (address) => {
    const own = lower(address)
    const now = Date.now()
    const rows = []
    for (const [txid, item] of localPending) {
      if (now - item.createdAt > LOCAL_PENDING_TTL_MS) {
        localPending.delete(txid)
        continue
      }
      if (lower(item.from) === own || lower(item.to) === own) rows.push(item)
    }
    return rows
  }

  const reconcilePending = async (address) => {
    const pending = activePending(address)
    await Promise.all(pending.map(async (item) => {
      const receipt = await withTimeout(rpc('eth_getTransactionReceipt', [item.txid]), 4_000, null)
      if (receipt?.blockNumber) localPending.delete(item.txid)
    }))
  }

  const rememberPending = (txid, tx) => {
    if (!txid || !tx) return
    const gasLimit = asBigInt(tx.gas)
    const gasPrice = asBigInt(tx.maxFeePerGas ?? tx.gasPrice)
    localPending.set(lower(txid), {
      txid,
      from: normalizeAddress(tx.from),
      to: normalizeAddress(tx.to),
      amountWei: asBigInt(tx.value),
      feeWei: gasLimit * gasPrice,
      createdAt: Date.now(),
    })
  }

  const pendingRecord = (item, address) => {
    const own = lower(address)
    const fromOwn = lower(item.from) === own
    const toOwn = lower(item.to) === own
    const internal = fromOwn && toOwn
    const deltaWei = internal
      ? -item.feeWei
      : fromOwn
        ? -(item.amountWei + item.feeWei)
        : item.amountWei
    const timestamp = Math.floor(item.createdAt / 1000)
    return {
      txid: item.txid,
      delta: { txid: item.txid, satoshis: weiToBaseFloor(deltaWei), timestamp },
      raw: {
        txid: item.txid,
        hash: item.txid,
        vin: [{ address: item.from, value: formatWei(item.amountWei + (fromOwn ? item.feeWei : 0n)) }],
        vout: [{ value: formatWei(item.amountWei), n: 0, scriptPubKey: { address: item.to, addresses: item.to ? [item.to] : [] } }],
        time: timestamp,
        blocktime: timestamp,
        confirmations: 0,
        fee: formatWei(item.feeWei),
      },
    }
  }

  const transactionRecord = async (summary, address, tipHeight) => {
    const txid = String(summary?.hash ?? summary?.transactionHash ?? '').trim()
    if (!/^0x[0-9a-f]{64}$/i.test(txid)) return null
    const [rpcTx, receipt] = await Promise.all([
      withTimeout(rpc('eth_getTransactionByHash', [txid]), 6_000, null),
      withTimeout(rpc('eth_getTransactionReceipt', [txid]), 6_000, null),
    ])
    const tx = rpcTx ?? summary
    const from = normalizeAddress(tx.from ?? summary.fromAddress)
    const to = normalizeAddress(tx.to ?? summary.toAddress)
    const own = lower(address)
    const fromOwn = lower(from) === own
    const toOwn = lower(to) === own
    if (!fromOwn && !toOwn) return null

    const valueWei = asBigInt(tx.value ?? summary.value)
    const gasUsed = asBigInt(receipt?.gasUsed)
    const effectiveGasPrice = asBigInt(receipt?.effectiveGasPrice ?? tx.gasPrice)
    const feeWei = gasUsed * effectiveGasPrice
    const failed = receipt?.status === '0x0' || receipt?.status === 0
    const internal = fromOwn && toOwn
    const deltaWei = internal
      ? -feeWei
      : fromOwn
        ? -(failed ? feeWei : valueWei + feeWei)
        : valueWei
    const blockHeight = asNumber(receipt?.blockNumber ?? tx.blockNumber ?? summary.blockNumber)
    const confirmations = blockHeight > 0 && tipHeight >= blockHeight
      ? Math.max(1, tipHeight - blockHeight + 1)
      : 0
    const timestamp = asNumber(summary.timestamp, Math.floor(Date.now() / 1000))

    return {
      txid,
      delta: {
        txid,
        satoshis: weiToBaseFloor(deltaWei),
        height: blockHeight || undefined,
        timestamp,
      },
      raw: {
        txid,
        hash: txid,
        status: failed ? 'failed' : undefined,
        vin: [{ address: from, value: formatWei(fromOwn ? valueWei + feeWei : valueWei) }],
        vout: [{ value: formatWei(valueWei), n: 0, scriptPubKey: { address: to, addresses: to ? [to] : [] } }],
        blocktime: timestamp,
        confirmations,
        fee: formatWei(feeWei),
      },
    }
  }

  const feeContext = async (call = {}) => {
    const [chainIdRaw, latestBlock, priorityRaw] = await Promise.all([
      withTimeout(rpc('eth_chainId'), feeRpcTimeoutMs, `0x${XGR_CHAIN_ID.toString(16)}`),
      withTimeout(rpc('eth_getBlockByNumber', ['latest', false]), feeRpcTimeoutMs, null),
      withTimeout(rpc('eth_maxPriorityFeePerGas'), feeRpcTimeoutMs, null),
    ])
    const chainId = asNumber(chainIdRaw)
    if (chainId !== XGR_CHAIN_ID) throw new RpcError(`Unexpected XGR chain id: ${chainId}`, { status: 502 })
    const baseFee = asBigInt(latestBlock?.baseFeePerGas, DEFAULT_BASE_FEE)
    const suggestedPriority = asBigInt(priorityRaw)
    const priorityFee = suggestedPriority > MIN_PRIORITY_FEE ? suggestedPriority : MIN_PRIORITY_FEE
    const maxFeePerGas = (baseFee * 2n) + priorityFee
    let gasLimit = DEFAULT_GAS_LIMIT
    if (call.from && call.to) {
      const estimate = await withTimeout(rpc('eth_estimateGas', [{
        from: call.from,
        to: call.to,
        value: call.value || '0x1',
        data: '0x',
      }]), gasEstimateTimeoutMs, null)
      const estimated = asBigInt(estimate)
      if (estimated > gasLimit) gasLimit = estimated
    }
    const feeWei = maxFeePerGas * gasLimit
    return {
      coin,
      chainId,
      gasPrice: maxFeePerGas.toString(),
      gasPriceHex: `0x${maxFeePerGas.toString(16)}`,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: priorityFee.toString(),
      transactionType: 'eip1559',
      gasLimit: gasLimit.toString(),
      fee: formatWeiCeil(feeWei, 8),
      feeSatoshis: Number(weiToBaseCeil(feeWei)),
      feerate: Number(formatWei(feeWei)),
      relayFee: Number(formatWei(feeWei)),
      source: latestBlock ? 'xgr-rpc' : 'xgr-safe-fallback',
    }
  }

  return {
    coin,
    preserveAtomicBalances: true,
    balanceIncludesMempool: true,

    async getNetwork() {
      const [chainIdRaw, blockRaw, syncing] = await Promise.all([
        rpc('eth_chainId'),
        rpc('eth_blockNumber'),
        rpc('eth_syncing').catch(() => false),
      ])
      const chainId = asNumber(chainIdRaw)
      const blocks = asNumber(blockRaw)
      const syncingNow = Boolean(syncing && syncing !== false)
      const headers = syncingNow ? asNumber(syncing.highestBlock, blocks) : blocks
      return {
        coin,
        chain: 'xgr-mainnet',
        chainId,
        blocks,
        headers,
        initialBlockDownload: syncingNow,
        verificationProgress: headers > 0 ? Math.min(1, blocks / headers) : 1,
        connections: 1,
      }
    },

    async validateAddress(address) {
      return { isvalid: isHexAddress(address), address: normalizeAddress(address) }
    },

    async getBalance(address) {
      const normalized = normalizeAddress(address)
      if (!isHexAddress(normalized)) throw new RpcError('invalid XGR address', { status: 400 })
      await reconcilePending(normalized)
      const [latestRaw, pendingRaw] = await Promise.all([
        rpc('eth_getBalance', [normalized, 'latest']),
        rpc('eth_getBalance', [normalized, 'pending']).catch(() => null),
      ])
      const latestWei = asBigInt(latestRaw)
      const visibleWei = pendingRaw === null ? latestWei : asBigInt(pendingRaw)
      const pending = activePending(normalized)
      const outgoing = pending.filter((item) => lower(item.from) === lower(normalized))
      const incoming = pending.filter((item) => lower(item.to) === lower(normalized) && lower(item.from) !== lower(normalized))
      const pendingOutgoingWei = outgoing.reduce((sum, item) => sum + item.amountWei + item.feeWei, 0n)
      const pendingIncomingWei = incoming.reduce((sum, item) => sum + item.amountWei, 0n)
      const balance = weiToBaseFloor(visibleWei)
      return {
        address: normalized,
        balance,
        balance_spendable: balance,
        received: '0',
        immature: '0',
        pendingIncoming: weiToBaseFloor(pendingIncomingWei),
        pendingOutgoing: weiToBaseCeil(pendingOutgoingWei),
        mempoolNet: weiToBaseFloor(pendingIncomingWei - pendingOutgoingWei),
        pendingTxids: incoming.map((item) => item.txid),
        pendingOutgoingTxids: outgoing.map((item) => item.txid),
        pendingTransactions: pending.map((item) => ({
          txid: item.txid,
          type: lower(item.from) === lower(normalized) ? 'outgoing' : 'incoming',
          amount: formatWei(item.amountWei),
          fee: item.feeWei > 0n ? formatWei(item.feeWei) : undefined,
          from: item.from,
          to: item.to,
          firstSeen: Math.floor(item.createdAt / 1000),
          confirmations: 0,
        })),
      }
    },

    async getUtxos() {
      return { utxos: [] }
    },

    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      const normalized = normalizeAddress(address)
      if (!isHexAddress(normalized)) throw new RpcError('invalid XGR address', { status: 400 })
      await reconcilePending(normalized)
      const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100))
      const safeOffset = Math.max(0, Math.floor(Number(offset) || 0))
      const page = Math.floor(safeOffset / safeLimit) + 1
      const pageOffset = safeOffset % safeLimit
      const [summariesRaw, tipRaw] = await Promise.all([
        explorerGet(`/api/address/${encodeURIComponent(normalized)}/transactions?page=${page}&limit=${safeLimit + pageOffset}`).catch((error) => {
          if (error?.status === 404) return []
          throw error
        }),
        rpc('eth_blockNumber'),
      ])
      const summaries = (Array.isArray(summariesRaw) ? summariesRaw : summariesRaw.transactions ?? [])
        .slice(pageOffset, pageOffset + safeLimit)
      const tipHeight = asNumber(tipRaw)
      const confirmedRows = (await mapLimit(
        summaries,
        6,
        (summary) => transactionRecord(summary, normalized, tipHeight),
      )).filter(Boolean)
      const confirmedIds = new Set(confirmedRows.map((item) => lower(item.txid)))
      for (const txid of confirmedIds) localPending.delete(txid)
      const pendingRows = safeOffset === 0
        ? activePending(normalized).filter((item) => !confirmedIds.has(lower(item.txid))).map((item) => pendingRecord(item, normalized))
        : []
      const rows = [...pendingRows, ...confirmedRows]
      return {
        address: normalized,
        txids: rows.map((item) => item.txid),
        deltas: confirmedRows.map((item) => item.delta),
        mempool: pendingRows.map((item) => item.delta),
        transactions: rows.map((item) => item.raw),
      }
    },

    async getMempool(address) {
      const normalized = normalizeAddress(address)
      if (!isHexAddress(normalized)) throw new RpcError('invalid XGR address', { status: 400 })
      await reconcilePending(normalized)
      const pending = activePending(normalized).map((item) => ({
        txid: item.txid,
        type: lower(item.from) === lower(normalized) ? 'outgoing' : 'incoming',
        amount: formatWei(item.amountWei),
        fee: item.feeWei > 0n ? formatWei(item.feeWei) : undefined,
        from: item.from,
        to: item.to,
        firstSeen: Math.floor(item.createdAt / 1000),
        confirmations: 0,
      }))
      return {
        address: normalized,
        hasPendingOutgoing: pending.some((item) => item.type === 'outgoing'),
        pending,
      }
    },

    async estimateFee() {
      return feeContext()
    },

    async getAccountTxContext({ from, to, value } = {}) {
      const normalizedFrom = normalizeAddress(from)
      const normalizedTo = to ? normalizeAddress(to) : undefined
      if (!isHexAddress(normalizedFrom)) throw new RpcError('invalid XGR from address', { status: 400 })
      if (normalizedTo && !isHexAddress(normalizedTo)) throw new RpcError('invalid XGR recipient address', { status: 400 })
      const [fee, nonceRaw] = await Promise.all([
        feeContext({ from: normalizedFrom, to: normalizedTo, value }),
        withTimeout(rpc('eth_getTransactionCount', [normalizedFrom, 'pending']), nonceRpcTimeoutMs, null),
      ])
      if (nonceRaw === null || nonceRaw === undefined) {
        throw new RpcError('XGR nonce request timed out', { status: 504 })
      }
      return {
        ...fee,
        from: normalizedFrom,
        to: normalizedTo,
        nonce: asNumber(nonceRaw),
      }
    },

    async broadcastTx(hex) {
      if (!isRawTransaction(hex)) throw new RpcError('invalid XGR signed transaction', { status: 400 })
      const txid = String(await rpc('eth_sendRawTransaction', [hex])).trim()
      if (!/^0x[0-9a-f]{64}$/i.test(txid)) throw new RpcError('XGR node returned no valid transaction hash', { status: 502 })
      const pending = await withTimeout(rpc('eth_getTransactionByHash', [txid]), 5_000, null)
      rememberPending(txid, pending)
      return { txid, result: { txid } }
    },
  }
}

module.exports = { createXgrRpcAdapter }
