'use strict'
const crypto = require('node:crypto')
const {mapConcurrent}=require('../lib/mapConcurrent.cjs')
const utxo = require('@bitgo/utxo-lib')
const { createElectrumClient } = require('../lib/electrumClient.cjs')

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest()
const atoms = value => {
  const text = String(value ?? '')
  if (!/^-?\d+$/.test(text)) throw new Error('Node returned an invalid atomic amount')
  const number = BigInt(text)
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Node atomic amount exceeds exact JSON integer range')
  return number
}
const coinText = (value, decimals) => {
  const n = atoms(value), negative = n < 0n, absolute = negative ? -n : n
  const unit = 10n ** BigInt(decimals)
  const fraction = (absolute % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${absolute / unit}${fraction ? '.'+fraction : ''}`
}
const validTxid = value => /^[0-9a-f]{64}$/i.test(String(value))
const decimalAtoms = (value, decimals) => {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) throw new Error('Node returned an invalid coin amount')
  const shift = decimals + Number(match[4] || 0) - (match[3] || '').length
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 100) throw new Error('Invalid coin precision')
  let n = BigInt(match[2] + (match[3] || ''))
  if (shift >= 0) n *= 10n ** BigInt(shift)
  else {
    const divisor = 10n ** BigInt(-shift)
    if (n % divisor) throw new Error('Node amount has excess decimal precision')
    n /= divisor
  }
  return match[1] ? -n : n
}
const codec = (network, cashaddr = false) => ({
  script(address) {
    if (typeof address !== 'string' || address.length > 160) throw new Error('Invalid address')
    return cashaddr ? utxo.addressFormat.toOutputScriptTryFormats(address, network) : utxo.address.toOutputScript(address, network)
  },
})
const createElectrumProvider = ({ endpoints, codec: addressCodec }) => {
  const call = createElectrumClient(endpoints)
  const scriptHash = address => sha256(addressCodec.script(address)).reverse().toString('hex')
  return {
    async network() {
      const tip = await call('blockchain.headers.subscribe')
      if (!Number.isSafeInteger(tip?.height) || tip.height < 1 || !/^[0-9a-f]+$/i.test(tip.hex)) throw new Error('Incomplete node header response')
      return { blocks: tip.height, headers: tip.height, initialBlockDownload: false, verificationProgress: 1,
        bestBlockHash: sha256(sha256(Buffer.from(tip.hex, 'hex'))).reverse().toString('hex') }
    },
    balance: address => call('blockchain.scripthash.get_balance', [scriptHash(address)]),
    utxos: address => call('blockchain.scripthash.listunspent', [scriptHash(address)]),
    history: address => call('blockchain.scripthash.get_history', [scriptHash(address)]),
    transaction: txid => call('blockchain.transaction.get', [txid, true]),
    rawTransaction: txid => call('blockchain.transaction.get', [txid, false]),
    fee: blocks => call('blockchain.estimatefee', [blocks]),
    broadcast: hex => call('blockchain.transaction.broadcast', [hex], { write: true }),
  }
}
const createBlockbookProvider = ({ baseUrls, decimals }) => {
  let preferred = 0
  const read = async (route, options = {}) => {
    const start = preferred
    let error
    for (let attempt = 0; attempt < (options.method === 'POST' ? 1 : baseUrls.length); attempt++) {
      const index = (start + attempt) % baseUrls.length
      try {
        const response = await fetch(baseUrls[index].replace(/\/$/, '')+route, { ...options, signal: AbortSignal.timeout(9000) })
        if (!response.ok) throw new Error(`Remote Blockbook HTTP ${response.status}`)
        const body = await response.json()
        if (body.error) throw new Error('Remote Blockbook error')
        preferred = index; return body
      } catch (e) { error = e }
    }
    throw error
  }
  return {
    async network() {
      const result = await read('')
      if (!result.blockbook || !result.backend || !Number.isSafeInteger(result.blockbook.bestHeight)) throw new Error('Incomplete Blockbook network status')
      if (result.blockbook.decimals !== decimals) throw new Error('Node decimal precision does not match this coin')
      return { blocks: result.blockbook.bestHeight, headers: result.backend.blocks,
        initialBlockDownload: result.blockbook.initialSync === true || result.blockbook.inSync !== true,
        verificationProgress: result.blockbook.inSync === true ? 1 : 0,
        bestBlockHash: result.backend.bestBlockHash, version: result.backend.version }
    },
    async balance(address) {
      const r = await read('/address/'+encodeURIComponent(address)+'?details=basic')
      return { confirmed: r.balance, unconfirmed: r.unconfirmedBalance }
    },
    async utxos(address) {
      const rows = await read('/utxo/'+encodeURIComponent(address))
      if (!Array.isArray(rows)) throw new Error('Node omitted UTXO list')
      return rows.map(r => ({ tx_hash: r.txid, tx_pos: r.vout, value: r.value, height: r.height || 0, coinbase: r.coinbase, confirmations: r.confirmations }))
    },
    async history(address, limit, offset) {
      const r = await read('/address/'+encodeURIComponent(address)+`?details=txids&page=${Math.floor(offset / limit) + 1}&pageSize=${limit}`)
      return (r.txids || []).map(tx_hash => ({ tx_hash }))
    },
    transaction: txid => read('/tx/'+txid),
    async rawTransaction(txid) { const tx=await read('/tx-specific/'+txid); return tx.hex },
    async fee(blocks) { const r = await read('/estimatefee/'+blocks); return r.result },
    async broadcast(hex) { const r = await read('/sendtx/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: hex }); return r.result },
    blockbook: true,
  }
}
const createRemoteUtxoAdapter = ({ coin, network, decimals = 8, cashaddr = false, endpoints, baseUrls, minimumFee, maturity = 100, provider: injectedProvider }) => {
  const addressCodec = codec(network, cashaddr)
  const provider = injectedProvider || (baseUrls ? createBlockbookProvider({ baseUrls, decimals }) : createElectrumProvider({ endpoints, codec: addressCodec }))
  const transactionCache = new Map(), transactionPending = new Map()
  const transaction = async txid => {
    if (!validTxid(txid)) throw new Error('Invalid transaction id')
    const cached = transactionCache.get(txid)
    if (cached && cached.expires > Date.now()) return cached.value
    if(transactionPending.has(txid))return transactionPending.get(txid)
    const operation=(async()=>{
    const value = await provider.transaction(txid)
    if (!Array.isArray(value?.vin) || !Array.isArray(value?.vout)) throw new Error('Node omitted transaction inputs or outputs')
    if (transactionCache.size >= 1000) transactionCache.delete(transactionCache.keys().next().value)
    transactionCache.set(txid, { value, expires: Date.now()+30_000 })
    return value
    })()
    transactionPending.set(txid,operation)
    try{return await operation}finally{transactionPending.delete(txid)}
  }
  const validated = address => { addressCodec.script(address); return address }
  const readUtxos = async address => {
    const rows = await provider.utxos(validated(address))
    if (!Array.isArray(rows)) throw new Error('Node omitted UTXO list')
    const script = addressCodec.script(address).toString('hex')
    const tip = rows.some(row => row.confirmations === undefined) ? await provider.network() : null
    return mapConcurrent(rows,4,async row => {
      if (!validTxid(row.tx_hash) || !Number.isSafeInteger(row.tx_pos) || row.tx_pos < 0) throw new Error('Node returned invalid UTXO outpoint')
      const value = atoms(row.value)
      if (value < 0n) throw new Error('Node returned a negative UTXO')
      const height = Number(row.height || 0)
      const confirmations = row.confirmations ?? (height > 0 ? Math.max(0, tip.blocks-height+1) : 0)
      if (!Number.isSafeInteger(confirmations) || confirmations < 0) throw new Error('Node returned invalid confirmations')
      let isCoinbase = row.coinbase === true, isCoinstake = row.coinstake === true
      if (confirmations < maturity && (row.coinbase === undefined || (coin === 'peercoin' && row.coinstake === undefined))) {
        const tx = await transaction(row.tx_hash)
        isCoinbase = tx.vin.some(input => Boolean(input.coinbase) || /^0{64}$/.test(input.txid || ''))
        // Peercoin coinstake transactions start with an empty, zero-value output.
        isCoinstake = coin === 'peercoin' && tx.vout.length > 1 &&
          (tx.vout[0].hex === '' || tx.vout[0].scriptPubKey?.hex === '' || (provider.blockbook && tx.vout[0].isAddress === false && !tx.vout[0].addresses?.length)) && Number(tx.vout[0].value) === 0
      }
      const immature = (isCoinbase || isCoinstake) && confirmations < maturity
      return { txid: row.tx_hash, outputIndex: row.tx_pos, satoshis: value.toString(), script, address,
        height, confirmations, isCoinbase, isCoinstake, immature, spendable: confirmations > 0 && !immature }
    })
  }
  return {
    coin, preserveAtomicBalances: true,
    authoritativeBalance: true,
    async getNetwork() { return { chain: `${coin}-mainnet`, ...await provider.network() } },
    async getRawTransaction(txid) {
      if(!validTxid(txid))throw new Error('Invalid transaction id')
      const hex=await provider.rawTransaction(txid)
      if(typeof hex!=='string'||!/^(?:[0-9a-f]{2})+$/i.test(hex)||hex.length>8000000)throw new Error('Node omitted the raw transaction proof')
      return hex
    },
    async validateAddress(address) { try { validated(address); return { isvalid: true } } catch { return { isvalid: false } } },
    async getUtxos(address) { return { address, utxos: (await readUtxos(address)).filter(u => u.spendable) } },
    async getBalance(address) {
      validated(address)
      const [r, rows] = await Promise.all([provider.balance(address), readUtxos(address)])
      const confirmed = atoms(r.confirmed), pending = atoms(r.unconfirmed)
      if (confirmed < 0n) throw new Error('Node returned a negative confirmed balance')
      const immature = rows.filter(u => u.immature).reduce((s, u) => s+atoms(u.satoshis), 0n)
      const spendable = rows.filter(u => u.spendable).reduce((s, u) => s+atoms(u.satoshis), 0n)
      return { balance: confirmed.toString(), balance_spendable: (spendable > 0n ? spendable : 0n).toString(),
        received: confirmed.toString(), immature: immature.toString(), pendingIncoming: (pending > 0n ? pending : 0n).toString(),
        pendingOutgoing: (pending < 0n ? -pending : 0n).toString(), utxos: rows }
    },
    async getHistory(address, { limit = 25, offset = 0 } = {}) {
      validated(address)
      const history = await provider.history(address, limit, offset)
      if (!Array.isArray(history)) throw new Error('Node omitted transaction history')
      const rows = provider.blockbook ? history : history.slice().reverse().slice(offset, offset+limit)
      const transactions = [], deltas = []
      for (const row of rows) {
        if (!validTxid(row.tx_hash)) throw new Error('Node returned invalid transaction id')
        const tx = await transaction(row.tx_hash)
        const ownScript = addressCodec.script(address).toString('hex')
        const matches = addresses => (addresses || []).some(a => { try { return addressCodec.script(a).toString('hex') === ownScript } catch { return false } })
        let incoming = 0n, outgoing = 0n
        for (const output of tx.vout || []) {
          if (matches(output.addresses || output.scriptPubKey?.addresses) || output.scriptPubKey?.hex === ownScript) {
            const value = provider.blockbook ? atoms(output.value) : decimalAtoms(output.value, decimals)
            incoming += value
          }
        }
        // Blockbook includes previous input values. Electrum prevouts are fetched
        // explicitly so outgoing history is never guessed from current UTXOs.
        for (const input of tx.vin || []) {
          if (input.coinbase) continue
          if (provider.blockbook) { if (matches(input.addresses)) outgoing += atoms(input.value) }
          else if (input.txid && Number.isSafeInteger(input.vout)) {
            const prev = await transaction(input.txid), output = prev.vout?.[input.vout]
            if (output?.scriptPubKey?.hex === ownScript || matches(output?.scriptPubKey?.addresses)) outgoing += decimalAtoms(output.value, decimals)
          }
        }
        deltas.push({ txid: row.tx_hash, satoshis: (incoming-outgoing).toString(), height: row.height || tx.blockHeight || 0, timestamp: tx.blockTime || tx.blocktime || tx.time || 0 })
      }
      return { address, txids: rows.map(r => r.tx_hash), deltas: deltas.filter(r => r.height > 0), mempool: deltas.filter(r => r.height <= 0), transactions }
    },
    async estimateFee(blocks = 6) {
      const value = Number(await provider.fee(blocks))
      if (!Number.isFinite(value) || value < 0) {
        if (minimumFee === undefined) throw new Error('Node cannot estimate the fee')
        return { feerate: minimumFee, relayFee: minimumFee }
      }
      return { feerate: Math.max(value, minimumFee || 0), relayFee: minimumFee || 0 }
    },
    async broadcastTx(hex) {
      if (typeof hex !== 'string' || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 || hex.length > 8_000_000) throw new Error('Invalid transaction encoding')
      const txid = await provider.broadcast(hex)
      if (!validTxid(txid)) throw new Error('Node omitted transaction id; broadcast outcome is unknown')
      return { txid }
    },
  }
}
module.exports = { createRemoteUtxoAdapter, createBlockbookProvider, createElectrumProvider, atoms, coinText, decimalAtoms }
