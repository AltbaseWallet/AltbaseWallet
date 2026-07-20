'use strict'

const { RpcError, httpRequest } = require('../lib/rpc.cjs')

const SHANNONS_PER_CKB = 100_000_000n
const LOCAL_PENDING_TTL_MS = 30 * 60_000
const normalizeAddress = (value) => String(value || '').trim()
const isCkbAddress = (value) => /^ckb1[ac-hj-np-z02-9]{20,120}$/i.test(normalizeAddress(value))
const asBigInt = (value) => {
  try { return BigInt(String(value ?? 0)) } catch { return 0n }
}
const hexInt = (value) => {
  try { return Number(BigInt(String(value ?? 0))) } catch { return 0 }
}
const shannonsToCkb = (value) => {
  const amount = asBigInt(value)
  const whole = amount / SHANNONS_PER_CKB
  const fraction = (amount % SHANNONS_PER_CKB).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
const snakeScript = (script) => script ? { code_hash: script.codeHash ?? script.code_hash, hash_type: script.hashType ?? script.hash_type, args: script.args } : null
const snakeDepType = (value) => value === 'depGroup' ? 'dep_group' : value

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const bech32Polymod = (values) => {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0
    for (let bit = 0; bit < 5; bit += 1) {
      if ((top >>> bit) & 1) checksum = (checksum ^ generators[bit]) >>> 0
    }
  }
  return checksum >>> 0
}
const expandHrp = (hrp) => [
  ...Array.from(hrp, (char) => char.charCodeAt(0) >>> 5),
  0,
  ...Array.from(hrp, (char) => char.charCodeAt(0) & 31),
]
const convertBits = (values, fromBits, toBits) => {
  let accumulator = 0
  let bits = 0
  const result = []
  const maxValue = (1 << toBits) - 1
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1
  for (const value of values) {
    if (value < 0 || value >>> fromBits !== 0) throw new RpcError('Invalid CKB address data', { status: 400 })
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((accumulator >>> bits) & maxValue)
    }
  }
  if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    throw new RpcError('Invalid CKB address padding', { status: 400 })
  }
  return result
}
const lockScriptFromAddress = (address) => {
  const normalized = normalizeAddress(address)
  if (normalized !== normalized.toLowerCase() && normalized !== normalized.toUpperCase()) {
    throw new RpcError('Mixed-case CKB address', { status: 400 })
  }
  const lower = normalized.toLowerCase()
  const separator = lower.lastIndexOf('1')
  const hrp = lower.slice(0, separator)
  if (hrp !== 'ckb' || separator < 1 || lower.length - separator < 7) {
    throw new RpcError('Invalid CKB mainnet address', { status: 400 })
  }
  const words = Array.from(lower.slice(separator + 1), (char) => BECH32_CHARSET.indexOf(char))
  if (words.some((word) => word < 0)) throw new RpcError('Invalid CKB address alphabet', { status: 400 })
  const checksum = bech32Polymod([...expandHrp(hrp), ...words])
  if (checksum !== 1 && checksum !== 0x2bc830a3) throw new RpcError('Invalid CKB address checksum', { status: 400 })
  const payload = convertBits(words.slice(0, -6), 5, 8)
  if (payload.length < 35 || payload[0] !== 0) {
    throw new RpcError('Unsupported legacy CKB address format for an empty wallet', { status: 400 })
  }
  const hashTypes = new Map([[0, 'data'], [1, 'type'], [2, 'data1'], [4, 'data2']])
  const hashType = hashTypes.get(payload[33])
  if (!hashType) throw new RpcError('Unsupported CKB script hash type', { status: 400 })
  return {
    code_hash: `0x${Buffer.from(payload.slice(1, 33)).toString('hex')}`,
    hash_type: hashType,
    args: `0x${Buffer.from(payload.slice(34)).toString('hex')}`,
  }
}

const createCkbRpcAdapter = ({
  coin = 'ckb',
  rpcUrls = ['https://mainnet.ckbapp.dev/', 'https://mainnet.ckb.dev/'],
  explorerBaseUrl = 'https://mainnet-api.explorer.nervos.org/api/v1',
} = {}) => {
  const rpcTargets = (Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls]).map((url) => new URL(url))
  const explorerBase = String(explorerBaseUrl).replace(/\/+$/, '')
  const localPending = new Map()
  let rpcId = 0

  const parseResponse = (status, body, label) => {
    let parsed
    try { parsed = body ? JSON.parse(body) : {} } catch { throw new RpcError(`Non-JSON ${label} response (${status})`, { status: 502 }) }
    if (status >= 400) throw new RpcError(parsed.errors?.[0]?.detail || parsed.message || parsed.error || `${label} HTTP ${status}`, { status: status === 404 ? 404 : 502 })
    return parsed
  }

  const explorerGet = async (route) => {
    const url = new URL(`${explorerBase}${route}`)
    const { status, body } = await httpRequest(url, { headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' }, timeoutMs: 25_000 })
    return parseResponse(status, body, 'CKB Explorer')
  }

  const rpc = async (method, params = []) => {
    const payload = JSON.stringify({ id: ++rpcId, jsonrpc: '2.0', method, params })
    let lastError
    for (const target of rpcTargets) {
      try {
        const { status, body } = await httpRequest(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, body: payload, timeoutMs: 25_000 })
        const parsed = parseResponse(status, body, 'CKB RPC')
        if (parsed.error) throw new RpcError(parsed.error.message || `CKB RPC ${method} failed`, { code: parsed.error.code, status: 502 })
        return parsed.result
      } catch (error) { lastError = error }
    }
    throw lastError ?? new RpcError(`CKB RPC ${method} failed`, { status: 502 })
  }

  const addressRecord = async (address) => {
    try {
      const response = await explorerGet(`/addresses/${encodeURIComponent(address)}`)
      return response.data?.attributes ?? response.attributes ?? response
    } catch (error) {
      if (error?.status === 404) return null
      throw error
    }
  }

  const activePending = (address) => {
    const now = Date.now()
    const rows = []
    for (const [txid, item] of localPending) {
      if (now - item.createdAt > LOCAL_PENDING_TTL_MS) {
        localPending.delete(txid)
        continue
      }
      if (item.from === address || item.to === address) rows.push(item)
    }
    return rows
  }

  const reconcilePending = async (address) => {
    const pending = activePending(address)
    if (pending.length === 0) return
    await Promise.all(pending.map(async (item) => {
      const transaction = await rpc('get_transaction', [item.txid]).catch(() => null)
      const status = String(transaction?.tx_status?.status ?? '').toLowerCase()
      if (status === 'committed' || status === 'rejected') localPending.delete(item.txid)
    }))
  }

  const historyRow = (entry, address, tipNumber = 0) => {
    const tx = entry.attributes ?? entry
    const txid = String(tx.transaction_hash ?? tx.transactionHash ?? tx.tx_hash ?? entry.id ?? '').trim()
    if (!txid) return null
    const inputs = tx.display_inputs ?? tx.displayInputs ?? tx.inputs ?? []
    const outputs = tx.display_outputs ?? tx.displayOutputs ?? tx.outputs ?? []
    const inputAddress = (item) => String(item.address_hash ?? item.addressHash ?? item.address ?? '')
    const outputAddress = (item) => String(item.address_hash ?? item.addressHash ?? item.address ?? '')
    const ownInputs = inputs.filter((item) => inputAddress(item) === address)
    const ownOutputs = outputs.filter((item) => outputAddress(item) === address)
    const inputCapacity = ownInputs.reduce((sum, item) => sum + asBigInt(item.capacity ?? item.value), 0n)
    const outputCapacity = ownOutputs.reduce((sum, item) => sum + asBigInt(item.capacity ?? item.value), 0n)
    const delta = tx.income !== undefined ? asBigInt(tx.income) : outputCapacity - inputCapacity
    const timestampRaw = Number(tx.block_timestamp ?? tx.blockTimestamp ?? tx.timestamp ?? Date.now())
    const timestamp = timestampRaw > 9_999_999_999 ? Math.floor(timestampRaw / 1000) : Math.floor(timestampRaw)
    const blockNumber = Number(tx.block_number ?? tx.blockNumber ?? 0)
    // Explorer status can lag behind the indexed block number. A transaction
    // with a real block number is confirmed even if the stale status still
    // says "pending"; otherwise the gateway incorrectly locks its live cell.
    const pendingWithoutBlock = blockNumber <= 0 && (tx.tx_status === 'pending' || tx.status === 'pending')
    const confirmations = pendingWithoutBlock
      ? 0
      : Math.max(1, blockNumber > 0 && tipNumber >= blockNumber ? tipNumber - blockNumber + 1 : 1)
    return {
      txid,
      delta: { txid, satoshis: delta.toString(), height: blockNumber || undefined, timestamp },
      raw: {
        txid,
        hash: txid,
        vin: inputs.map((item) => ({ address: inputAddress(item), value: shannonsToCkb(item.capacity ?? item.value) })),
        vout: outputs.map((item, index) => ({ value: shannonsToCkb(item.capacity ?? item.value), n: index, scriptPubKey: { address: outputAddress(item), addresses: outputAddress(item) ? [outputAddress(item)] : [] } })),
        blocktime: timestamp,
        confirmations,
        fee: shannonsToCkb(tx.transaction_fee ?? tx.transactionFee ?? tx.fee ?? 0),
      },
    }
  }

  const rpcTransaction = (tx) => ({
    version: tx.version,
    cell_deps: (tx.cellDeps ?? tx.cell_deps ?? []).map((dep) => ({ out_point: { tx_hash: dep.outPoint?.txHash ?? dep.out_point?.tx_hash, index: dep.outPoint?.index ?? dep.out_point?.index }, dep_type: snakeDepType(dep.depType ?? dep.dep_type) })),
    header_deps: tx.headerDeps ?? tx.header_deps ?? [],
    inputs: (tx.inputs ?? []).map((input) => ({ since: input.since, previous_output: { tx_hash: input.previousOutput?.txHash ?? input.previous_output?.tx_hash, index: input.previousOutput?.index ?? input.previous_output?.index } })),
    outputs: (tx.outputs ?? []).map((output) => ({ capacity: output.capacity, lock: snakeScript(output.lock), type: snakeScript(output.type) })),
    outputs_data: tx.outputsData ?? tx.outputs_data ?? [],
    witnesses: tx.witnesses ?? [],
  })

  return {
    coin,
    preserveAtomicBalances: true,

    async getNetwork() {
      const header = await rpc('get_tip_header')
      const number = hexInt(header.number)
      return { chain: 'ckb-mainnet', blocks: number, headers: number, bestBlockHash: header.hash, difficulty: 0, initialBlockDownload: false, verificationProgress: 1 }
    },

    async validateAddress(address) { return { isvalid: isCkbAddress(address) } },

    async getBalance(address) {
      const normalized = normalizeAddress(address)
      if (!isCkbAddress(normalized)) throw new RpcError('Invalid CKB address', { status: 400 })
      const [record] = await Promise.all([
        addressRecord(normalized),
        reconcilePending(normalized),
      ])
      const balance = asBigInt(record?.balance)
      const pending = activePending(normalized)
      const outgoing = pending.filter((item) => item.from === normalized).reduce((sum, item) => sum + asBigInt(item.amount) + asBigInt(item.fee), 0n)
      const incoming = pending.filter((item) => item.to === normalized).reduce((sum, item) => sum + asBigInt(item.amount), 0n)
      return { balance: balance.toString(), balance_spendable: (balance > outgoing ? balance - outgoing : 0n).toString(), received: balance.toString(), immature: '0', pendingIncoming: incoming.toString(), pendingOutgoing: outgoing.toString(), pendingTxids: pending.map((item) => item.txid), pendingOutgoingTxids: pending.filter((item) => item.from === normalized).map((item) => item.txid) }
    },

    async getUtxos(address) {
      const normalized = normalizeAddress(address)
      const record = await addressRecord(normalized)
      const lockRaw = record?.lock_script ?? record?.lockScript
      const lock = lockRaw
        ? { code_hash: lockRaw.code_hash ?? lockRaw.codeHash, hash_type: lockRaw.hash_type ?? lockRaw.hashType, args: lockRaw.args }
        : lockScriptFromAddress(normalized)
      const searchKey = { script: lock, script_type: 'lock', script_search_mode: 'exact', filter: { output_data_len_range: ['0x0', '0x1'] } }
      const rows = []
      let cursor
      for (let page = 0; page < 20; page += 1) {
        const result = await rpc('get_cells', [searchKey, 'asc', '0x64', ...(cursor ? [cursor] : [])])
        rows.push(...(result.objects ?? []))
        const next = result.last_cursor
        if (!next || next === cursor || (result.objects ?? []).length < 100) break
        cursor = next
      }
      const utxos = rows.map((cell) => ({
        txid: String(cell.out_point?.tx_hash ?? ''),
        outputIndex: hexInt(cell.out_point?.index),
        script: '',
        satoshis: asBigInt(cell.output?.capacity).toString(),
        cellOutput: {
          capacity: cell.output?.capacity,
          lock: { codeHash: cell.output?.lock?.code_hash, hashType: cell.output?.lock?.hash_type, args: cell.output?.lock?.args },
          type: cell.output?.type ? { codeHash: cell.output.type.code_hash, hashType: cell.output.type.hash_type, args: cell.output.type.args } : undefined,
        },
        outputData: cell.output_data ?? '0x',
        height: hexInt(cell.block_number),
        blockNumber: cell.block_number,
        txIndex: cell.tx_index,
        address: normalized,
      })).filter((row) => /^[0-9a-fx]{66}$/i.test(row.txid))
      return { address: normalized, utxos }
    },

    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      const normalized = normalizeAddress(address)
      const page = Math.floor(offset / Math.max(1, limit)) + 1
      const [response, tipHeader] = await Promise.all([
        explorerGet(`/address_transactions/${encodeURIComponent(normalized)}?page=${page}&page_size=${Math.min(Math.max(limit, 1), 100)}`).catch((error) => {
          if (error?.status === 404) return { data: [] }
          throw error
        }),
        rpc('get_tip_header').catch(() => null),
      ])
      const entries = response.data ?? response.transactions ?? []
      const tipNumber = hexInt(tipHeader?.number)
      const rows = entries.map((entry) => historyRow(entry, normalized, tipNumber)).filter(Boolean)
      const confirmed = new Set(rows.filter((row) => row.raw.confirmations > 0).map((row) => row.txid))
      for (const txid of confirmed) localPending.delete(txid)
      const pending = activePending(normalized).filter((item) => !confirmed.has(item.txid)).map((item) => ({ txid: item.txid, satoshis: (item.from === normalized ? -asBigInt(item.amount) - asBigInt(item.fee) : asBigInt(item.amount)).toString(), timestamp: Math.floor(item.createdAt / 1000) }))
      return { address: normalized, txids: [...pending.map((row) => row.txid), ...rows.map((row) => row.txid)], deltas: rows.filter((row) => row.raw.confirmations > 0).map((row) => row.delta), mempool: [...pending, ...rows.filter((row) => row.raw.confirmations === 0).map((row) => ({ txid: row.txid, satoshis: row.delta.satoshis, timestamp: row.delta.timestamp }))], transactions: rows.map((row) => row.raw) }
    },

    async getMempool(address) {
      const normalized = normalizeAddress(address)
      await reconcilePending(normalized)
      const pending = activePending(normalized).map((item) => ({ txid: item.txid, type: item.from === normalized ? 'outgoing' : 'incoming', amount: item.amount, fee: item.fee, from: item.from, to: item.to, firstSeen: Math.floor(item.createdAt / 1000), confirmations: 0 }))
      return { address: normalized, hasPendingOutgoing: pending.some((item) => item.type === 'outgoing'), pending }
    },

    async estimateFee() { return { coin, feerate: 0.00001, relayFee: 0.00001, source: 'ckb-default-fee-rate' } },

    async broadcastTx(serializedEnvelope) {
      let envelope
      try { envelope = JSON.parse(serializedEnvelope) } catch { throw new RpcError('Invalid CKB transaction envelope', { status: 400 }) }
      if (!envelope.transaction) throw new RpcError('CKB transaction is required', { status: 400 })
      const txid = String(await rpc('send_transaction', [rpcTransaction(envelope.transaction), 'passthrough'])).trim()
      if (!/^0x[0-9a-f]{64}$/i.test(txid)) throw new RpcError('CKB node returned no valid transaction hash', { status: 502 })
      localPending.set(txid, { txid, from: normalizeAddress(envelope.from), to: normalizeAddress(envelope.to), amount: String(envelope.amount ?? 0), fee: String(envelope.fee ?? 0), createdAt: Date.now() })
      return { txid }
    },
  }
}

module.exports = { createCkbRpcAdapter }
