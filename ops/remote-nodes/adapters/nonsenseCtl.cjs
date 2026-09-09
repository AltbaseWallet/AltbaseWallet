'use strict'

const { spawn } = require('node:child_process')
const { RpcError } = require('../lib/rpc.cjs')

const LOCAL_PENDING_TTL_MS = 30 * 60_000
const MAX_CTL_OUTPUT = 8 * 1024 * 1024
const normalizeAddress = (value) => String(value || '').trim().toLowerCase()
const isNonsenseAddress = (value) => /^nonsense:[a-z0-9]{40,90}$/.test(normalizeAddress(value))
const asBigInt = (value) => {
  try { return BigInt(String(value ?? 0)) } catch { return 0n }
}
const sompiToNnn = (value) => {
  const amount = asBigInt(value)
  const whole = amount / 100_000_000n
  const fraction = (amount % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
const nnnToSompi = (value) => {
  const [whole = '0', fraction = ''] = String(value ?? 0).split('.')
  return asBigInt(whole) * 100_000_000n + asBigInt((fraction + '00000000').slice(0, 8))
}

const runProcess = (binary, args, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const stdout = []
  const stderr = []
  let size = 0
  let settled = false
  const finish = (error, value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (error) reject(error)
    else resolve(value)
  }
  const append = (target, chunk) => {
    size += chunk.length
    if (size > MAX_CTL_OUTPUT) {
      child.kill('SIGKILL')
      finish(new Error('Nonsense RPC response exceeded the safety limit'))
      return
    }
    target.push(chunk)
  }
  child.stdout.on('data', (chunk) => append(stdout, chunk))
  child.stderr.on('data', (chunk) => append(stderr, chunk))
  child.on('error', (error) => finish(error))
  child.on('close', (code) => {
    const out = Buffer.concat(stdout).toString('utf8').trim()
    const err = Buffer.concat(stderr).toString('utf8').trim()
    if (code !== 0) return finish(new Error(err || out || `nonsensectl exited with code ${code}`))
    finish(null, out)
  })
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    finish(new Error(`nonsensectl timed out after ${timeoutMs}ms`))
  }, timeoutMs)
})

const createNonsenseCtlAdapter = ({
  coin = 'nonsense',
  ctlPath = '/opt/nonsense/bin/nonsensectl',
  rpcServers = ['127.0.0.1:39110', '127.0.0.1:39112'],
} = {}) => {
  const endpoints = rpcServers.map((value) => String(value).trim()).filter(Boolean)
  if (endpoints.length === 0) throw new Error('At least one Nonsense RPC endpoint is required')
  const localPending = new Map()
  let preferredEndpoint = 0

  const call = async (command, parameters = [], timeoutMs = 20_000) => {
    let lastError
    for (let offset = 0; offset < endpoints.length; offset += 1) {
      const index = (preferredEndpoint + offset) % endpoints.length
      try {
        const text = await runProcess(ctlPath, [
          `--rpcserver=${endpoints[index]}`,
          `--timeout=${Math.max(2, Math.ceil(timeoutMs / 1000))}`,
          command,
          ...parameters.map((value) => String(value)),
        ], timeoutMs + 1_000)
        const parsed = JSON.parse(text)
        const responseKey = `${command[0].toLowerCase()}${command.slice(1)}Response`
        const response = parsed[responseKey]
        if (!response) throw new Error(`Nonsense RPC omitted ${responseKey}`)
        if (response.error?.message) throw new Error(response.error.message)
        preferredEndpoint = index
        return response
      } catch (error) {
        lastError = error
      }
    }
    throw new RpcError(`Nonsense RPC unavailable: ${lastError?.message || 'unknown error'}`, { status: 502 })
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

  const mapUtxos = (address, response) => (response.entries ?? []).map((row) => {
    const entry = row.utxoEntry ?? row.utxo_entry ?? {}
    const outpoint = row.outpoint ?? {}
    const script = entry.scriptPublicKey ?? entry.script_public_key ?? {}
    return {
      txid: String(outpoint.transactionId ?? outpoint.transaction_id ?? ''),
      outputIndex: Number(outpoint.index ?? 0),
      script: String(script.scriptPublicKey ?? script.script ?? script.script_public_key ?? ''),
      scriptPublicKeyVersion: Number(script.version ?? 0),
      satoshis: String(entry.amount ?? 0),
      blockDaaScore: String(entry.blockDaaScore ?? entry.block_daa_score ?? 0),
      height: Number(entry.blockDaaScore ?? entry.block_daa_score ?? 0),
      isCoinbase: entry.isCoinbase === true || entry.is_coinbase === true,
      address,
    }
  }).filter((row) => /^[0-9a-f]{64}$/i.test(row.txid) && /^[0-9a-f]+$/i.test(row.script))

  const readUtxos = async (address) => {
    const normalized = normalizeAddress(address)
    if (!isNonsenseAddress(normalized)) throw new RpcError('Invalid Nonsense address', { status: 400 })
    return mapUtxos(normalized, await call('GetUtxosByAddresses', [normalized]))
  }

  const reconcilePending = async (address, utxos) => {
    const confirmedTxids = new Set(utxos.map((row) => row.txid))
    for (const item of activePending(address)) {
      if (confirmedTxids.has(item.txid)) localPending.delete(item.txid)
    }
  }

  const mempoolRows = async (address) => {
    const response = await call('GetMempoolEntriesByAddresses', [address, 'false', 'false']).catch(() => ({ entries: [] }))
    const rows = []
    for (const group of response.entries ?? []) {
      const receiving = group.receiving ?? group.receivingEntries ?? []
      const sending = group.sending ?? group.sendingEntries ?? []
      for (const item of receiving) {
        const entry = item.entry ?? item
        const txid = String(entry.transactionId ?? entry.transaction_id ?? entry.id ?? '')
        if (txid) rows.push({ txid, type: 'incoming', amount: sompiToNnn(item.amount ?? 0), fee: '0', to: address, firstSeen: Math.floor(Date.now() / 1000), confirmations: 0 })
      }
      for (const item of sending) {
        const entry = item.entry ?? item
        const txid = String(entry.transactionId ?? entry.transaction_id ?? entry.id ?? '')
        if (txid) rows.push({ txid, type: 'outgoing', amount: sompiToNnn(item.amount ?? 0), fee: sompiToNnn(entry.fee ?? 0), from: address, firstSeen: Math.floor(Date.now() / 1000), confirmations: 0 })
      }
    }
    return rows
  }

  return {
    coin,
    preserveAtomicBalances: true,

    async getNetwork() {
      const [dag, info, peers] = await Promise.all([
        call('GetBlockDagInfo'),
        call('GetInfo').catch(() => ({})),
        call('GetConnectedPeerInfo').catch(() => ({ infos: [] })),
      ])
      const blocks = Number(dag.blockCount ?? dag.virtualDaaScore ?? 0)
      const headers = Number(dag.headerCount ?? blocks)
      // A two-node bootstrap network can be fully converged while the upstream
      // daemon keeps isSynced=false until a new virtual block is observed. Do
      // not put the wallet into maintenance when the indexed node has a live
      // peer and its complete local DAG is internally caught up.
      const locallyReady = info.isUtxoIndexed === true
        && Array.isArray(peers.infos)
        && peers.infos.length > 0
        && blocks > 0
        && headers >= blocks
      const synchronized = info.isSynced !== false || locallyReady
      return {
        chain: dag.networkName ?? 'nonsense-mainnet',
        blocks,
        headers,
        bestBlockHash: dag.virtualParentHashes?.[0] ?? dag.tipHashes?.[0],
        initialBlockDownload: !synchronized,
        verificationProgress: synchronized ? 1 : 0.5,
        version: info.serverVersion,
      }
    },

    async validateAddress(address) { return { isvalid: isNonsenseAddress(address) } },

    async getBalance(address) {
      const normalized = normalizeAddress(address)
      if (!isNonsenseAddress(normalized)) throw new RpcError('Invalid Nonsense address', { status: 400 })
      const [response, utxos] = await Promise.all([
        call('GetBalanceByAddress', [normalized]),
        readUtxos(normalized),
      ])
      await reconcilePending(normalized, utxos)
      const balance = asBigInt(response.balance)
      const pending = activePending(normalized)
      const outgoing = pending.filter((item) => item.from === normalized).reduce((sum, item) => sum + asBigInt(item.amount) + asBigInt(item.fee), 0n)
      const incoming = pending.filter((item) => item.to === normalized).reduce((sum, item) => sum + asBigInt(item.amount), 0n)
      return {
        balance: balance.toString(),
        balance_spendable: (balance > outgoing ? balance - outgoing : 0n).toString(),
        received: balance.toString(),
        immature: '0',
        pendingIncoming: incoming.toString(),
        pendingOutgoing: outgoing.toString(),
        pendingTxids: pending.map((item) => item.txid),
        pendingOutgoingTxids: pending.filter((item) => item.from === normalized).map((item) => item.txid),
        utxos,
      }
    },

    async getUtxos(address) {
      const normalized = normalizeAddress(address)
      const utxos = await readUtxos(normalized)
      await reconcilePending(normalized, utxos)
      return { address: normalized, utxos }
    },

    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      const normalized = normalizeAddress(address)
      const [utxos, networkPending] = await Promise.all([readUtxos(normalized), mempoolRows(normalized)])
      await reconcilePending(normalized, utxos)
      const confirmed = new Map()
      for (const utxo of utxos) {
        const current = confirmed.get(utxo.txid) ?? { txid: utxo.txid, satoshis: 0n, height: utxo.height }
        current.satoshis += asBigInt(utxo.satoshis)
        current.height = Math.max(current.height, utxo.height)
        confirmed.set(utxo.txid, current)
      }
      const deltas = [...confirmed.values()].map((row) => ({ txid: row.txid, satoshis: row.satoshis.toString(), height: row.height, timestamp: 0 }))
      const local = activePending(normalized).map((item) => ({
        txid: item.txid,
        type: item.from === normalized ? 'outgoing' : 'incoming',
        amount: sompiToNnn(item.amount),
        fee: sompiToNnn(item.fee),
        from: item.from,
        to: item.to,
        firstSeen: Math.floor(item.createdAt / 1000),
        confirmations: 0,
      }))
      const pendingById = new Map([...networkPending, ...local].map((row) => [row.txid, row]))
      const mempool = [...pendingById.values()].map((row) => ({ txid: row.txid, satoshis: (row.type === 'outgoing' ? -nnnToSompi(row.amount) : nnnToSompi(row.amount)).toString(), timestamp: row.firstSeen }))
      const rows = deltas.slice(offset, offset + limit)
      return { address: normalized, txids: [...pendingById.keys(), ...rows.map((row) => row.txid)], deltas: rows, mempool, transactions: [] }
    },

    async getMempool(address) {
      const normalized = normalizeAddress(address)
      const network = await mempoolRows(normalized)
      const local = activePending(normalized).map((item) => ({ txid: item.txid, type: item.from === normalized ? 'outgoing' : 'incoming', amount: sompiToNnn(item.amount), fee: sompiToNnn(item.fee), from: item.from, to: item.to, firstSeen: Math.floor(item.createdAt / 1000), confirmations: 0 }))
      const pending = [...new Map([...network, ...local].map((row) => [row.txid, row])).values()]
      return { address: normalized, hasPendingOutgoing: pending.some((row) => row.type === 'outgoing'), pending }
    },

    async estimateFee() {
      return { coin, feerate: 0.00001, relayFee: 0.00001, source: 'nonsense-relay-floor' }
    },

    async broadcastTx(serializedEnvelope) {
      let envelope
      try { envelope = JSON.parse(serializedEnvelope) } catch { throw new RpcError('Invalid Nonsense transaction envelope', { status: 400 }) }
      if (!envelope.transaction) throw new RpcError('Nonsense transaction is required', { status: 400 })
      const response = await call('SubmitTransaction', [JSON.stringify(envelope.transaction), 'false'], 30_000)
      const txid = String(response.transactionId ?? response.transaction_id ?? envelope.txid ?? '').trim()
      if (!/^[0-9a-f]{64}$/i.test(txid)) throw new RpcError('Nonsense relay returned no valid transaction id', { status: 502 })
      localPending.set(txid, { txid, from: normalizeAddress(envelope.from), to: normalizeAddress(envelope.to), amount: String(envelope.amount ?? 0), fee: String(envelope.fee ?? 0), createdAt: Date.now() })
      return { txid }
    },
  }
}

module.exports = { createNonsenseCtlAdapter }
