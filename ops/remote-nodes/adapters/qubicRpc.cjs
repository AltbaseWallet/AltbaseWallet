'use strict'

const { RpcError, httpRequest } = require('../lib/rpc.cjs')

const LOCAL_PENDING_TTL_MS = 20 * 60_000
const normalizeIdentity = (value) => String(value || '').trim().toUpperCase()
const isIdentity = (value) => /^[A-Z]{60}$/.test(normalizeIdentity(value))
const asBigInt = (value) => {
  try { return BigInt(String(value ?? 0)) } catch { return 0n }
}
const timestampSeconds = (value) => {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 9_999_999_999 ? Math.floor(numeric / 1000) : Math.floor(numeric)
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000)
}

const createQubicRpcAdapter = ({ coin = 'qubic', liveBaseUrl = 'https://rpc.qubic.org/live/v1', queryBaseUrl = 'https://rpc.qubic.org/query/v1' } = {}) => {
  const liveBase = String(liveBaseUrl).replace(/\/+$/, '')
  const queryBase = String(queryBaseUrl).replace(/\/+$/, '')
  const localPending = new Map()

  const requestJson = async (base, route, options = {}) => {
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
      throw new RpcError(`Non-JSON Qubic API response (${status})`, { status: 502 })
    }
    if (status >= 400) throw new RpcError(parsed.message || parsed.error || `Qubic API HTTP ${status}`, { status: status === 404 ? 404 : 502 })
    return parsed
  }

  const tickInfo = async () => {
    const response = await requestJson(liveBase, '/tick-info')
    return response.tickInfo ?? response
  }

  const transactionsFor = async (identity, limit = 25, offset = 0) => {
    const response = await requestJson(queryBase, '/getTransactionsForIdentity', {
      body: { identity, pagination: { offset: Math.max(0, offset), size: Math.min(Math.max(1, limit), 100) } },
      timeoutMs: 25_000,
    })
    return response.transactions ?? response.data?.transactions ?? response.data ?? []
  }

  const activePending = (identity) => {
    const now = Date.now()
    const normalized = normalizeIdentity(identity)
    const rows = []
    for (const [txid, pending] of localPending) {
      if (now - pending.createdAt > LOCAL_PENDING_TTL_MS) {
        localPending.delete(txid)
        continue
      }
      if (pending.from === normalized || pending.to === normalized) rows.push(pending)
    }
    return rows
  }

  const reconcilePending = async (identity) => {
    const pending = activePending(identity)
    if (pending.length === 0) return
    const transactions = await transactionsFor(identity, 100, 0).catch(() => [])
    const confirmed = new Set(transactions.map((tx) => String(tx.hash ?? tx.transactionHash ?? tx.txid ?? '').trim()).filter(Boolean))
    for (const item of pending) if (confirmed.has(item.txid)) localPending.delete(item.txid)
  }

  const historyRow = (tx, identity, currentTick = 0) => {
    const txid = String(tx.hash ?? tx.transactionHash ?? tx.txid ?? '').trim()
    if (!txid) return null
    const source = normalizeIdentity(tx.source ?? tx.sourceIdentity)
    const destination = normalizeIdentity(tx.destination ?? tx.destinationIdentity)
    const amount = asBigInt(tx.amount)
    const outgoing = source === identity
    const timestamp = timestampSeconds(tx.timestamp ?? tx.createdAt)
    const tick = Number(tx.tickNumber ?? tx.tick ?? 0)
    const confirmations = tx.moneyFlew === true
      ? Math.max(1, tick > 0 && currentTick >= tick ? currentTick - tick + 1 : 1)
      : 0
    return {
      txid,
      delta: { txid, satoshis: (outgoing ? -amount : amount).toString(), height: tick || undefined, timestamp },
      raw: {
        txid,
        hash: txid,
        vin: [{ address: source, value: amount.toString() }],
        vout: [{ value: amount.toString(), n: 0, scriptPubKey: { address: destination, addresses: destination ? [destination] : [] } }],
        blocktime: timestamp,
        confirmations,
        fee: '0',
      },
    }
  }

  return {
    coin,
    preserveAtomicBalances: true,

    async getNetwork() {
      const info = await tickInfo()
      const tick = Number(info.tick ?? info.currentTick ?? 0)
      return { chain: 'qubic-mainnet', blocks: tick, headers: tick, initialBlockDownload: false, verificationProgress: 1, connections: Number(info.numberOfAlignedVotes ?? 0) }
    },

    async validateAddress(address) {
      return { isvalid: isIdentity(address) }
    },

    async getBalance(address) {
      const identity = normalizeIdentity(address)
      if (!isIdentity(identity)) throw new RpcError('Invalid Qubic identity', { status: 400 })
      const [response] = await Promise.all([
        requestJson(liveBase, `/balances/${encodeURIComponent(identity)}`),
        reconcilePending(identity),
      ])
      const record = response.balance ?? response
      const balance = asBigInt(record.balance ?? record.amount)
      const pending = activePending(identity)
      const pendingOutgoing = pending.filter((item) => item.from === identity).reduce((sum, item) => sum + asBigInt(item.amount), 0n)
      const pendingIncoming = pending.filter((item) => item.to === identity).reduce((sum, item) => sum + asBigInt(item.amount), 0n)
      return {
        balance: balance.toString(), balance_spendable: (balance > pendingOutgoing ? balance - pendingOutgoing : 0n).toString(),
        received: String(record.totalIncomingAmount ?? balance), immature: '0',
        pendingIncoming: pendingIncoming.toString(), pendingOutgoing: pendingOutgoing.toString(),
        pendingTxids: pending.map((item) => item.txid),
        pendingOutgoingTxids: pending.filter((item) => item.from === identity).map((item) => item.txid),
      }
    },

    async getUtxos(address) { return { address, utxos: [] } },

    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      const identity = normalizeIdentity(address)
      const [transactions, info] = await Promise.all([
        transactionsFor(identity, limit, offset),
        tickInfo().catch(() => ({})),
      ])
      const currentTick = Number(info.tick ?? info.currentTick ?? 0)
      const rows = transactions.map((tx) => historyRow(tx, identity, currentTick)).filter(Boolean)
      const confirmed = new Set(rows.map((row) => row.txid))
      for (const txid of confirmed) localPending.delete(txid)
      const pending = activePending(identity).filter((item) => !confirmed.has(item.txid)).map((item) => ({
        txid: item.txid,
        satoshis: (item.from === identity ? -asBigInt(item.amount) : asBigInt(item.amount)).toString(),
        timestamp: Math.floor(item.createdAt / 1000),
      }))
      return { address: identity, txids: [...pending.map((row) => row.txid), ...rows.map((row) => row.txid)], deltas: rows.map((row) => row.delta), mempool: pending, transactions: rows.map((row) => row.raw) }
    },

    async getMempool(address) {
      const identity = normalizeIdentity(address)
      await reconcilePending(identity)
      const pending = activePending(identity).map((item) => ({
        txid: item.txid,
        type: item.from === identity ? 'outgoing' : 'incoming',
        amount: item.amount,
        fee: '0', from: item.from, to: item.to,
        firstSeen: Math.floor(item.createdAt / 1000), confirmations: 0,
      }))
      return { address: identity, hasPendingOutgoing: pending.some((item) => item.type === 'outgoing'), pending }
    },

    async estimateFee() {
      return { coin, fee: '0', feeSatoshis: 0, gasLimit: '0', gasPrice: '0', feerate: 0, relayFee: 0, source: 'qubic-no-fee' }
    },

    async getAccountTxContext({ from, to }) {
      const source = normalizeIdentity(from)
      const destination = normalizeIdentity(to)
      if (!isIdentity(source) || (destination && !isIdentity(destination))) throw new RpcError('Invalid Qubic identity', { status: 400 })
      const info = await tickInfo()
      const currentTick = Number(info.tick ?? info.currentTick ?? 0)
      return { coin, from: source, to: destination || undefined, nonce: 0, targetTick: currentTick + 12, fee: '0', feeSatoshis: 0, gasLimit: '0', gasPrice: '0', chainId: 'qubic-mainnet', source: 'qubic-live' }
    },

    async broadcastTx(serializedEnvelope) {
      let envelope
      try { envelope = JSON.parse(serializedEnvelope) } catch { throw new RpcError('Invalid Qubic transaction envelope', { status: 400 }) }
      if (!envelope.encodedTransaction) throw new RpcError('Qubic encodedTransaction is required', { status: 400 })
      const response = await requestJson(liveBase, '/broadcast-transaction', { body: { encodedTransaction: envelope.encodedTransaction }, timeoutMs: 30_000 })
      const txid = String(response.transactionId ?? response.hash ?? response.txid ?? response.id ?? '').trim()
      if (!txid) throw new RpcError('Qubic relay accepted the transaction but returned no transaction id', { status: 502 })
      localPending.set(txid, { txid, from: normalizeIdentity(envelope.from), to: normalizeIdentity(envelope.to), amount: String(envelope.amount), targetTick: Number(envelope.targetTick), createdAt: Date.now() })
      return { txid }
    },
  }
}

module.exports = { createQubicRpcAdapter }
