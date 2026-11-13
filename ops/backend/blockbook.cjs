'use strict'

const crypto = require('node:crypto')
const { RpcError, httpRequest } = require('../lib/rpc.cjs')

const SATS_PER_COIN = 100_000_000
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_CONST = 1
const BECH32M_CONST = 0x2bc830a3

const trimSlash = (value) => String(value || '').replace(/\/+$/, '')
const coinFromSats = (value) => Number(value || 0) / SATS_PER_COIN
const satsNumber = (value) => Number(value || 0)
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
  headers = {},
  apiKey,
  apiKeyHeader = 'api-key',
}) => {
  if (!coin) throw new Error('blockbook adapter: missing `coin`')
  if (!baseUrl) throw new Error(`blockbook adapter (${coin}): missing baseUrl`)

  const apiBases = String(baseUrl)
    .split(',')
    .map((value) => trimSlash(value.trim()))
    .filter(Boolean)
  if (apiBases.length === 0) throw new Error(`blockbook adapter (${coin}): missing usable baseUrl`)
  let preferredApiBase = 0
  const txCache = new Map()
  const requestHeaders = {
    ...headers,
    ...(apiKey ? { [apiKeyHeader || 'api-key']: apiKey } : {}),
  }

  const requestFrom = async (apiBase, path, { method = 'GET', body, timeout = timeoutMs, allowText = false } = {}) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const response = await httpRequest(new URL(`${apiBase}${path.startsWith('/') ? path : `/${path}`}`), {
      method,
      headers: {
        ...requestHeaders,
        ...(payload
          ? { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}),
      },
      body: payload,
      timeoutMs: timeout,
    })

    if (allowText && response.status < 400 && /^[0-9a-f]{64}$/i.test(String(response.body || '').trim())) {
      return String(response.body).trim()
    }
    let data
    try {
      data = JSON.parse(response.body || '{}')
    } catch {
      if (allowText && response.status < 400) return String(response.body || '').trim()
      throw new RpcError(`Blockbook returned non-JSON response (${response.status})`, { status: response.status >= 400 ? response.status : 502 })
    }

    if (response.status >= 400 || data?.error) {
      throw new RpcError(data?.error || `Blockbook HTTP ${response.status}`, {
        status: response.status >= 400 ? response.status : 502,
      })
    }
    return data
  }

  const request = async (path, options = {}) => {
    let lastError
    // A write may have reached the upstream before its response was lost.
    const attempts = options.method && options.method !== 'GET' ? 1 : apiBases.length
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const index = (preferredApiBase + attempt) % apiBases.length
      try {
        const result = await requestFrom(apiBases[index], path, options)
        preferredApiBase = index
        return result
      } catch (error) {
        lastError = error
        const status = Number(error?.status ?? 0)
        const retryable = !status || status === 408 || status === 429 || status >= 500
        if (!retryable) throw error
      }
    }
    throw lastError
  }

  const broadcastResultTxid = (data) => {
    if (typeof data === 'string') return data.trim()
    return data?.result || data?.txid
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

  const pendingTxsForAddress = async (address, basicData) => {
    const summary = basicData || await request(`/address/${encodeURIComponent(address)}?details=basic`)
    if (safeInt(summary.unconfirmedTxs, 0) <= 0 && satsNumber(summary.unconfirmedBalance) === 0) {
      return []
    }
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

  return {
    coin,
    kind: 'blockbook',
    readProfile: 'blockbook',

    async getRawTransaction(txid) {
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
          const pendingTxs = await pendingTxsForAddress(address, data)
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
      const data = await request(
        `/address/${encodeURIComponent(address)}?details=txs&page=${page}&pageSize=${pageSize}`,
      )
      const txidsPage = (
        (Array.isArray(data.txids) && data.txids)
        || (Array.isArray(data.transactions) && data.transactions.map((tx) => tx?.txid))
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
        if (ownInputCoin <= 0) continue
        const ownOutputCoin = (tx.vout || []).reduce((sum, output) => {
          const addresses = outputAddresses(output)
          return addresses.includes(address) ? sum + coinFromSats(output.value) : sum
        }, 0)
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
      const signedHex = typeof hex === 'string' ? hex.trim() : ''
      if (!/^(?:[0-9a-f]{2})+$/i.test(signedHex) || signedHex.length > 8 * 1024 * 1024) {
        throw new RpcError('A valid hex transaction of at most 8 MiB is required', { status: 400 })
      }
      // Blockbook expects raw hex in a text/plain POST body. Never place a
      // transaction in the URL or retry a write after an ambiguous response.
      const data = await request('/sendtx/', {
        method: 'POST',
        body: signedHex,
        timeout: 60_000,
        allowText: true,
      })
      const txid = broadcastResultTxid(data)
      if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) {
        throw new RpcError('Blockbook broadcast returned no valid txid', { status: 502 })
      }
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
}

module.exports = { createBlockbookAdapter }
