'use strict'

const crypto = require('node:crypto')
const { RpcError, httpRequest } = require('../lib/rpc.cjs')
const { createBitcoinForkAdapter } = require('./bitcoinFork.cjs')

const SATS_PER_COIN = 100_000_000
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_CONST = 1
const BECH32M_CONST = 0x2bc830a3

const trimSlash = (value) => String(value || '').replace(/\/+$/, '')
const coinFromSats = (value) => Number(value || 0) / SATS_PER_COIN
const satsNumber = (value) => Number(value || 0)
const coinTextToSats = (value) => {
  const normalized = String(value ?? '').trim()
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('invalid coin amount')
  const [whole = '0', fraction = ''] = normalized.split('.')
  const satoshis = BigInt(whole) * BigInt(SATS_PER_COIN)
    + BigInt((fraction + '00000000').slice(0, 8))
  if (satoshis > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('coin amount exceeds safe integer range')
  return Number(satoshis)
}
const safeInt = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest()

const base58Decode = (text) => {
  let value = 0n
  for (const char of text) {
    const digit = BASE58.indexOf(char)
    if (digit < 0) return null
    value = value * 58n + BigInt(digit)
  }

  const bytes = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  for (const char of text) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  return Buffer.from(bytes)
}

const isValidBase58Check = (address, prefixes) => {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false
  const decoded = base58Decode(address)
  if (!decoded || decoded.length < 5) return false
  const payload = decoded.subarray(0, -4)
  const checksum = decoded.subarray(-4)
  const expected = sha256(sha256(payload)).subarray(0, 4)
  if (!checksum.equals(expected)) return false
  return prefixes.includes(payload[0])
}

const outputAddresses = (output) =>
  Array.isArray(output?.addresses)
    ? output.addresses.filter(Boolean)
    : (output?.address ? [output.address] : [])

const inputAddresses = (input) =>
  Array.isArray(input?.addresses)
    ? input.addresses.filter(Boolean)
    : (input?.address ? [input.address] : [])

const hasAddress = (items, address) => items.some((item) => item === address)

const bech32HrpExpand = (hrp) => [
  ...Array.from(hrp, (char) => char.charCodeAt(0) >> 5),
  0,
  ...Array.from(hrp, (char) => char.charCodeAt(0) & 31),
]

const bech32Polymod = (values) => {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0
    for (let i = 0; i < 5; i += 1) {
      if (((top >>> i) & 1) !== 0) checksum = (checksum ^ generators[i]) >>> 0
    }
  }
  return checksum >>> 0
}

const convertBits = (values, fromBits, toBits, pad) => {
  let acc = 0
  let bits = 0
  const out = []
  const maxv = (1 << toBits) - 1
  for (const value of values) {
    if (value < 0 || (value >> fromBits) !== 0) return null
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      out.push((acc >> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv)
  } else if (bits >= fromBits || (((acc << (toBits - bits)) & maxv) !== 0)) {
    return null
  }
  return out
}

const isValidBech32 = (address, hrp) => {
  if (!hrp) return false
  const text = String(address || '')
  const lower = text.toLowerCase()
  const upper = text.toUpperCase()
  if (text !== lower && text !== upper) return false

  const value = lower
  const separator = value.lastIndexOf('1')
  if (separator <= 0 || separator + 7 > value.length) return false
  const normalizedHrp = String(hrp).toLowerCase()
  if (value.slice(0, separator) !== normalizedHrp) return false

  const data = []
  for (let i = separator + 1; i < value.length; i += 1) {
    const digit = BECH32.indexOf(value[i])
    if (digit < 0) return false
    data.push(digit)
  }

  const checksum = bech32Polymod([...bech32HrpExpand(normalizedHrp), ...data])
  if (checksum !== BECH32_CONST && checksum !== BECH32M_CONST) return false

  const payload = data.slice(0, -6)
  if (payload.length === 0 || payload[0] < 0 || payload[0] > 16) return false
  const witnessVersion = payload[0]
  const program = convertBits(payload.slice(1), 5, 8, false)
  if (!program || (program.length !== 20 && program.length !== 32)) return false
  if (witnessVersion === 0 && checksum !== BECH32_CONST) return false
  if (witnessVersion > 0 && checksum !== BECH32M_CONST) return false
  if (witnessVersion === 1 && program.length !== 32) return false
  return true
}

const mapTx = (tx) => ({
  txid: tx.txid,
  hash: tx.hash,
  vin: (tx.vin || []).map((input) => ({
    txid: input.txid,
    vout: input.vout,
    sequence: input.sequence,
    address: inputAddresses(input)[0],
    value: coinFromSats(input.value),
    coinbase: input.coinbase,
  })),
  vout: (tx.vout || []).map((output) => {
    const addresses = outputAddresses(output)
    return {
      value: coinFromSats(output.value),
      n: output.n,
      scriptPubKey: {
        address: addresses[0],
        addresses,
        hex: output.hex,
      },
    }
  }),
  blocktime: tx.blockTime,
  time: tx.blockTime ?? tx.firstSeen,
  confirmations: safeInt(tx.confirmations, 0),
  fee: coinFromSats(tx.fees),
  size: tx.size,
})

const txDeltaForAddress = (tx, address) => {
  const inputSats = (tx.vin || []).reduce(
    (sum, input) => sum + (hasAddress(inputAddresses(input), address) ? satsNumber(input.value) : 0),
    0,
  )
  const outputSats = (tx.vout || []).reduce(
    (sum, output) => sum + (hasAddress(outputAddresses(output), address) ? satsNumber(output.value) : 0),
    0,
  )
  return outputSats - inputSats
}

const createBlockbookAdapter = ({
  coin,
  baseUrl,
  addressPrefixes = [],
  bech32Hrp,
  relayFee = 0.00001,
  timeoutMs = 30_000,
  rpcUrl,
  rpcUser,
  rpcPassword,
  indexer,
}) => {
  if (!coin) throw new Error('blockbook adapter: missing `coin`')
  if (!baseUrl) throw new Error(`blockbook adapter (${coin}): missing baseUrl`)

  const apiBase = trimSlash(baseUrl)
  const txCache = new Map()
  let blockbookUnavailableUntil = 0
  const blockbookRetryDelayMs = 30_000
  const localAdapter = rpcUrl && rpcUser && rpcPassword
    ? createBitcoinForkAdapter({
        coin,
        rpcUrl,
        rpcUser,
        rpcPassword,
        // Neoxa's pruned daemon must never run a full UTXO scan from a live
        // wallet request. The local adapter is used for network, mempool,
        // validation and broadcast; confirmed address data stays indexed by
        // Blockbook.
        readProfile: 'local-index',
        indexer,
      })
    : null

  const request = async (path, { method = 'GET', body, timeout = timeoutMs } = {}) => {
    if (Date.now() < blockbookUnavailableUntil) {
      throw new RpcError(`Blockbook is temporarily unavailable for ${coin}`, { status: 503 })
    }
    const payload = body === undefined ? undefined : JSON.stringify(body)
    let response
    try {
      const effectiveTimeout = coin === 'neoxa'
        ? Math.min(Math.max(1, Number(timeout) || timeoutMs), 6_000)
        : timeout
      response = await httpRequest(new URL(`${apiBase}${path.startsWith('/') ? path : `/${path}`}`), {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
        body: payload,
        timeoutMs: effectiveTimeout,
      })
    } catch (error) {
      blockbookUnavailableUntil = Date.now() + blockbookRetryDelayMs
      throw error
    }

    let data
    try {
      data = JSON.parse(response.body || '{}')
    } catch {
      throw new RpcError(`Blockbook returned non-JSON response (${response.status})`, { status: 502 })
    }

    if (response.status >= 500) {
      blockbookUnavailableUntil = Date.now() + blockbookRetryDelayMs
    } else if (response.status < 400 && !data?.error) {
      blockbookUnavailableUntil = 0
    }
    if (response.status >= 400 || data?.error) {
      throw new RpcError(data?.error || `Blockbook HTTP ${response.status}`, {
        status: response.status >= 400 ? response.status : 502,
      })
    }
    return data
  }

  const getNeoxaExplorerBalance = async (address) => {
    const response = await httpRequest(
      new URL(`https://explorer.neoxa.net/ext/getbalance/${encodeURIComponent(address)}`),
      { timeoutMs: 10_000 },
    )
    if (response.status >= 400) {
      throw new RpcError(`Neoxa explorer HTTP ${response.status}`, { status: response.status })
    }
    return coinTextToSats(response.body)
  }

  const getTx = async (txid) => {
    if (txCache.has(txid)) return txCache.get(txid)
    const tx = await request(`/tx/${encodeURIComponent(txid)}`)
    txCache.set(txid, tx)
    if (txCache.size > 500) txCache.delete(txCache.keys().next().value)
    return tx
  }

  const addressTxids = async (address, { page = 1, pageSize = 25 } = {}) => {
    const data = await request(
      `/address/${encodeURIComponent(address)}?details=txids&page=${page}&pageSize=${pageSize}`,
    )
    if (Array.isArray(data.txids)) return data.txids.filter(Boolean)
    if (Array.isArray(data.transactions)) return data.transactions.filter(Boolean)
    return []
  }

  const pendingTxsForAddress = async (address) => {
    const txids = await addressTxids(address, { page: 1, pageSize: 50 })
    const rows = await Promise.all(txids.map(async (txid) => {
      try {
        const tx = await getTx(txid)
        const confirmations = safeInt(tx.confirmations, 0)
        const blockHeight = safeInt(tx.blockHeight ?? tx.height, 0)
        return confirmations <= 0 && blockHeight <= 0 && !tx.blockHash && !tx.blockhash ? tx : null
      } catch {
        return null
      }
    }))
    return rows.filter(Boolean)
  }

  const blockbookAdapter = {
    coin,
    kind: 'blockbook',
    readProfile: 'blockbook',

    async getRawTransaction(txid, height) {
      // Prefer the local daemon when the explorer is unavailable or slow.
      if (localAdapter) {
        try { return await localAdapter.getRawTransaction(txid, height) } catch { /* Try the archival explorer below. */ }
      }
      const data = await request('/tx-specific/' + txid)
      return data.hex || data.result?.hex
    },

    async getNetwork() {
      const data = await request('/')
      const blockbook = data.blockbook || {}
      const backend = data.backend || {}
      const blocks = safeInt(backend.blocks ?? blockbook.bestHeight, 0)
      const headers = safeInt(backend.headers ?? blocks, blocks)
      const inSync = blockbook.inSync !== false && blockbook.initialSync !== true
      return {
        coin,
        chain: backend.chain || blockbook.network || 'main',
        blocks,
        headers,
        bestBlockHash: backend.bestBlockHash,
        difficulty: Number(backend.difficulty ?? 0),
        initialBlockDownload: !inSync,
        verificationProgress: inSync ? 1 : 0,
        connections: backend.connections,
        version: backend.version,
        subversion: backend.subversion,
        relayFee,
        mempoolSize: safeInt(blockbook.mempoolSize, 0),
        readProfile: 'blockbook',
      }
    },

    async getBalance(address) {
      if (coin === 'neoxa') {
        try {
          const confirmed = await getNeoxaExplorerBalance(address)
          return {
            address,
            balance: confirmed,
            balance_spendable: confirmed,
            received: confirmed,
            immature: 0,
            pendingIncoming: 0,
            pendingOutgoing: 0,
            mempoolNet: 0,
            pendingTxids: [],
            pendingOutgoingTxids: [],
          }
        } catch {
          // The Blockbook path below remains the authoritative fallback and
          // also supplies unconfirmed metadata when the explorer is offline.
        }
      }
      const data = await request(`/address/${encodeURIComponent(address)}?details=basic`)
      const confirmed = satsNumber(data.balance)
      const unconfirmed = satsNumber(data.unconfirmedBalance)
      const pendingIncoming = Math.max(0, unconfirmed)
      const pendingOutgoing = Math.abs(Math.min(0, unconfirmed))
      const visibleBalance = Math.max(0, confirmed + unconfirmed)
      let pendingTxids = []
      let pendingOutgoingTxids = []
      if (safeInt(data.unconfirmedTxs, 0) > 0 || unconfirmed !== 0) {
        try {
          const pendingTxs = await pendingTxsForAddress(address)
          pendingTxids = pendingTxs.map((tx) => tx.txid).filter(Boolean)
          pendingOutgoingTxids = pendingTxs
            .filter((tx) => txDeltaForAddress(tx, address) < 0)
            .map((tx) => tx.txid)
            .filter(Boolean)
        } catch {
          pendingTxids = []
          pendingOutgoingTxids = []
        }
      }
      return {
        address,
        balance: visibleBalance,
        balance_spendable: Math.max(0, confirmed - pendingOutgoing),
        received: satsNumber(data.totalReceived) + pendingIncoming,
        immature: 0,
        pendingIncoming,
        pendingOutgoing,
        mempoolNet: unconfirmed,
        pendingTxids,
        pendingOutgoingTxids,
      }
    },

    async getUtxos(address) {
      const rows = await request(`/utxo/${encodeURIComponent(address)}`)
      const utxos = await Promise.all((Array.isArray(rows) ? rows : []).map(async (row) => {
        const outputIndex = safeInt(row.vout ?? row.outputIndex ?? row.n, -1)
        let script = row.hex || row.script || row.scriptPubKey
        if (!script && row.txid && outputIndex >= 0) {
          const tx = await getTx(row.txid)
          const output = (tx.vout || []).find((item) => safeInt(item.n, -1) === outputIndex)
          script = output?.hex
        }
        if (!row.txid || outputIndex < 0 || !script) return null
        return {
          txid: row.txid,
          outputIndex,
          script,
          satoshis: satsNumber(row.value ?? row.satoshis),
          height: safeInt(row.height, 0),
        }
      }))
      return { address, utxos: utxos.filter(Boolean) }
    },

    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100))
      const safeOffset = Math.max(0, Math.min(Math.floor(Number(offset) || 0), 10_000))
      const page = Math.floor(safeOffset / safeLimit) + 1
      const skip = safeOffset % safeLimit
      const pageSize = Math.min(100, safeLimit + skip)
      const [data, txidData] = await Promise.all([
        request(`/address/${encodeURIComponent(address)}?details=txs&page=${page}&pageSize=${pageSize}`),
        request(`/address/${encodeURIComponent(address)}?details=txids&page=${page}&pageSize=${pageSize}`)
          .catch(() => null),
      ])
      const txidsPage = (
        (Array.isArray(txidData?.txids) && txidData.txids)
        || (Array.isArray(txidData?.transactions) && txidData.transactions)
        || (Array.isArray(data.txids) && data.txids)
        || []
      ).filter(Boolean)
      const pageTxids = txidsPage.slice(skip, skip + safeLimit)
      const sourceByTxid = new Map((data.transactions || []).map((tx) => [tx.txid, tx]))
      if (pageTxids.length > 0) {
        await Promise.all(pageTxids.map(async (txid) => {
          if (sourceByTxid.has(txid)) return
          try {
            sourceByTxid.set(txid, await getTx(txid))
          } catch {
            // Keep the rest of the page usable if Blockbook has announced a
            // txid but the transaction endpoint is still catching up.
          }
        }))
      }
      const sourceTxs = (pageTxids.length > 0
        ? pageTxids.map((txid) => sourceByTxid.get(txid)).filter(Boolean)
        : (data.transactions || []).slice(skip, skip + safeLimit))
      const txids = (pageTxids.length > 0 ? pageTxids : sourceTxs.map((tx) => tx.txid)).filter(Boolean)
      const deltas = []
      const mempool = []
      for (const tx of sourceTxs) {
        const satoshis = txDeltaForAddress(tx, address)
        const row = {
          txid: tx.txid,
          satoshis,
          height: safeInt(tx.blockHeight, 0) > 0 ? safeInt(tx.blockHeight, 0) : undefined,
          timestamp: tx.blockTime ?? tx.firstSeen,
        }
        if (safeInt(tx.confirmations, 0) > 0 && row.height) deltas.push(row)
        else mempool.push(row)
      }
      return {
        address,
        txids,
        deltas,
        mempool,
        transactions: sourceTxs.map(mapTx),
      }
    },

    async getMempool(address) {
      const pendingTxs = await pendingTxsForAddress(address)
      const pending = []
      for (const tx of pendingTxs) {
        const ownInputCoin = (tx.vin || []).reduce((sum, input) =>
          sum + (hasAddress(inputAddresses(input), address) ? coinFromSats(input.value) : 0), 0)
        const ownOutputCoin = (tx.vout || []).reduce((sum, output) => {
          const addresses = outputAddresses(output)
          return addresses.includes(address) ? sum + coinFromSats(output.value) : sum
        }, 0)
        if (ownInputCoin <= 0) {
          if (ownOutputCoin <= 0) continue
          pending.push({
            txid: tx.txid,
            type: 'incoming',
            amount: ownOutputCoin.toFixed(8).replace(/\.?0+$/, '') || '0',
            to: address,
            firstSeen: tx.firstSeen ?? tx.blockTime ?? Math.floor(Date.now() / 1000),
            confirmations: 0,
          })
          continue
        }
        const valueToOthers = (tx.vout || []).reduce((sum, output) => {
          const addresses = outputAddresses(output)
          return addresses.length > 0 && !addresses.includes(address) ? sum + coinFromSats(output.value) : sum
        }, 0)
        const to = (tx.vout || [])
          .map((output) => outputAddresses(output)[0])
          .find((outputAddress) => outputAddress && outputAddress !== address)
        pending.push({
          txid: tx.txid,
          type: 'outgoing',
          amount: Math.max(0, valueToOthers > 0 ? valueToOthers : ownInputCoin - ownOutputCoin).toFixed(8).replace(/\.?0+$/, '') || '0',
          fee: coinFromSats(tx.fees) > 0 ? coinFromSats(tx.fees).toFixed(8).replace(/\.?0+$/, '') : undefined,
          from: address,
          to,
          firstSeen: tx.firstSeen ?? tx.blockTime ?? Math.floor(Date.now() / 1000),
          confirmations: 0,
        })
      }
      return { address, hasPendingOutgoing: pending.length > 0, pending }
    },

    async broadcastTx(hex) {
      if (typeof hex !== 'string' || hex.trim().length === 0) {
        throw new RpcError('hex is required', { status: 400 })
      }
      const data = await request(`/sendtx/${encodeURIComponent(hex.trim())}`, { timeout: 60_000 })
      const txid = data.result || data.txid
      if (!txid) throw new RpcError('Blockbook broadcast returned no txid', { status: 502 })
      return { txid }
    },

    async validateAddress(address) {
      return {
        address,
        isvalid: isValidBase58Check(address, addressPrefixes) || isValidBech32(address, bech32Hrp),
      }
    },

    async estimateFee(targetBlocks = 6) {
      const blocks = Math.max(2, Math.min(Number(targetBlocks) || 6, 25))
      const data = await request(`/estimatefee/${blocks}`)
      const estimate = Number(data.result)
      const feerate = Math.max(Number.isFinite(estimate) && estimate > 0 ? estimate : 0, relayFee)
      return {
        coin,
        targetBlocks: blocks,
        feerate,
        relayFee,
        source: 'blockbook',
      }
    },
  }

  if (!localAdapter) return blockbookAdapter

  const withLocalFallback = (blockbookRead, localRead) => async (...args) => {
    try {
      return await blockbookRead(...args)
    } catch {
      return localRead(...args)
    }
  }

  const readCombinedMempool = async (...args) => {
    const [localResult, blockbookResult] = await Promise.allSettled([
      localAdapter.getMempool(...args),
      blockbookAdapter.getMempool(...args),
    ])
    if (localResult.status === 'rejected' && blockbookResult.status === 'rejected') {
      throw localResult.reason
    }
    const byTxid = new Map()
    for (const result of [blockbookResult, localResult]) {
      if (result.status !== 'fulfilled') continue
      for (const pending of result.value?.pending ?? []) {
        if (!pending?.txid) continue
        byTxid.set(pending.txid, pending)
      }
    }
    const pending = [...byTxid.values()]
    return {
      address: args[0],
      hasPendingOutgoing: pending.some((tx) => tx.type === 'outgoing'),
      pending,
    }
  }

  const readHistoryWithLiveMempool = async (address, options) => {
    const history = coin === 'neoxa'
      ? await localAdapter.getHistory(address, options)
      : await blockbookAdapter.getHistory(address, options).catch(() =>
        localAdapter.getHistory(address, options))
    const live = coin === 'neoxa'
      ? await localAdapter.getMempool(address).catch(() => null)
      : await readCombinedMempool(address).catch(() => null)
    const existing = new Set([
      ...(history.txids ?? []),
      ...(history.mempool ?? []).map((row) => row?.txid),
    ].filter(Boolean))
    const additions = []
    for (const tx of live?.pending ?? []) {
      if (!tx?.txid || existing.has(tx.txid)) continue
      const amount = Math.max(0, Math.round(Number(tx.amount || 0) * SATS_PER_COIN))
      additions.push({
        txid: tx.txid,
        satoshis: tx.type === 'outgoing' ? -amount : amount,
        timestamp: tx.firstSeen,
      })
      existing.add(tx.txid)
    }
    return {
      ...history,
      txids: [...additions.map((row) => row.txid), ...(history.txids ?? [])],
      mempool: [...additions, ...(history.mempool ?? [])],
    }
  }

  return {
    ...blockbookAdapter,
    readProfile: 'blockbook-local-rpc',
    getNetwork: (...args) => localAdapter.getNetwork(...args),
    getBalance: withLocalFallback(
      (...args) => blockbookAdapter.getBalance(...args),
      (...args) => localAdapter.getBalance(...args),
    ),
    getUtxos: coin === 'neoxa'
      ? (...args) => localAdapter.getUtxos(...args)
      : withLocalFallback(
        (...args) => blockbookAdapter.getUtxos(...args),
        (...args) => localAdapter.getUtxos(...args),
      ),
    getHistory: readHistoryWithLiveMempool,
    getMempool: coin === 'neoxa'
      ? (...args) => localAdapter.getMempool(...args)
      : readCombinedMempool,
    broadcastTx: (...args) => localAdapter.broadcastTx(...args),
    validateAddress: (...args) => localAdapter.validateAddress(...args),
    estimateFee: async (...args) => {
      try {
        return await localAdapter.estimateFee(...args)
      } catch {
        return blockbookAdapter.estimateFee(...args)
      }
    },
  }
}

module.exports = { createBlockbookAdapter }
