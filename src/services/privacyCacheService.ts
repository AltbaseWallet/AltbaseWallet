import { coinApiService, type PrivacyCacheEnvelope } from './coinApiService'
import { privacyBirthService } from './privacyBirthService'
import { storageService } from './storageService'
import { coinDebugLog, coinDebugLogError } from '../utils/quaiDebugLog'

type PrivacyCacheCoin = 'zano' | 'epic'

type PrivacyCacheState = {
  version: 1 | 2
  coin: PrivacyCacheCoin
  walletFingerprint: string
  kdf: 'hkdf-sha256'
  encryption: 'aes-256-gcm'
  address?: string
  balance?: string
  spendable?: string
  transactions?: unknown[]
  restoreStartHeight?: number
  lastScannedHeight?: number
  scanState?: string
  sourceCode?: string
  verifiedSpendState?: boolean
  nativeWalletFileName?: string
  nativeWalletFileBlob?: string
  nativeWalletFileSize?: number
  updatedAt: string
}

type PrivacySnapshotLike = {
  ok: boolean
  code?: string
  address?: string
  balance?: string
  spendable?: string
  transactions?: unknown[]
  restoreStartHeight?: number
  lastScannedHeight?: number
  scanState?: string
  sourceCode?: string
  verifiedSpendState?: boolean
  nativeWalletFileName?: string
  nativeWalletFileBlob?: string
  nativeWalletFileSize?: number
  serverStatus?: string
}

type PrivacyLocalTransactionLike = {
  coinId?: string
  type?: 'incoming' | 'outgoing'
  direction?: 'incoming' | 'outgoing'
  amount?: string | number
  fee?: string | number
  status?: string
  txHash?: string
  txid?: string
  id?: string
  from?: string
  to?: string
  spent?: boolean
  createdAt?: string
  confirmations?: number
  blockHeight?: number
  height?: number
}

const CACHE_KEY = 'privacy-wallet-cache:v1'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from({ length: Math.ceil(bytes.length / 0x8000) }, (_, index) =>
    String.fromCharCode(...bytes.subarray(index * 0x8000, (index + 1) * 0x8000)),
  ).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

const sha256Base64Url = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(text))
  return bytesToBase64Url(new Uint8Array(digest))
}

const backupIdFor = (coin: PrivacyCacheCoin, mnemonic: string) =>
  sha256Base64Url(`altbase-privacy-cache-id-v1|${coin}|${mnemonic.trim().toLowerCase()}`)

const keyFor = async (coin: PrivacyCacheCoin, mnemonic: string) => {
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(mnemonic.trim().toLowerCase()),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: textEncoder.encode(`altbase-privacy-cache-salt-v1|${coin}`),
      info: textEncoder.encode('altbase-wallet-cache-backup-v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

const localCaches = () => storageService.get<Record<string, PrivacyCacheEnvelope>>(CACHE_KEY, {})
const localCacheKey = (coin: PrivacyCacheCoin, backupId: string) => `${coin}:${backupId}`

const packEncryptedBlob = (nonce: Uint8Array, encrypted: ArrayBuffer) => {
  const cipher = new Uint8Array(encrypted)
  const packed = new Uint8Array(nonce.length + cipher.length)
  packed.set(nonce, 0)
  packed.set(cipher, nonce.length)
  return bytesToBase64Url(packed)
}

const unpackEncryptedBlob = (envelope: PrivacyCacheEnvelope) => {
  if (envelope.nonce) {
    return {
      nonce: base64UrlToBytes(envelope.nonce),
      cipherText: base64UrlToBytes(envelope.encryptedBlob),
    }
  }

  const packed = base64UrlToBytes(envelope.encryptedBlob)
  if (packed.length <= 12) throw new Error('Invalid encrypted privacy cache')
  return {
    nonce: packed.subarray(0, 12),
    cipherText: packed.subarray(12),
  }
}

const lastScannedHeightFrom = (snapshot: PrivacySnapshotLike) => {
  const explicit = Number(snapshot.lastScannedHeight ?? 0)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  let best = 0
  for (const tx of snapshot.transactions ?? []) {
    const height = Number((tx as { height?: unknown }).height ?? 0)
    if (Number.isFinite(height) && height > best) best = Math.floor(height)
  }
  return best || undefined
}

const positiveBalance = (value?: string) => {
  const balance = Number.parseFloat(value ?? '0')
  return Number.isFinite(balance) && balance > 0
}

const rawTxKey = (tx: unknown, fallback: number) => {
  if (!tx || typeof tx !== 'object') return `fallback:${fallback}`
  const item = tx as {
    id?: unknown
    txid?: unknown
    txId?: unknown
    txHash?: unknown
    tx_hash?: unknown
    hash?: unknown
  }
  return String(item.txid ?? item.txId ?? item.txHash ?? item.tx_hash ?? item.hash ?? item.id ?? `fallback:${fallback}`).toLowerCase()
}

const rawTxDirection = (tx: unknown) => {
  if (!tx || typeof tx !== 'object') return ''
  const item = tx as { type?: unknown; direction?: unknown; tx_type?: unknown }
  return String(item.type ?? item.direction ?? item.tx_type ?? '').toLowerCase()
}

const txDirectionSummary = (transactions?: unknown[]) => {
  let incoming = 0
  let outgoing = 0
  let unknown = 0
  let spentIncoming = 0
  const heights: number[] = []
  const first: Array<{
    key: string
    direction: string
    amount?: unknown
    fee?: unknown
    status?: unknown
    height?: unknown
    spent?: unknown
  }> = []
  for (const [index, tx] of (transactions ?? []).entries()) {
    const direction = rawTxDirection(tx)
    if (direction.includes('incoming') || direction.includes('received')) incoming += 1
    else if (direction.includes('outgoing') || direction.includes('txsent')) outgoing += 1
    else unknown += 1
    if (tx && typeof tx === 'object') {
      const item = tx as {
        amount?: unknown
        fee?: unknown
        status?: unknown
        height?: unknown
        blockHeight?: unknown
        block_height?: unknown
        spent?: unknown
      }
      if (item.spent === true && (direction.includes('incoming') || direction.includes('received'))) spentIncoming += 1
      const height = Number(item.height ?? item.blockHeight ?? item.block_height ?? 0)
      if (Number.isFinite(height) && height > 0) heights.push(Math.floor(height))
      if (first.length < 5) {
        first.push({
          key: rawTxKey(tx, index),
          direction,
          amount: item.amount,
          fee: item.fee,
          status: item.status,
          height: item.height ?? item.blockHeight ?? item.block_height,
          spent: item.spent,
        })
      }
    }
  }
  return {
    count: transactions?.length ?? 0,
    incoming,
    outgoing,
    unknown,
    spentIncoming,
    minHeight: heights.length ? Math.min(...heights) : undefined,
    maxHeight: heights.length ? Math.max(...heights) : undefined,
    first,
  }
}

const outgoingTxCount = (transactions?: unknown[]) =>
  (transactions ?? []).filter((tx) => rawTxDirection(tx).includes('outgoing') || rawTxDirection(tx).includes('txsent')).length

const shortId = (value: string) => value ? `${value.slice(0, 8)}...${value.slice(-6)}` : ''

const summarizeCacheState = (state: PrivacyCacheState | null | undefined) => state
  ? {
      version: state.version,
      address: state.address,
      balance: state.balance,
      spendable: state.spendable,
      tx: txDirectionSummary(state.transactions),
      restoreStartHeight: state.restoreStartHeight,
      lastScannedHeight: state.lastScannedHeight,
      scanStateLength: state.scanState?.length ?? 0,
      sourceCode: state.sourceCode,
      verifiedSpendState: state.verifiedSpendState === true,
      nativeWalletFileName: state.nativeWalletFileName,
      nativeWalletFileSize: state.nativeWalletFileSize,
      hasNativeWalletFileBlob: Boolean(state.nativeWalletFileBlob),
      updatedAt: state.updatedAt,
    }
  : null

const summarizeSnapshot = (snapshot: PrivacySnapshotLike) => ({
  ok: snapshot.ok,
  code: snapshot.code,
  address: snapshot.address,
  balance: snapshot.balance,
  spendable: snapshot.spendable,
  tx: txDirectionSummary(snapshot.transactions),
  restoreStartHeight: snapshot.restoreStartHeight,
  lastScannedHeight: snapshot.lastScannedHeight,
  scanStateLength: snapshot.scanState?.length ?? 0,
  sourceCode: snapshot.sourceCode,
  verifiedSpendState: snapshot.verifiedSpendState === true,
  nativeWalletFileName: snapshot.nativeWalletFileName,
  nativeWalletFileSize: snapshot.nativeWalletFileSize,
  hasNativeWalletFileBlob: Boolean(snapshot.nativeWalletFileBlob),
})

const mergeTransactionsPreservingOutgoing = (primary?: unknown[], fallback?: unknown[]) => {
  const merged: unknown[] = []
  const seen = new Set<string>()
  for (const [index, tx] of [...(primary ?? []), ...(fallback ?? [])].entries()) {
    const key = rawTxKey(tx, index)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(tx)
  }
  return merged
}

const localTransactionToCacheRaw = (tx: PrivacyLocalTransactionLike) => ({
  id: tx.txHash ?? tx.txid ?? tx.id,
  txid: tx.txHash ?? tx.txid ?? tx.id,
  type: tx.type ?? tx.direction,
  direction: tx.direction ?? tx.type,
  amount: tx.amount,
  fee: tx.fee,
  status: tx.status === 'confirmed' ? 'confirmed' : 'pending',
  height: tx.blockHeight ?? tx.height,
  blockHeight: tx.blockHeight ?? tx.height,
  confirmations: tx.confirmations,
  from: tx.from,
  to: tx.to,
  spent: tx.spent === true,
  date: tx.createdAt,
  creation_ts: tx.createdAt,
})

const validLocalCacheTransactions = (
  coin: PrivacyCacheCoin,
  transactions: PrivacyLocalTransactionLike[],
) =>
  transactions
    .filter((tx) => tx.coinId === coin || !tx.coinId)
    .filter((tx) => tx.txHash || tx.txid || tx.id)
    .filter((tx) => tx.amount !== undefined && (tx.type || tx.direction))
    .map(localTransactionToCacheRaw)

const meaningfulSnapshot = (snapshot: PrivacySnapshotLike) =>
  Boolean(snapshot.transactions?.length)
  || positiveBalance(snapshot.balance)
  || Boolean(snapshot.scanState)
  || Boolean(snapshot.nativeWalletFileBlob)

const snapshotHasVerifiedSpendState = (coin: PrivacyCacheCoin, snapshot: PrivacySnapshotLike) => {
  if (snapshot.verifiedSpendState === true) return true
  if (coin === 'zano') return snapshot.code === 'zano-compact-scan-verified' || snapshot.code === 'zano-native-wallet'
  if (coin === 'epic') return snapshot.code === 'epic-native-wallet'
  return false
}

const shouldReplaceExisting = (existing: PrivacyCacheState | null, next: PrivacyCacheState) => {
  if (!existing) return true
  const existingNativeSize = Number(existing.nativeWalletFileSize ?? 0)
  const nextNativeSize = Number(next.nativeWalletFileSize ?? 0)
  const nextUpdatesNativeWallet = Boolean(next.nativeWalletFileBlob)
    && (
      !existing.nativeWalletFileBlob
      || nextNativeSize > existingNativeSize
    )
  if (nextUpdatesNativeWallet) return true
  const existingHasFundsOrHistory = positiveBalance(existing.balance) || Boolean(existing.transactions?.length)
  const nextHasFundsOrHistory = positiveBalance(next.balance) || Boolean(next.transactions?.length)
  if (existingHasFundsOrHistory && !nextHasFundsOrHistory) return false

  const existingHeight = Number(existing.lastScannedHeight ?? 0)
  const nextHeight = Number(next.lastScannedHeight ?? 0)
  const existingTxCount = existing.transactions?.length ?? 0
  const nextTxCount = next.transactions?.length ?? 0
  const existingHasScanState = Boolean(existing.scanState)
  const nextHasScanState = Boolean(next.scanState)
  if (
    existingHeight > 0
    && nextHeight > 0
    && nextHeight < existingHeight
    && nextTxCount <= existingTxCount
  ) return false
  const nextIsNotAhead = existingHeight > 0 && nextHeight > 0
    ? nextHeight <= existingHeight
    : nextHeight <= 0
  if (
    existingTxCount > nextTxCount
    && nextIsNotAhead
    && (existingHasScanState || !nextHasScanState || existingTxCount - nextTxCount >= 2)
  ) return false
  if (
    existingHasScanState
    && !nextHasScanState
    && existingTxCount >= nextTxCount
    && nextIsNotAhead
  ) return false

  return true
}

const encryptState = async (
  coin: PrivacyCacheCoin,
  mnemonic: string,
  state: PrivacyCacheState,
): Promise<PrivacyCacheEnvelope> => {
  const key = await keyFor(coin, mnemonic)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    textEncoder.encode(JSON.stringify(state)),
  )
  return {
    encryptedBlob: packEncryptedBlob(nonce, encrypted),
  }
}

const decryptState = async (
  coin: PrivacyCacheCoin,
  mnemonic: string,
  envelope: PrivacyCacheEnvelope,
): Promise<PrivacyCacheState | null> => {
  const backupId = await backupIdFor(coin, mnemonic)
  const legacyEnvelope = envelope as PrivacyCacheEnvelope & { coin?: string; backupId?: string }
  if (legacyEnvelope.coin && legacyEnvelope.coin !== coin) return null
  if (legacyEnvelope.backupId && legacyEnvelope.backupId !== backupId) return null
  const key = await keyFor(coin, mnemonic)
  const packed = unpackEncryptedBlob(envelope)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: packed.nonce },
    key,
    packed.cipherText,
  )
  const state = JSON.parse(textDecoder.decode(decrypted)) as PrivacyCacheState
  if (state.coin !== coin || state.walletFingerprint !== backupId) return null
  return state
}

export const privacyCacheService = {
  async load(coin: PrivacyCacheCoin, mnemonic: string): Promise<PrivacyCacheState | null> {
    const backupId = await backupIdFor(coin, mnemonic)
    const key = localCacheKey(coin, backupId)
    const local = localCaches()[key]
    coinDebugLog(coin, 'privacy.cache.load.start', {
      backupId: shortId(backupId),
      hasLocalEnvelope: Boolean(local),
    })
    if (local) {
      try {
        const state = await decryptState(coin, mnemonic, local)
        if (state) {
          coinDebugLog(coin, 'privacy.cache.load.local.hit', {
            backupId: shortId(backupId),
            state: summarizeCacheState(state),
          })
          return state
        }
        coinDebugLog(coin, 'privacy.cache.load.local.decryptEmpty', {
          backupId: shortId(backupId),
        })
      } catch (error) {
        coinDebugLogError(coin, 'privacy.cache.load.local.error', error, {
          backupId: shortId(backupId),
        })
        // Try the cloud copy below.
      }
    }

    const remote = await coinApiService.getPrivacyCache(coin, backupId).catch(() => null)
    if (!remote) {
      coinDebugLog(coin, 'privacy.cache.load.remote.miss', {
        backupId: shortId(backupId),
      })
      return null
    }
    coinDebugLog(coin, 'privacy.cache.load.remote.envelope', {
      backupId: shortId(backupId),
      encryptedBlobLength: remote.encryptedBlob?.length ?? 0,
      hasNonce: Boolean(remote.nonce),
    })
    const state = await decryptState(coin, mnemonic, remote).catch((error) => {
      coinDebugLogError(coin, 'privacy.cache.load.remote.decryptError', error, {
        backupId: shortId(backupId),
      })
      return null
    })
    if (!state) {
      coinDebugLog(coin, 'privacy.cache.load.remote.decryptEmpty', {
        backupId: shortId(backupId),
      })
      return null
    }
    try {
      storageService.set(CACHE_KEY, { ...localCaches(), [key]: remote })
    } catch (error) {
      coinDebugLogError(coin, 'privacy.cache.load.remote.localStoreError', error, {
        backupId: shortId(backupId),
      })
      // Remote encrypted cache is still usable if localStorage quota is full.
    }
    coinDebugLog(coin, 'privacy.cache.load.remote.hit', {
      backupId: shortId(backupId),
      state: summarizeCacheState(state),
    })
    return state
  },

  async saveFromSnapshot(coin: PrivacyCacheCoin, mnemonic: string, snapshot: PrivacySnapshotLike, options: { force?: boolean } = {}) {
    coinDebugLog(coin, 'privacy.cache.save.start', {
      force: options.force === true,
      snapshot: summarizeSnapshot(snapshot),
    })
    if (!snapshot.ok || snapshot.code?.endsWith('snapshot-needs-unlock')) {
      coinDebugLog(coin, 'privacy.cache.save.skip', {
        reason: 'snapshot-not-ok-or-locked',
        snapshot: summarizeSnapshot(snapshot),
      })
      return
    }
    if (!snapshot.address) {
      coinDebugLog(coin, 'privacy.cache.save.skip', {
        reason: 'missing-address',
        snapshot: summarizeSnapshot(snapshot),
      })
      return
    }
    if (!meaningfulSnapshot(snapshot)) {
      coinDebugLog(coin, 'privacy.cache.save.skip', {
        reason: 'not-meaningful',
        snapshot: summarizeSnapshot(snapshot),
      })
      return
    }

    const backupId = await backupIdFor(coin, mnemonic)
    const existing = await this.load(coin, mnemonic).catch(() => null)
    const cachedRestoreStart = Number(existing?.restoreStartHeight ?? 0)
    const snapshotRestoreStart = Number(snapshot.restoreStartHeight ?? 0)
    const fallbackRestoreStart = await privacyBirthService.restoreStartHeight(coin).catch(() => 0)
    const snapshotHasFundsOrHistory = positiveBalance(snapshot.balance) || Boolean(snapshot.transactions?.length)
    const snapshotOnlyUpdatesNativeWallet = Boolean(existing && snapshot.nativeWalletFileBlob && !snapshotHasFundsOrHistory)
    const snapshotLastScannedHeight = lastScannedHeightFrom(snapshot)
    const existingLastScannedHeight = Number(existing?.lastScannedHeight ?? 0)
    const snapshotNativeWalletSize = Number(snapshot.nativeWalletFileSize ?? 0)
    const existingNativeWalletSize = Number(existing?.nativeWalletFileSize ?? 0)
    const snapshotTxCount = snapshot.transactions?.length ?? 0
    const existingTxCount = existing?.transactions?.length ?? 0
    const snapshotOutgoingTxCount = outgoingTxCount(snapshot.transactions)
    const existingOutgoingTxCount = outgoingTxCount(existing?.transactions)
    const snapshotLosesOutgoingHistory = Boolean(
      existing?.nativeWalletFileBlob
      && existingOutgoingTxCount > 0
      && snapshotOutgoingTxCount < existingOutgoingTxCount
    )
    const lastScannedHeight = Math.max(
      Number.isFinite(snapshotLastScannedHeight ?? 0) ? Math.floor(snapshotLastScannedHeight ?? 0) : 0,
      Number.isFinite(existingLastScannedHeight) ? Math.floor(existingLastScannedHeight) : 0,
    ) || undefined
    const nativeWalletArchiveRegresses = Boolean(
      existing?.nativeWalletFileBlob
      && snapshot.nativeWalletFileBlob
      && Number.isFinite(snapshotNativeWalletSize)
      && Number.isFinite(existingNativeWalletSize)
      && snapshotNativeWalletSize > 0
      && existingNativeWalletSize > 0
      && snapshotNativeWalletSize < existingNativeWalletSize
      && (snapshotLastScannedHeight ?? 0) <= existingLastScannedHeight
      && snapshotTxCount <= existingTxCount
      && (snapshot.balance ?? '') === (existing?.balance ?? '')
      && (snapshot.spendable ?? '') === (existing?.spendable ?? '')
    )
    const restoreStartHeight = Number.isFinite(snapshotRestoreStart) && snapshotRestoreStart > 0
      ? Math.floor(snapshotRestoreStart)
      : Number.isFinite(cachedRestoreStart) && cachedRestoreStart > 0
        ? Math.floor(cachedRestoreStart)
        : Number.isFinite(fallbackRestoreStart) && fallbackRestoreStart > 0
          ? Math.floor(fallbackRestoreStart)
          : undefined
    const state: PrivacyCacheState = {
      version: 2,
      coin,
      walletFingerprint: backupId,
      kdf: 'hkdf-sha256',
      encryption: 'aes-256-gcm',
      address: snapshot.address,
      balance: snapshotOnlyUpdatesNativeWallet ? existing?.balance : snapshot.balance,
      spendable: snapshotOnlyUpdatesNativeWallet ? existing?.spendable : snapshot.spendable,
      transactions: snapshotOnlyUpdatesNativeWallet
        ? existing?.transactions ?? []
        : snapshotLosesOutgoingHistory
          ? mergeTransactionsPreservingOutgoing(snapshot.transactions, existing?.transactions)
          : snapshot.transactions ?? [],
      restoreStartHeight,
      lastScannedHeight,
      scanState: snapshot.scanState ?? existing?.scanState,
      sourceCode: snapshotOnlyUpdatesNativeWallet ? existing?.sourceCode ?? snapshot.code : snapshot.code ?? existing?.sourceCode,
      verifiedSpendState: snapshotOnlyUpdatesNativeWallet
        ? existing?.verifiedSpendState === true
        : snapshotHasVerifiedSpendState(coin, snapshot) || existing?.verifiedSpendState === true,
      nativeWalletFileName: nativeWalletArchiveRegresses || snapshotLosesOutgoingHistory
        ? existing?.nativeWalletFileName
        : snapshot.nativeWalletFileName ?? existing?.nativeWalletFileName,
      nativeWalletFileBlob: nativeWalletArchiveRegresses || snapshotLosesOutgoingHistory
        ? existing?.nativeWalletFileBlob
        : snapshot.nativeWalletFileBlob ?? existing?.nativeWalletFileBlob,
      nativeWalletFileSize: nativeWalletArchiveRegresses || snapshotLosesOutgoingHistory
        ? existing?.nativeWalletFileSize
        : snapshot.nativeWalletFileSize ?? existing?.nativeWalletFileSize,
      updatedAt: new Date().toISOString(),
    }
    if (!options.force && !shouldReplaceExisting(existing, state)) {
      coinDebugLog(coin, 'privacy.cache.save.skip', {
        reason: 'existing-is-newer-or-richer',
        existing: summarizeCacheState(existing),
        next: summarizeCacheState(state),
        snapshotLosesOutgoingHistory,
        nativeWalletArchiveRegresses,
      })
      return
    }

    const envelope = await encryptState(coin, mnemonic, state)
    try {
      const local = localCaches()
      storageService.set(CACHE_KEY, { ...local, [localCacheKey(coin, backupId)]: envelope })
    } catch (error) {
      coinDebugLogError(coin, 'privacy.cache.save.localError', error, {
        backupId: shortId(backupId),
        next: summarizeCacheState(state),
      })
      // Keep the remote backup path alive even if Electron localStorage is full.
    }
    let remoteSaved = true
    await coinApiService.putPrivacyCache(coin, backupId, envelope).catch((error) => {
      remoteSaved = false
      coinDebugLogError(coin, 'privacy.cache.save.remoteError', error, {
        backupId: shortId(backupId),
        next: summarizeCacheState(state),
      })
    })
    coinDebugLog(coin, 'privacy.cache.save.done', {
      backupId: shortId(backupId),
      remoteSaved,
      existing: summarizeCacheState(existing),
      next: summarizeCacheState(state),
      snapshotLosesOutgoingHistory,
      nativeWalletArchiveRegresses,
    })
  },

  async mergeLocalTransactions(
    coin: PrivacyCacheCoin,
    mnemonic: string,
    transactions: PrivacyLocalTransactionLike[],
    options: { address?: string } = {},
  ) {
    const localTransactions = validLocalCacheTransactions(coin, transactions)
    coinDebugLog(coin, 'privacy.cache.mergeLocalTx.start', {
      inputTx: txDirectionSummary(transactions),
      validLocalTx: txDirectionSummary(localTransactions),
      hasAddressOption: Boolean(options.address),
    })
    if (localTransactions.length === 0) {
      coinDebugLog(coin, 'privacy.cache.mergeLocalTx.skip', {
        reason: 'no-valid-transactions',
        inputTx: txDirectionSummary(transactions),
      })
      return
    }

    const backupId = await backupIdFor(coin, mnemonic)
    const existing = await this.load(coin, mnemonic).catch(() => null)
    const address = existing?.address ?? options.address
    if (!address) {
      coinDebugLog(coin, 'privacy.cache.mergeLocalTx.skip', {
        reason: 'missing-address',
        backupId: shortId(backupId),
        existing: summarizeCacheState(existing),
      })
      return
    }

    const mergedTransactions = mergeTransactionsPreservingOutgoing(localTransactions, existing?.transactions)
    const state: PrivacyCacheState = {
      version: 2,
      coin,
      walletFingerprint: backupId,
      kdf: 'hkdf-sha256',
      encryption: 'aes-256-gcm',
      address,
      balance: existing?.balance,
      spendable: existing?.spendable,
      transactions: mergedTransactions,
      restoreStartHeight: existing?.restoreStartHeight ?? await privacyBirthService.restoreStartHeight(coin).catch(() => undefined),
      lastScannedHeight: existing?.lastScannedHeight,
      scanState: existing?.scanState,
      sourceCode: existing?.sourceCode,
      verifiedSpendState: existing?.verifiedSpendState === true,
      nativeWalletFileName: existing?.nativeWalletFileName,
      nativeWalletFileBlob: existing?.nativeWalletFileBlob,
      nativeWalletFileSize: existing?.nativeWalletFileSize,
      updatedAt: new Date().toISOString(),
    }

    const envelope = await encryptState(coin, mnemonic, state)
    try {
      const local = localCaches()
      storageService.set(CACHE_KEY, { ...local, [localCacheKey(coin, backupId)]: envelope })
    } catch {
      // Remote cache is still attempted below.
    }
    let remoteSaved = true
    await coinApiService.putPrivacyCache(coin, backupId, envelope).catch((error) => {
      remoteSaved = false
      coinDebugLogError(coin, 'privacy.cache.mergeLocalTx.remoteError', error, {
        backupId: shortId(backupId),
        next: summarizeCacheState(state),
      })
    })
    coinDebugLog(coin, 'privacy.cache.mergeLocalTx.done', {
      backupId: shortId(backupId),
      remoteSaved,
      existing: summarizeCacheState(existing),
      next: summarizeCacheState(state),
    })
  },
}
