'use strict'

const { RpcError, httpRequest } = require('../lib/rpc.cjs')

const LOCAL_PENDING_TTL_MS = 30 * 60_000
const normalizeAddress = (value) => String(value || '').trim().toLowerCase()
const isKaspaAddress = (value) => /^kaspa:[a-z0-9]{40,80}$/.test(normalizeAddress(value))
const asBigInt = (value) => {
  try { return BigInt(String(value ?? 0)) } catch { return 0n }
}
const sompiToKas = (value) => {
  const amount = asBigInt(value)
  const whole = amount / 100_000_000n
  const fraction = (amount % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

const createKaspaRestAdapter = ({ coin = 'kaspa', apiBaseUrl = 'https://api.kaspa.org' } = {}) => {
  const base = String(apiBaseUrl).replace(/\/+$/, '')
  const localPending = new Map()

  const requestJson = async (route, options = {}) => {
    const url = new URL(`${base}${route}`)
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const { status, body: responseBody } = await httpRequest(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
      timeoutMs: options.timeoutMs ?? 20_000,
    })
    let parsed
    try { parsed = responseBody ? JSON.parse(responseBody) : {} } catch {
      throw new RpcError(`Non-JSON Kaspa API response (${status})`, { status: 502 })
    }
    if (status >= 400) {
      const detail = parsed.message ?? parsed.detail ?? parsed.error
      const message = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : `Kaspa API HTTP ${status}`
      throw new RpcError(message, { status: status === 404 ? 404 : 502 })
    }
    return parsed
  }

  const activePending = (address) => {
    const normalized = normalizeAddress(address)
    const now = Date.now()
    const rows = []
    for (const [txid, item] of localPending) {
      if (now - item.createdAt > LOCAL_PENDING_TTL_MS) {
        localPending.delete(txid)
        continue
      }
      if (item.from === normalized || item.to === normalized) rows.push(item)
    }
    return rows
  }

  const reconcilePending = async (address) => {
    const normalized = normalizeAddress(address)
    const pending = activePending(normalized)
    if (pending.length === 0) return
    const query = new URLSearchParams({ limit: '100', resolve_previous_outpoints: 'light' })
    const response = await requestJson(`/addresses/${encodeURIComponent(normalized)}/full-transactions-page?${query}`).catch(() => [])
    const transactions = Array.isArray(response) ? response : response.transactions ?? []
    const confirmed = new Set(transactions
      .filter((tx) => tx.isAccepted !== false && tx.accepted !== false)
      .map((tx) => String(tx.transactionId ?? tx.transaction_id ?? tx.id ?? tx.hash ?? '').trim())
      .filter(Boolean))
    for (const item of pending) if (confirmed.has(item.txid)) localPending.delete(item.txid)
  }

  const outputAddress = (output) => normalizeAddress(
    output?.verboseData?.scriptPublicKeyAddress
      ?? output?.scriptPublicKeyAddress
      ?? output?.script_public_key_address,
  )
  const inputAddress = (input) => normalizeAddress(
    input?.previousOutpoint?.verboseData?.scriptPublicKeyAddress
      ?? input?.utxo?.address
      ?? input?.address,
  )

  const historyRow = (tx, ownAddress, virtualDaaScore = 0) => {
    const txid = String(tx.transactionId ?? tx.transaction_id ?? tx.id ?? tx.hash ?? '').trim()
    if (!txid) return null
    const inputs = tx.inputs ?? []
    const outputs = tx.outputs ?? []
    const ownInputs = inputs.filter((input) => inputAddress(input) === ownAddress)
    const ownOutputs = outputs.filter((output) => outputAddress(output) === ownAddress)
    const inputValue = ownInputs.reduce((sum, input) => sum + asBigInt(input.utxo?.amount ?? input.amount ?? 0), 0n)
    const outputValue = ownOutputs.reduce((sum, output) => sum + asBigInt(output.amount ?? output.value ?? 0), 0n)
    const delta = outputValue - inputValue
    const timestamp = Math.floor(Number(tx.blockTime ?? tx.block_time ?? tx.acceptingBlockTime ?? Date.now()) / (Number(tx.blockTime ?? tx.block_time ?? 0) > 9_999_999_999 ? 1000 : 1))
    const blockDaaScore = Number(
      tx.blockDaaScore
        ?? tx.block_daa_score
        ?? tx.acceptingBlockBlueScore
        ?? tx.accepting_block_blue_score
        ?? 0,
    )
    const confirmations = tx.isAccepted === false || tx.accepted === false
      ? 0
      : Math.max(1, blockDaaScore > 0 && virtualDaaScore >= blockDaaScore ? virtualDaaScore - blockDaaScore + 1 : 1)
    return {
      txid,
      delta: { txid, satoshis: delta.toString(), height: blockDaaScore || undefined, timestamp },
      raw: {
        txid,
        hash: txid,
        vin: inputs.map((input) => ({ address: inputAddress(input), value: sompiToKas(input.utxo?.amount ?? input.amount ?? 0) })),
        vout: outputs.map((output, index) => ({ value: sompiToKas(output.amount ?? output.value ?? 0), n: index, scriptPubKey: { address: outputAddress(output), addresses: outputAddress(output) ? [outputAddress(output)] : [] } })),
        blocktime: timestamp,
        confirmations,
        fee: sompiToKas(tx.fee ?? 0),
      },
    }
  }

  return {
    coin,
    preserveAtomicBalances: true,

    async getNetwork() {
      const [dag, node] = await Promise.all([requestJson('/info/blockdag'), requestJson('/info/kaspad').catch(() => ({}))])
      const score = Number(dag.virtualDaaScore ?? dag.virtual_daa_score ?? 0)
      return { chain: 'kaspa-mainnet', blocks: score, headers: score, bestBlockHash: dag.virtualParentHashes?.[0], initialBlockDownload: node.isSynced === false, verificationProgress: node.isSynced === false ? 0.5 : 1, version: node.serverVersion }
    },

    async validateAddress(address) { return { isvalid: isKaspaAddress(address) } },

    async getBalance(address) {
      const normalized = normalizeAddress(address)
      if (!isKaspaAddress(normalized)) throw new RpcError('Invalid Kaspa address', { status: 400 })
      const [response] = await Promise.all([
        requestJson(`/addresses/${encodeURIComponent(normalized)}/balance`),
        reconcilePending(normalized),
      ])
      const balance = asBigInt(response.balance ?? response.result?.balance)
      const pending = activePending(normalized)
      const outgoing = pending.filter((item) => item.from === normalized).reduce((sum, item) => sum + asBigInt(item.amount) + asBigInt(item.fee), 0n)
      const incoming = pending.filter((item) => item.to === normalized).reduce((sum, item) => sum + asBigInt(item.amount), 0n)
      return { balance: balance.toString(), balance_spendable: (balance > outgoing ? balance - outgoing : 0n).toString(), received: balance.toString(), immature: '0', pendingIncoming: incoming.toString(), pendingOutgoing: outgoing.toString(), pendingTxids: pending.map((item) => item.txid), pendingOutgoingTxids: pending.filter((item) => item.from === normalized).map((item) => item.txid) }
    },

    async getUtxos(address) {
      const normalized = normalizeAddress(address)
      const response = await requestJson(`/addresses/${encodeURIComponent(normalized)}/utxos`)
      const rows = Array.isArray(response) ? response : response.utxos ?? response.result ?? []
      const utxos = rows.map((row) => {
        const entry = row.utxoEntry ?? row.utxo_entry ?? row
        const outpoint = row.outpoint ?? row.outPoint ?? {}
        const script = entry.scriptPublicKey ?? entry.script_public_key ?? {}
        return {
          txid: String(outpoint.transactionId ?? outpoint.transaction_id ?? row.transactionId ?? ''),
          outputIndex: Number(outpoint.index ?? row.index ?? 0),
          script: String(script.script ?? script.scriptPublicKey ?? script.script_public_key ?? ''),
          scriptPublicKeyVersion: Number(script.version ?? 0),
          satoshis: String(entry.amount ?? 0),
          blockDaaScore: String(entry.blockDaaScore ?? entry.block_daa_score ?? 0),
          isCoinbase: entry.isCoinbase === true || entry.is_coinbase === true,
          address: normalized,
        }
      }).filter((row) => /^[0-9a-f]{64}$/i.test(row.txid) && row.script)
      return { address: normalized, utxos }
    },

    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      const normalized = normalizeAddress(address)
      const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit + offset, 1), 100)), resolve_previous_outpoints: 'light' })
      const [response, dag] = await Promise.all([
        requestJson(`/addresses/${encodeURIComponent(normalized)}/full-transactions-page?${query}`).catch((error) => {
          if (error?.status === 404) return []
          throw error
        }),
        requestJson('/info/blockdag').catch(() => ({})),
      ])
      const transactions = (Array.isArray(response) ? response : response.transactions ?? []).slice(offset, offset + limit)
      const virtualDaaScore = Number(dag.virtualDaaScore ?? dag.virtual_daa_score ?? 0)
      const rows = transactions.map((tx) => historyRow(tx, normalized, virtualDaaScore)).filter(Boolean)
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

    async estimateFee() {
      const response = await requestJson('/info/fee-estimate').catch(() => ({}))
      const sompiPerGram = Number(response.priorityBucket?.feerate ?? response.priority_bucket?.feerate ?? 1)
      const kasPerKb = Math.max(1, sompiPerGram) * 1_000 / 100_000_000
      return { coin, feerate: kasPerKb, relayFee: kasPerKb, source: 'kaspa-rest' }
    },

    async broadcastTx(serializedEnvelope) {
      let envelope
      try { envelope = JSON.parse(serializedEnvelope) } catch { throw new RpcError('Invalid Kaspa transaction envelope', { status: 400 }) }
      if (!envelope.transaction) throw new RpcError('Kaspa transaction is required', { status: 400 })
      const response = await requestJson('/transactions', { body: { transaction: envelope.transaction, allowOrphan: false }, timeoutMs: 30_000 })
      const txid = String(response.transactionId ?? response.transaction_id ?? response.txid ?? envelope.txid ?? '').trim()
      if (!/^[0-9a-f]{64}$/i.test(txid)) throw new RpcError('Kaspa relay returned no valid transaction id', { status: 502 })
      localPending.set(txid, { txid, from: normalizeAddress(envelope.from), to: normalizeAddress(envelope.to), amount: String(envelope.amount ?? 0), fee: String(envelope.fee ?? 0), createdAt: Date.now() })
      return { txid }
    },
  }
}

module.exports = { createKaspaRestAdapter }
