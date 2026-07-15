/**
 * Multi-coin API client for api.altbase.io.
 *
 * Endpoint shape (one per coin):
 *   GET  /api/v1/<coin>/network
 *   GET  /api/v1/<coin>/fee/estimate?blocks=N
 *   POST /api/v1/<coin>/validate            body: { address }
 *   POST /api/v1/<coin>/address/balance     body: { address }
 *   POST /api/v1/<coin>/address/utxos       body: { address }
 *   POST /api/v1/<coin>/address/history     body: { address, limit? }
 *   POST /api/v1/<coin>/tx/broadcast        body: { hex }
 */

import type { CoinStatus } from '../types/coin'
import type { Transaction } from '../types/transaction'
import { storageService } from './storageService'
import { nativeCoreService } from './nativeCoreService'
import { coinDebugLog, coinDebugLogError, quaiDebugLog, quaiDebugLogError } from '../utils/quaiDebugLog'
import { fromBaseUnits } from '../utils/decimalAmount'
import { coinDecimalsFromSats, coinValueToUnits } from '../utils/transactionAmounts'
import { resolveTransactionConfirmations } from '../utils/transactionConfirmations'

const API_BASE = 'https://api.altbase.io/api/v1'

const hasCoinSnapshotRequest = (request: WalletSnapshotRequest, coinId: string) =>
  Array.isArray(request.coins) && request.coins.some((item) => item.coin === coinId)

const hasQuaiSnapshotRequest = (request: WalletSnapshotRequest) => hasCoinSnapshotRequest(request, 'quai')
const hasPearlSnapshotRequest = (request: WalletSnapshotRequest) => hasCoinSnapshotRequest(request, 'pearl')

const summarizeCoinSnapshot = (response: WalletSnapshotResponse, coinId: string) => {
  const coin = response.coins?.[coinId]
  if (!coin) return null
  const balances = Object.fromEntries(Object.entries(coin.balances ?? {}).map(([address, balance]) => [
    address,
    balance
      ? {
          balance: balance.balance,
          spendable: balance.balance_spendable,
          pendingIncoming: balance.pendingIncoming,
          pendingOutgoing: balance.pendingOutgoing,
          pendingTxids: balance.pendingTxids,
          pendingOutgoingTxids: balance.pendingOutgoingTxids,
        }
      : null,
  ]))
  const histories = Object.fromEntries(Object.entries(coin.histories ?? {}).map(([address, history]) => [
    address,
    history
      ? {
          txids: history.txids?.slice(0, 5),
          deltaCount: history.deltas?.length ?? 0,
          mempoolCount: history.mempool?.length ?? 0,
          txCount: history.transactions?.length ?? 0,
          firstDeltas: history.deltas?.slice(0, 5),
        }
      : null,
  ]))
  return {
    walletBalance: coin.walletBalance
      ? {
          balance: coin.walletBalance.balance,
          spendable: coin.walletBalance.balance_spendable,
          pendingIncoming: coin.walletBalance.pendingIncoming,
          pendingOutgoing: coin.walletBalance.pendingOutgoing,
          pendingTxids: coin.walletBalance.pendingTxids,
          pendingOutgoingTxids: coin.walletBalance.pendingOutgoingTxids,
        }
      : null,
    balances,
    histories,
    errors: coin.errors,
  }
}

const summarizeQuaiSnapshot = (response: WalletSnapshotResponse) => summarizeCoinSnapshot(response, 'quai')
const summarizePearlSnapshot = (response: WalletSnapshotResponse) => summarizeCoinSnapshot(response, 'pearl')

/* ───── chain network ───── */

export type CoinNetwork = {
  ok: true
  coin: string
  chain: string
  blocks: number
  headers: number
  bestBlockHash?: string
  difficulty?: number
  initialBlockDownload?: boolean
  verificationProgress?: number
  connections?: number
  version?: number | string
  subversion?: string
  relayFee?: number
  mempoolSize?: number
}

export const networkToStatus = (
  n: Pick<CoinNetwork, 'initialBlockDownload' | 'verificationProgress' | 'blocks' | 'headers'>,
): CoinStatus => {
  // Keep active badges calm, but do not allow a clearly lagging daemon to
  // look send-ready while it is still far behind the known header chain.
  if (n.initialBlockDownload === true) return 'syncing'
  const blocks = Number(n.blocks ?? 0)
  const headers = Number(n.headers ?? 0)
  const progress = Number(n.verificationProgress ?? 1)
  if (
    headers > 0
    && blocks > 0
    && headers - blocks > 100
    && Number.isFinite(progress)
    && progress < 0.995
  ) {
    return 'syncing'
  }
  return 'active'
}

/* ───── balances / utxos ───── */

export type CoinBalance = {
  balance: number | string              // atomic units
  balance_spendable: number | string
  received: number | string
  immature: number | string
  pendingIncoming?: number | string
  pendingOutgoing?: number | string
  mempoolNet?: number | string
  pendingTxids?: string[]
  pendingOutgoingTxids?: string[]
  pendingTransactions?: AddressMempoolPending[]
  utxos?: Utxo[]
}

export const atomicAmountToBigInt = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  return 0n
}

export type Utxo = {
  txid: string
  outputIndex: number
  script: string
  satoshis: number | string
  height?: number
  address?: string
  blockDaaScore?: number | string
  isCoinbase?: boolean
  scriptPublicKeyVersion?: number
  cellOutput?: {
    capacity: string
    lock: { codeHash: string; hashType: 'data' | 'type' | 'data1'; args: string }
    type?: { codeHash: string; hashType: 'data' | 'type' | 'data1'; args: string }
  }
  outputData?: string
  blockNumber?: string
  txIndex?: string
}

/* ───── raw tx (shape varies per coin, we extract what we need) ───── */

type AtomicAmount = number | string
type RawTxVout = { value: AtomicAmount; n: number; scriptPubKey?: { address?: string; addresses?: string[] } }
type RawTxVin  = { txid?: string; vout?: number; address?: string; value?: AtomicAmount; coinbase?: string }
type RawTx     = {
  txid: string
  hash?: string
  status?: string
  size?: number
  vin?: RawTxVin[]
  vout?: RawTxVout[]
  blocktime?: number
  time?: number
  confirmations?: number
  /** Computed by the gateway: sum(vin.value) − sum(vout.value) in coin units. */
  fee?: AtomicAmount
  error?: string
}

type AddressDelta = { txid: string; satoshis: AtomicAmount; height?: number; timestamp?: number }
type MempoolDelta = { txid: string; satoshis: AtomicAmount; timestamp?: number }

export type HistoryResponse = {
  ok: true
  address: string
  txids?: string[]
  deltas?: AddressDelta[]
  mempool?: MempoolDelta[]
  transactions?: RawTx[]
}

export type AddressMempoolPending = {
  txid: string
  type: 'incoming' | 'outgoing'
  amount: string
  fee?: string
  from?: string
  to?: string
  firstSeen?: number
  confirmations?: number
}

export type AddressMempoolResponse = {
  address: string
  hasPendingOutgoing: boolean
  pending: AddressMempoolPending[]
}

export type FeeRateInfo = {
  feerate: number
  relayFee?: number
  source?: string
  coin: string
}

export type AccountFeeEstimate = {
  coin: string
  fee: string
  feeSatoshis: number
  gasLimit: string
  gasPrice: string
  gasPriceHex?: string
  chainId?: number | string
  source?: string
}

export type AccountTxContext = AccountFeeEstimate & {
  from: string
  to?: string
  nonce: number
  targetTick?: number
}

export type WalletSnapshotRequest = {
  coins: Array<{ coin: string; addresses: string[] }>
  historyLimit?: number
  historyOffset?: number
  includeNetwork?: boolean
  includeBalances?: boolean
  includeHistory?: boolean
  forceBalances?: boolean
  historyUtxoOverlay?: boolean
  expandAddresses?: boolean
}

export type WalletSnapshotCoin = {
  coin: string
  network: CoinNetwork | null
  walletBalance?: CoinBalance | null
  balances: Record<string, CoinBalance | null>
  histories: Record<string, HistoryResponse | null>
  errors?: Record<string, string>
}

export type WalletSnapshotResponse = {
  prices: Record<string, number>
  pricesUpdatedAt: number | null
  coins: Record<string, WalletSnapshotCoin>
}

export type PrivacyCacheEnvelope = {
  encryptedBlob: string
  nonce?: string
}

export type ZanoTransactionStatus = {
  found: boolean
  confirmed: boolean
  blockHeight?: number
  timestamp?: number
}

/* ───── HTTP layer ───── */

type GatewayErrorPayload = { ok?: boolean; error?: string; message?: string }
type GatewayError = Error & { status?: number; retryAfterMs?: number }

const RATE_LIMIT_RETRIES_MS = [750, 1_500, 3_000, 6_000]
const FEE_CACHE_MS = 5 * 60_000
const FEE_CACHE_STORAGE_KEY = 'networkFeeCache:v2'
const pendingRequests = new Map<string, Promise<unknown>>()
const feeRateCache = new Map<string, { expiresAt: number; value: FeeRateInfo }>()
const accountFeeCache = new Map<string, { expiresAt: number; value: AccountFeeEstimate }>()
const utxoCache = new Map<string, { expiresAt: number; value: Utxo[] }>()
const walletSnapshotCache = new Map<string, { expiresAt: number; value: WalletSnapshotResponse }>()

const fallbackAccountFeeEstimate = (coinId: string): AccountFeeEstimate | null => {
  if (coinId !== 'quai') return null
  return {
    coin: coinId,
    fee: '0.96',
    feeSatoshis: 96_000_000,
    gasLimit: '80000',
    gasPrice: '12000000000000',
    gasPriceHex: '0xae9f7bcc000',
    chainId: 9,
    source: 'client-fallback',
  }
}

type StoredFeeCache = {
  feeRates?: Record<string, { expiresAt: number; value: FeeRateInfo }>
  accountFees?: Record<string, { expiresAt: number; value: AccountFeeEstimate }>
}

const hydrateFeeCaches = () => {
  const now = Date.now()
  const stored = storageService.get<StoredFeeCache>(FEE_CACHE_STORAGE_KEY, {})
  for (const [key, entry] of Object.entries(stored.feeRates ?? {})) {
    if (entry?.expiresAt > now && entry.value) feeRateCache.set(key, entry)
  }
  for (const [key, entry] of Object.entries(stored.accountFees ?? {})) {
    if (entry?.expiresAt > now && entry.value) accountFeeCache.set(key, entry)
  }
}

const persistFeeCaches = () => {
  try {
    storageService.set<StoredFeeCache>(FEE_CACHE_STORAGE_KEY, {
      feeRates: Object.fromEntries(feeRateCache),
      accountFees: Object.fromEntries(accountFeeCache),
    })
  } catch {
    // The in-memory cache still works if localStorage is unavailable/full.
  }
}

hydrateFeeCaches()

const clearUtxoCache = (coinId?: string, address?: string) => {
  if (!coinId) {
    utxoCache.clear()
    return
  }
  const prefix = `${coinId}:`
  for (const key of Array.from(utxoCache.keys())) {
    if (address ? key === `${coinId}:${address}` : key.startsWith(prefix)) utxoCache.delete(key)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const retryAfterMs = (headers: Headers): number | undefined => {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(raw)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined
}

const isRateLimited = (error: unknown) => {
  if (!(error instanceof Error)) return false
  const gatewayError = error as GatewayError
  return gatewayError.status === 429 || /rate.?limit|too many requests/i.test(error.message)
}

const isNoAddressInfo = (error: unknown) =>
  error instanceof Error && /no information available for address/i.test(error.message)

const normalizeNetworkError = (error: unknown, timeoutMs: number) => {
  if (!(error instanceof Error)) return error
  if (error.name === 'AbortError' || /aborted|signal is aborted/i.test(error.message)) {
    return new Error(`API request timed out after ${Math.round(timeoutMs / 1000)}s. Please try again.`)
  }
  if (/failed to fetch/i.test(error.message)) {
    return new Error('API request failed. Please check the coin node connection and try again.')
  }
  return error
}

const requestKeyFor = (url: string, init: RequestInit) =>
  `${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`

const fetchJsonOnce = async <T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> => {
  const controller = timeoutMs > 0 ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  try {
    const r = await fetch(url, { ...init, signal: controller?.signal })
    const text = await r.text()
    const data = (text ? JSON.parse(text) : {}) as T & GatewayErrorPayload
    if (!r.ok || data.ok === false) {
      const error = new Error(data.error ?? data.message ?? `HTTP ${r.status}`) as GatewayError
      error.status = r.status
      error.retryAfterMs = retryAfterMs(r.headers)
      throw error
    }
    return data
  } catch (error) {
    throw normalizeNetworkError(error, timeoutMs)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const fetchJsonWithTimeout = async <T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> => {
  const key = `${timeoutMs} ${requestKeyFor(url, init)}`
  const pending = pendingRequests.get(key)
  if (pending) return pending as Promise<T>

  const request = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES_MS.length; attempt++) {
      try {
        return await fetchJsonOnce<T>(url, init, timeoutMs)
      } catch (error) {
        lastError = error
        if (!isRateLimited(error) || attempt === RATE_LIMIT_RETRIES_MS.length) break
        const gatewayError = error as GatewayError
        await sleep(gatewayError.retryAfterMs ?? RATE_LIMIT_RETRIES_MS[attempt])
      }
    }
    if (isRateLimited(lastError)) {
      throw new Error('API rate limit exceeded. Please wait a few seconds and try again.')
    }
    throw lastError
  })().finally(() => {
    pendingRequests.delete(key)
  })

  pendingRequests.set(key, request)
  return request
}

const coinNodeJsonWithTimeout = async <T>(
  coinId: string,
  path: string,
  method: 'GET' | 'POST',
  body = '',
  timeoutMs = 10_000,
): Promise<T> => {
  const key = `node ${timeoutMs} ${coinId} ${method} ${path} ${body}`
  const pending = pendingRequests.get(key)
  if (pending) return pending as Promise<T>

  const request = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES_MS.length; attempt += 1) {
      try {
        const response = await nativeCoreService.coinNodeRequest({ coinId, method, path, body, timeoutMs })
        let data: T & GatewayErrorPayload
        try {
          data = (response.body ? JSON.parse(response.body) : {}) as T & GatewayErrorPayload
        } catch {
          throw new Error(`Node module returned invalid JSON (HTTP ${response.status})`)
        }
        if (response.status < 200 || response.status >= 300 || data.ok === false) {
          const error = new Error(data.error ?? data.message ?? `HTTP ${response.status}`) as GatewayError
          error.status = response.status
          throw error
        }
        return data
      } catch (error) {
        lastError = normalizeNetworkError(error, timeoutMs)
        if (!isRateLimited(lastError) || attempt === RATE_LIMIT_RETRIES_MS.length) break
        await sleep(RATE_LIMIT_RETRIES_MS[attempt])
      }
    }
    if (isRateLimited(lastError)) {
      throw new Error('API rate limit exceeded. Please wait a few seconds and try again.')
    }
    throw lastError
  })().finally(() => {
    pendingRequests.delete(key)
  })

  pendingRequests.set(key, request)
  return request
}

const postJson = <T>(coinId: string, path: string, body: unknown, timeoutMs = 10_000) =>
  coinNodeJsonWithTimeout<T>(coinId, path, 'POST', JSON.stringify(body), timeoutMs)

const getJson = <T>(coinId: string, path: string, timeoutMs = 10_000) =>
  coinNodeJsonWithTimeout<T>(coinId, path, 'GET', '', timeoutMs)

const getGlobal = <T>(path: string) =>
  fetchJsonWithTimeout<T>(`${API_BASE}${path}`)

const postGlobal = <T>(path: string, body: unknown, timeoutMs = 10_000) =>
  fetchJsonWithTimeout<T>(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs)

/* ───── transaction mapper ───── */

/**
 * Convert a raw bitcoin-fork transaction (with vin.value + vin.address
 * pre-resolved by the gateway) into a wallet-friendly Transaction row.
 *
 * Key invariants:
 *   • The `amount` is the value that actually changed hands with the OTHER
 *     party — for outgoing sends we deliberately exclude change-output back
 *     to our own address, so a "send 11" tx shows as "11 sent", not as the
 *     change residue.
 *   • Tx type follows the net signed delta: if the user spent more than
 *     they received in this tx (i.e. some inputs were theirs), it's outgoing.
 *   • The `fee` is what the gateway computed (sum vin − sum vout), or
 *     falls back to undefined when the gateway couldn't resolve every input.
 */
export const mapRawTxToTransaction = (
  raw: RawTx,
  ownAddress: string,
  satoshis: AtomicAmount | bigint, // net delta in atomic units from getaddressdeltas (signed)
  coinId: string,
  satsPerCoin: number,
  status: Transaction['status'],
  walletAddresses: string[] = [ownAddress],
  meta: { timestamp?: number; height?: number; tipHeight?: number } = {},
): Transaction => {
  const decimals = coinDecimalsFromSats(satsPerCoin)
  const deltaUnits = atomicAmountToBigInt(satoshis)
  const ownAddressSet = new Set(walletAddresses.filter(Boolean))
  const isOwnAddress = (address?: string) => Boolean(address && ownAddressSet.has(address))
  const outputAddress = (output: RawTxVout) => output.scriptPubKey?.address ?? output.scriptPubKey?.addresses?.[0]
  const vinAddrs = (raw.vin ?? [])
    .map((i) => i.address)
    .filter(Boolean) as string[]
  const hasOwnInput = vinAddrs.some(isOwnAddress)
  const type: Transaction['type'] = hasOwnInput || deltaUnits < 0n ? 'outgoing' : 'incoming'

  // Sum of outputs paying THIS address — used as the "received amount"
  // on incoming txs (the gateway's net delta already gives this, but doing
  // it from raw vouts avoids needing the delta for some code paths).
  const valueToSelf = (raw.vout ?? []).reduce((sum, o) => {
    const addr = outputAddress(o)
    return isOwnAddress(addr) ? sum + coinValueToUnits(o.value, decimals) : sum
  }, 0n)
  const ownOutputs = (raw.vout ?? []).filter((output) => isOwnAddress(outputAddress(output)))

  // Sum of outputs paying SOMEONE ELSE — the actual transfer amount on a send.
  const valueToOthers = (raw.vout ?? []).reduce((sum, o) => {
    const addr = outputAddress(o)
    return addr && !isOwnAddress(addr) ? sum + coinValueToUnits(o.value, decimals) : sum
  }, 0n)

  let amountUnits: bigint
  if (type === 'outgoing') {
    // Prefer "sent to other parties" — that's what the user typed in the form.
    // Fall back to |net delta| when the raw tx is missing or all outputs went to self.
    const selfSendAmount = hasOwnInput && valueToOthers === 0n && ownOutputs.length > 1
      ? coinValueToUnits(ownOutputs[0]?.value, decimals)
      : 0n
    amountUnits = valueToOthers > 0n ? valueToOthers : (selfSendAmount > 0n ? selfSendAmount : (deltaUnits < 0n ? -deltaUnits : deltaUnits))
  } else {
    amountUnits = valueToSelf > 0n ? valueToSelf : (deltaUnits > 0n ? deltaUnits : 0n)
  }
  const amount = fromBaseUnits(amountUnits, decimals)

  // Counter-party address: for outgoing pick the first non-self output;
  // for incoming pick the first non-self vin (the gateway pre-fills it).
  let from: string | undefined
  let to: string | undefined
  const voutAddrs = (raw.vout ?? [])
    .map(outputAddress)
    .filter(Boolean) as string[]
  if (type === 'outgoing') {
    from = vinAddrs.find(isOwnAddress) ?? ownAddress
    to = voutAddrs.find((a) => !isOwnAddress(a)) ?? voutAddrs.find((a) => a !== from) ?? voutAddrs[0]
  } else {
    to = ownAddress
    from = vinAddrs.find((a) => !isOwnAddress(a)) ?? vinAddrs[0]
  }

  const vinValue = (raw.vin ?? []).reduce((sum, input) => sum + coinValueToUnits(input.value, decimals), 0n)
  const voutValue = (raw.vout ?? []).reduce((sum, output) => sum + coinValueToUnits(output.value, decimals), 0n)
  const inferredFee = vinValue > voutValue && voutValue > 0n ? vinValue - voutValue : 0n
  const explicitFee = coinValueToUnits(raw.fee, decimals)
  const feeUnits = explicitFee > 0n ? explicitFee : inferredFee
  const fee = feeUnits > 0n ? fromBaseUnits(feeUnits, decimals) : undefined

  // Stable timestamp: blocktime for confirmed, server-supplied time for
  // mempool, and a fall-back of "now" only as a last resort. The CALLER
  // must keep using the FIRST createdAt it ever saw for this txid so the
  // list doesn't reorder when the same tx flips from pending→confirmed.
  const ts = raw.blocktime ?? raw.time ?? meta.timestamp ?? Math.floor(Date.now() / 1000)
  const resolvedStatus = raw.status === 'failed' || raw.status === 'error' ? 'failed' : status

  const confirmations = resolveTransactionConfirmations(
    resolvedStatus,
    raw.confirmations,
    meta.height,
    meta.tipHeight,
  )

  return {
    id: `${coinId}-${raw.txid}`,
    coinId,
    type,
    amount,
    fee,
    status: resolvedStatus,
    txHash: raw.txid,
    from,
    to,
    internal: type === 'outgoing' && Boolean(to && isOwnAddress(to)),
    createdAt: new Date(ts * 1000).toISOString(),
    confirmations,
    blockHeight: meta.height,
  }
}

export const mapHistoryResponseToTransactions = (
  history: HistoryResponse,
  coinId: string,
  address: string,
  satsPerCoin: number,
  walletAddresses: string[] = [address],
  tipHeight?: number,
): Transaction[] => {
  const hasPagedTxids = Array.isArray(history.txids)
  const pageTxids = new Set((history.txids ?? []).map((txid) => txid.trim().toLowerCase()).filter(Boolean))
  const belongsToPage = (txid: string) => !hasPagedTxids || pageTxids.has(txid.trim().toLowerCase())
  const ownAddressSet = new Set(walletAddresses.filter(Boolean))
  const rawTouchesWallet = (raw: RawTx | undefined) => {
    if (!raw) return true
    const vinTouches = (raw.vin ?? []).some((input) => Boolean(input.address && ownAddressSet.has(input.address)))
    const voutTouches = (raw.vout ?? []).some((output) => {
      const addresses = [
        output.scriptPubKey?.address,
        ...(output.scriptPubKey?.addresses ?? []),
      ].filter(Boolean) as string[]
      return addresses.some((item) => ownAddressSet.has(item))
    })
    return vinTouches || voutTouches
  }

  const rawByTxid = new Map<string, RawTx>()
  for (const t of history.transactions ?? []) {
    if (t?.txid && belongsToPage(t.txid)) rawByTxid.set(t.txid, t)
  }

  const pendingByTxid = new Map<string, { sats: bigint; ts?: number }>()
  for (const m of history.mempool ?? []) {
    if (!belongsToPage(m.txid)) continue
    const cur = pendingByTxid.get(m.txid) ?? { sats: 0n, ts: m.timestamp }
    cur.sats += atomicAmountToBigInt(m.satoshis)
    pendingByTxid.set(m.txid, cur)
  }

  const confirmedByTxid = new Map<string, { sats: bigint; height?: number; ts?: number }>()
  for (const d of history.deltas ?? []) {
    if (!belongsToPage(d.txid)) continue
    const cur = confirmedByTxid.get(d.txid) ?? { sats: 0n, height: d.height, ts: d.timestamp }
    cur.sats += atomicAmountToBigInt(d.satoshis)
    cur.height ??= d.height
    cur.ts ??= d.timestamp
    confirmedByTxid.set(d.txid, cur)
  }

  const rows: Transaction[] = []
  for (const [txid, item] of pendingByTxid) {
    const raw = rawByTxid.get(txid) ?? { txid }
    if (!rawTouchesWallet(rawByTxid.get(txid))) continue
    rows.push(mapRawTxToTransaction(raw, address, item.sats, coinId, satsPerCoin, 'pending', walletAddresses, {
      timestamp: item.ts,
      tipHeight,
    }))
  }
  for (const [txid, item] of confirmedByTxid) {
    const raw = rawByTxid.get(txid) ?? { txid }
    if (!rawTouchesWallet(rawByTxid.get(txid))) continue
    rows.push(mapRawTxToTransaction(raw, address, item.sats, coinId, satsPerCoin, 'confirmed', walletAddresses, {
      height: item.height,
      timestamp: item.ts,
      tipHeight,
    }))
  }
  const byHash = new Map<string, Transaction>()
  for (const row of rows) {
    const prev = byHash.get(row.txHash)
    if (!prev || (prev.status === 'pending' && row.status === 'confirmed')) {
      byHash.set(row.txHash, row)
    }
  }
  return Array.from(byHash.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/* ───── public API ───── */

export const coinApiService = {
  /** Public chain lookup used to reconcile outgoing transactions missing from native history. */
  async getZanoTransactionStatus(txid: string): Promise<ZanoTransactionStatus> {
    const normalizedTxid = txid.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(normalizedTxid)) {
      return { found: false, confirmed: false }
    }

    const response = await coinNodeJsonWithTimeout<{
      error?: { code?: number; message?: string }
      result?: {
        status?: string
        tx_info?: {
          id?: string
          keeper_block?: number | string
          timestamp?: number | string
        }
      }
    }>('zano', '/json_rpc', 'POST', JSON.stringify({
        jsonrpc: '2.0',
        id: 'altbase-zano-tx-status',
        method: 'get_tx_details',
        params: { tx_hash: normalizedTxid },
      }), 15_000)

    const txInfo = response.result?.tx_info
    const responseTxid = String(txInfo?.id ?? '').trim().toLowerCase()
    if (
      response.result?.status !== 'OK'
      || !txInfo
      || (responseTxid !== '' && responseTxid !== normalizedTxid)
    ) {
      return { found: false, confirmed: false }
    }

    const blockHeight = Number(txInfo.keeper_block ?? 0)
    const timestamp = Number(txInfo.timestamp ?? 0)
    const confirmed = Number.isFinite(blockHeight) && blockHeight > 0
    return {
      found: true,
      confirmed,
      blockHeight: confirmed ? Math.floor(blockHeight) : undefined,
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : undefined,
    }
  },

  /** Raw network state. */
  async getNetwork(coinId: string): Promise<CoinNetwork> {
    return getJson<CoinNetwork>(coinId, '/network')
  },

  /** Non-throwing version. */
  async tryGetNetwork(coinId: string): Promise<CoinNetwork | null> {
    try { return await this.getNetwork(coinId) } catch { return null }
  },

  /** Status bucket for the dashboard. */
  async getStatus(coinId: string): Promise<CoinStatus> {
    const net = await this.tryGetNetwork(coinId)
    return net ? networkToStatus(net) : 'offline'
  },

  /** Balance in satoshis (gateway returns satoshis already). */
  async getBalance(coinId: string, address: string): Promise<CoinBalance> {
    const r = await postJson<{ ok: true; address: string; result: CoinBalance }>(coinId, '/address/balance', { address }, 12_000)
    return r.result
  },

  /** UTXOs for the address (used by send service). */
  async getUtxos(coinId: string, address: string, options: { force?: boolean; fast?: boolean } = {}): Promise<Utxo[]> {
    const key = `${coinId}:${address}`
    const cached = utxoCache.get(key)
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value
    let value: Utxo[]
    try {
      const r = await postJson<{ ok: true; address: string; result: { utxos: Utxo[] } }>(
        coinId,
        '/address/utxos',
        { address, force: options.force === true, fast: options.fast === true },
        15_000,
      )
      value = r.result?.utxos ?? []
    } catch (error) {
      if (isRateLimited(error) && cached?.value) return cached.value
      if (!isNoAddressInfo(error)) throw error
      value = []
    }
    utxoCache.set(key, { expiresAt: Date.now() + 30_000, value })
    return value
  },

  /** UTXOs for a wallet address group. The gateway expands legacy/bech32 aliases once. */
  async getUtxosForAddresses(coinId: string, addresses: string[], options: { force?: boolean; fast?: boolean } = {}): Promise<Utxo[]> {
    const unique = Array.from(new Set(addresses.map((address) => address.trim()).filter(Boolean)))
    if (unique.length === 0) return []
    if (unique.length === 1) return this.getUtxos(coinId, unique[0], options)

    const key = `${coinId}:${unique.slice().sort().join('|')}`
    const cached = utxoCache.get(key)
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value

    let value: Utxo[]
    try {
      const r = await postJson<{ ok: true; result: { utxos: Utxo[] } }>(
        coinId,
        '/address/utxos',
        { addresses: unique, force: options.force === true, fast: options.fast === true },
        options.force ? 25_000 : 15_000,
      )
      value = r.result?.utxos ?? []
    } catch (error) {
      if (isRateLimited(error) && cached?.value) return cached.value
      if (!isNoAddressInfo(error)) throw error
      value = []
    }
    utxoCache.set(key, { expiresAt: Date.now() + 30_000, value })
    return value
  },

  invalidateCoinCache(coinId?: string, address?: string) {
    clearUtxoCache(coinId, address)
    walletSnapshotCache.clear()
  },

  async prefetchUtxos(items: Array<{ coin: string; addresses: string[] }>) {
    await Promise.all(items.flatMap((item) =>
      item.addresses
        .filter(Boolean)
        .map((address) => this.getUtxos(item.coin, address).catch(() => [] as Utxo[])),
    ))
  },

  /** Fee rate in coin units per kilobyte (Bitcoin Core convention). */
  async getFeeRate(
    coinId: string,
    blocks = 6,
    timeoutMs = 12_000,
    options: { force?: boolean } = {},
  ): Promise<FeeRateInfo> {
    const key = `${coinId}:${blocks}`
    const cached = feeRateCache.get(key)
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value
    const forceParam = options.force ? '&force=1' : ''
    let response: { ok: true } & FeeRateInfo
    try {
      response = await getJson<{ ok: true } & FeeRateInfo>(coinId, `/fee/estimate?blocks=${blocks}${forceParam}`, timeoutMs)
    } catch (error) {
      if (cached?.value) return cached.value
      throw error
    }
    const value = {
      feerate: response.feerate,
      relayFee: response.relayFee,
      source: response.source,
      coin: response.coin,
    }
    feeRateCache.set(key, { expiresAt: Date.now() + FEE_CACHE_MS, value })
    persistFeeCaches()
    return value
  },

  /** Account-model fee estimate (Quai/EVM-like chains). */
  async getAccountFeeEstimate(
    coinId: string,
    timeoutMs = 12_000,
    options: { force?: boolean } = {},
  ): Promise<AccountFeeEstimate> {
    const cached = accountFeeCache.get(coinId)
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value
    const forceParam = options.force ? '&force=1' : ''
    if (!options.force && !cached) {
      const fallback = fallbackAccountFeeEstimate(coinId)
      if (fallback) {
        void getJson<{ ok: true } & AccountFeeEstimate>(coinId, `/fee/estimate?blocks=1${forceParam}`, timeoutMs)
          .then((response) => {
            const value = {
              coin: response.coin,
              fee: response.fee,
              feeSatoshis: response.feeSatoshis,
              gasLimit: response.gasLimit,
              gasPrice: response.gasPrice,
              gasPriceHex: response.gasPriceHex,
              chainId: response.chainId,
              source: response.source,
            }
            accountFeeCache.set(coinId, { expiresAt: Date.now() + FEE_CACHE_MS, value })
            persistFeeCaches()
          })
          .catch(() => undefined)
        return fallback
      }
    }
    let response: { ok: true } & AccountFeeEstimate
    try {
      response = await getJson<{ ok: true } & AccountFeeEstimate>(coinId, `/fee/estimate?blocks=1${forceParam}`, timeoutMs)
    } catch (error) {
      if (cached?.value) return cached.value
      throw error
    }
    const value = {
      coin: response.coin,
      fee: response.fee,
      feeSatoshis: response.feeSatoshis,
      gasLimit: response.gasLimit,
      gasPrice: response.gasPrice,
      gasPriceHex: response.gasPriceHex,
      chainId: response.chainId,
      source: response.source,
    }
    accountFeeCache.set(coinId, { expiresAt: Date.now() + FEE_CACHE_MS, value })
    persistFeeCaches()
    return value
  },

  async getAccountTxContext(
    coinId: string,
    from: string,
    to?: string,
    options: { valueWeiHex?: string } = {},
  ): Promise<AccountTxContext> {
    const response = await postJson<{ ok: true } & AccountTxContext>(
      coinId,
      '/account/tx-context',
      { from, to, value: options.valueWeiHex },
      15_000,
    )
    return {
      from: response.from,
      to: response.to,
      nonce: response.nonce,
      coin: response.coin,
      fee: response.fee,
      feeSatoshis: response.feeSatoshis,
      gasLimit: response.gasLimit,
      gasPrice: response.gasPrice,
      gasPriceHex: response.gasPriceHex,
      chainId: response.chainId,
      source: response.source,
      targetTick: response.targetTick,
    }
  },

  /** Validate an address against the daemon. */
  async validateAddress(coinId: string, address: string): Promise<{ isvalid: boolean }> {
    const r = await postJson<{ ok: true; result: { isvalid: boolean } }>(coinId, '/validate', { address }, 12_000)
    return r.result
  },

  /**
   * USD prices for every coin the gateway tracks. Server polls LiveCoinWatch
   * every ~5 min and caches; this just returns the cached snapshot.
   */
  async getPrices(): Promise<{ prices: Record<string, number>; updatedAt: number | null }> {
    return getGlobal<{ ok: true; prices: Record<string, number>; updatedAt: number | null }>('/prices')
  },

  async getWalletSnapshot(request: WalletSnapshotRequest, timeoutMs = 0): Promise<WalletSnapshotResponse> {
    const key = JSON.stringify(request)
    const cacheable = request.includeHistory === false && request.forceBalances !== true
    const cached = cacheable ? walletSnapshotCache.get(key) : undefined
    const logsQuai = hasQuaiSnapshotRequest(request)
    const logsPearl = hasPearlSnapshotRequest(request)
    if (logsQuai) {
      quaiDebugLog('api.walletSnapshot.request', {
        coins: request.coins.map((item) => ({ coin: item.coin, addressCount: item.addresses?.length ?? 0 })),
        includeNetwork: request.includeNetwork,
        includeBalances: request.includeBalances,
        includeHistory: request.includeHistory,
        forceBalances: request.forceBalances,
        historyLimit: request.historyLimit,
        historyOffset: request.historyOffset,
        historyUtxoOverlay: request.historyUtxoOverlay,
        expandAddresses: request.expandAddresses,
        cacheable,
        cacheHit: Boolean(cached && cached.expiresAt > Date.now()),
      })
    }
    if (logsPearl) {
      coinDebugLog('pearl', 'api.walletSnapshot.request', {
        coins: request.coins.map((item) => ({ coin: item.coin, addressCount: item.addresses?.length ?? 0 })),
        includeNetwork: request.includeNetwork,
        includeBalances: request.includeBalances,
        includeHistory: request.includeHistory,
        forceBalances: request.forceBalances,
        historyLimit: request.historyLimit,
        historyOffset: request.historyOffset,
        historyUtxoOverlay: request.historyUtxoOverlay,
        expandAddresses: request.expandAddresses,
        cacheable,
        cacheHit: Boolean(cached && cached.expiresAt > Date.now()),
      })
    }
    if (cached && cached.expiresAt > Date.now()) {
      if (logsQuai) quaiDebugLog('api.walletSnapshot.cacheHit', { summary: summarizeQuaiSnapshot(cached.value) })
      if (logsPearl) coinDebugLog('pearl', 'api.walletSnapshot.cacheHit', { summary: summarizePearlSnapshot(cached.value) })
      return cached.value
    }

    try {
      const response = await postGlobal<{ ok: true } & WalletSnapshotResponse>('/wallet/snapshot', request, timeoutMs)
      const value = {
        prices: response.prices ?? {},
        pricesUpdatedAt: response.pricesUpdatedAt ?? null,
        coins: response.coins ?? {},
      }
      if (logsQuai) quaiDebugLog('api.walletSnapshot.response', { summary: summarizeQuaiSnapshot(value) })
      if (logsPearl) coinDebugLog('pearl', 'api.walletSnapshot.response', { summary: summarizePearlSnapshot(value) })
      if (cacheable) walletSnapshotCache.set(key, { expiresAt: Date.now() + 5_000, value })
      return value
    } catch (error) {
      if (logsQuai) quaiDebugLogError('api.walletSnapshot.error', error)
      if (logsPearl) coinDebugLogError('pearl', 'api.walletSnapshot.error', error)
      throw error
    }
  },

  async getPrivacyCache(coin: 'zano' | 'epic', backupId: string): Promise<PrivacyCacheEnvelope | null> {
    const response = await postGlobal<{ ok: true; found: boolean; cache?: PrivacyCacheEnvelope }>(
      '/privacy/cache/get',
      { coin, backupId },
      15_000,
    )
    return response.found && response.cache ? response.cache : null
  },

  async putPrivacyCache(coin: 'zano' | 'epic', backupId: string, cache: PrivacyCacheEnvelope): Promise<void> {
    await postGlobal<{ ok: true; stored: boolean }>(
      '/privacy/cache/put',
      { coin, backupId, cache },
      15_000,
    )
  },

  /** Broadcast a signed-hex transaction. Returns the txid. */
  async broadcast(coinId: string, hex: string, expectedTxid?: string): Promise<string> {
    const r = await postJson<{ ok: true; txid?: string; result?: { txid?: string } }>(coinId, '/tx/broadcast', { hex }, 25_000)
    const txid = r.txid ?? r.result?.txid
    if (!txid && !expectedTxid) throw new Error('Broadcast succeeded but no txid returned')
    clearUtxoCache(coinId)
    walletSnapshotCache.clear()
    return txid ?? expectedTxid as string
  },

  /**
   * Returns the address history as wallet-friendly Transaction objects.
   * Requires the daemon to have `addressindex=1`; without it the gateway
   * returns 501 and this function returns an empty array.
   */
  async getAddressHistory(
    coinId: string,
    address: string,
    satsPerCoin: number,
    limit = 25,
    offset = 0,
  ): Promise<Transaction[]> {
    let history: HistoryResponse
    try {
      history = await postJson<HistoryResponse>(coinId, '/address/history', { address, limit, offset })
    } catch {
      return []
    }
    return mapHistoryResponseToTransactions(history, coinId, address, satsPerCoin)
  },

  async getAddressMempool(coinId: string, address: string): Promise<AddressMempoolResponse> {
    const r = await postJson<{ ok: true } & AddressMempoolResponse>(coinId, '/address/mempool', { address })
    return {
      address: r.address,
      hasPendingOutgoing: Boolean(r.hasPendingOutgoing),
      pending: Array.isArray(r.pending) ? r.pending : [],
    }
  },

  async getAddressMempoolForAddresses(coinId: string, addresses: string[]): Promise<AddressMempoolResponse> {
    const unique = Array.from(new Set(addresses.map((address) => address.trim()).filter(Boolean)))
    if (unique.length === 0) return { address: '', hasPendingOutgoing: false, pending: [] }
    if (unique.length === 1) return this.getAddressMempool(coinId, unique[0])
    const r = await postJson<{ ok: true } & AddressMempoolResponse>(coinId, '/address/mempool', { addresses: unique })
    return {
      address: r.address,
      hasPendingOutgoing: Boolean(r.hasPendingOutgoing),
      pending: Array.isArray(r.pending) ? r.pending : [],
    }
  },
}
