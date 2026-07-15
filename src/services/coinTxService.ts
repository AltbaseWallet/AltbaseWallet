/**
 * Multi-coin transaction-signing service.
 *
 * Builds, signs (ECDSA secp256k1) and broadcasts standard UTXO transactions.
 * Coin-specific bits come from `cryptoParams`.
 */

import type { CoinCryptoParams } from '../types/crypto'
import { addressVariantsFromLegacyAddress, legacyAddressForNativeScript } from '../utils/addressVariants'
import { coinApiService, type FeeRateInfo, type Utxo } from './coinApiService'
import { nativeCoreService } from './nativeCoreService'

/* ───── amount / utxo helpers ───── */

const FALLBACK_FEE_RATE_PER_KB = 0.00001
const FAST_FEE_TIMEOUT_MS = 2_500
const COIN_FALLBACK_FEE_RATE_PER_KB: Record<string, number> = {
  neoxa: 0.01,
  pepecoin: 0.001,
}

const decimalsForScale = (satsPerCoin: number) => {
  let scale = BigInt(Math.trunc(satsPerCoin))
  let decimals = 0
  while (scale > 1n && scale % 10n === 0n) {
    scale /= 10n
    decimals += 1
  }
  return scale === 1n ? decimals : 8
}

const coinAmountToSats = (value: string, satsPerCoin: number, label: string) => {
  const normalized = value.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error(`Invalid ${label} amount`)

  const decimals = decimalsForScale(satsPerCoin)
  const [whole = '0', fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) throw new Error(`${label} has too many decimal places`)

  const scale = BigInt(Math.trunc(satsPerCoin))
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * scale + BigInt(padded || '0')
}

const satsToCoinText = (sats: bigint | number, satsPerCoin: number) =>
  (Number(sats) / satsPerCoin).toFixed(8).replace(/\.?0+$/, '') || '0'

const toNativeUtxos = (utxos: Utxo[]) =>
  utxos.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.outputIndex,
    satoshis: Number(utxo.satoshis),
    script: utxo.script,
  }))

const outpointKey = (value: { txid: string; vout?: number; outputIndex?: number }) =>
  `${value.txid}:${value.vout ?? value.outputIndex ?? 0}`

const filterExcludedUtxos = (
  utxos: FundingUtxo[],
  excludeOutpoints: Array<{ txid: string; vout: number }> = [],
) => {
  if (excludeOutpoints.length === 0) return utxos
  const excluded = new Set(excludeOutpoints.map(outpointKey))
  return utxos.filter((utxo) => !excluded.has(outpointKey(utxo)))
}

const fundingAddressesFor = async (
  coinId: string,
  fromAddress: string,
  cryptoParams: CoinCryptoParams,
): Promise<string[]> => {
  const addressVariants = await addressVariantsFromLegacyAddress(fromAddress, cryptoParams)
    .catch(() => nativeCoreService.addressVariantsFromLegacy(coinId, fromAddress, cryptoParams))
  const fundingAddresses = addressVariants
    .filter((variant) => !variant.aliasOfLegacy && (variant.scriptKind === 'p2pkh' || variant.scriptKind === 'p2wpkh' || variant.scriptKind === 'p2tr'))
    .map((variant) => variant.address)
  return Array.from(new Set(fundingAddresses.length > 0 ? fundingAddresses : [fromAddress]))
}

const fetchFundingUtxos = async (
  coinId: string,
  fromAddress: string,
  cryptoParams: CoinCryptoParams,
  options: { force?: boolean; fast?: boolean; excludeOutpoints?: Array<{ txid: string; vout: number }> } = {},
): Promise<FundingUtxo[]> => {
  const uniqueFundingAddresses = await fundingAddressesFor(coinId, fromAddress, cryptoParams)
  const rows = (await coinApiService.getUtxosForAddresses(coinId, uniqueFundingAddresses, options))
    .map((utxo) => ({ ...utxo, sourceAddress: fromAddress })) as FundingUtxo[]
  const byOutpoint = new Map<string, FundingUtxo>()
  for (const row of rows) {
    const key = `${row.txid}:${row.outputIndex}`
    if (!byOutpoint.has(key)) byOutpoint.set(key, row)
  }
  return filterExcludedUtxos(Array.from(byOutpoint.values()), options.excludeOutpoints)
}

const isAlreadyAcceptedBroadcastError = (error: unknown) =>
  error instanceof Error
  && /already in block chain|already known|already have transaction|already in (?:the )?mempool|txn-already-known/i.test(error.message)

const isDeterministicBroadcastRejection = (error: unknown) => {
  if (!(error instanceof Error)) return false
  const status = Number((error as Error & { status?: number }).status)
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408) return true
  return /bad-txns-inputs-missingorspent|missing.?or.?spent|txn-mempool-conflict|min relay fee not met|mandatory-script-verify|non-mandatory-script-verify|bad-txns|insufficient fee|dust/i.test(error.message)
}

export class UtxoBroadcastError extends Error {
  readonly txid: string
  readonly uncertain: boolean

  constructor(message: string, txid: string, uncertain: boolean) {
    super(message)
    this.name = 'UtxoBroadcastError'
    this.txid = txid
    this.uncertain = uncertain
  }
}

const getFeeRateInfo = async (coinId: string, options: { force?: boolean } = {}): Promise<FeeRateInfo> => {
  let rate = COIN_FALLBACK_FEE_RATE_PER_KB[coinId] ?? FALLBACK_FEE_RATE_PER_KB
  let relayFee = COIN_FALLBACK_FEE_RATE_PER_KB[coinId]
  try {
    const fr = await coinApiService.getFeeRate(coinId, 6, FAST_FEE_TIMEOUT_MS, options)
    if (fr.feerate > 0) rate = fr.feerate
    if (typeof fr.relayFee === 'number' && fr.relayFee > 0) relayFee = fr.relayFee
  } catch {
    // fallback
  }
  return { coin: coinId, feerate: Math.max(rate, relayFee ?? 0), relayFee }
}

const getFeeRate = async (coinId: string, options: { force?: boolean } = {}) => {
  const info = await getFeeRateInfo(coinId, options)
  return info.feerate
}

const getRelayFeeRate = async (coinId: string, options: { force?: boolean } = {}) => {
  const info = await getFeeRateInfo(coinId, options)
  return Math.max(info.relayFee ?? 0, COIN_FALLBACK_FEE_RATE_PER_KB[coinId] ?? FALLBACK_FEE_RATE_PER_KB)
}

const estimateMinimumRelayFee = async (
  coinId: string,
  satsPerCoin: number,
  nIn = 1,
  nOut = 2,
  options: { force?: boolean } = {},
) => {
  const relayRate = await getRelayFeeRate(coinId, options)
  const satoshis = await nativeCoreService.estimateFee({ feeRatePerKb: relayRate, satsPerCoin, nIn, nOut })
  return { satoshis, coin: satsToCoinText(satoshis, satsPerCoin) }
}

const assertManualFeeAboveRelay = async (
  coinId: string,
  satsPerCoin: number,
  manualFeeSats: bigint,
  nIn = 1,
  nOut = 2,
) => {
  const min = await estimateMinimumRelayFee(coinId, satsPerCoin, nIn, nOut, { force: true })
  if (manualFeeSats < BigInt(min.satoshis)) {
    throw new Error(`manualFeeBelowMinimum:${min.coin}`)
  }
}

/* ───── public API ───── */

export type CoinSendResult = {
  txid: string
  hex: string
  amountCoin: string
  feeSatoshis: number
  feeCoin: string
  spentOutpoints?: Array<{ txid: string; vout: number; satoshis?: number }>
}

export type PreparedCoinSend = CoinSendResult

type FundingUtxo = Utxo & { sourceAddress: string }

export type CoinMaxSendResult = {
  amountCoin: string
  feeCoin: string
  feeSatoshis: number
  inputCount: number
}

export const coinTxService = {
  /** Fee estimate (used by the Send page MAX button) before knowing real input count. */
  async estimateFee(
    coinId: string,
    cryptoParams: CoinCryptoParams,
    satsPerCoin: number,
    nIn = 1,
    nOut = 2,
    options: { force?: boolean } = {},
  ): Promise<{ satoshis: number; coin: string }> {
    void cryptoParams
    const rate = await getFeeRate(coinId, options)
    const sats = await nativeCoreService.estimateFee({ feeRatePerKb: rate, satsPerCoin, nIn, nOut })
    const coin = (sats / satsPerCoin).toFixed(8).replace(/\.?0+$/, '')
    return { satoshis: sats, coin }
  },

  /** Exact fee for the current recipient, amount and spendable UTXO set. */
  async estimateSendFee(params: {
    coinId: string
    cryptoParams: CoinCryptoParams
    satsPerCoin: number
    fromAddress: string
    toAddress: string
    amountCoin: string
    force?: boolean
    excludeOutpoints?: Array<{ txid: string; vout: number }>
  }): Promise<{ satoshis: number; coin: string }> {
    const {
      coinId,
      cryptoParams,
      satsPerCoin,
      fromAddress,
      toAddress,
      amountCoin,
      force = false,
      excludeOutpoints,
    } = params
    const amountSats = coinAmountToSats(amountCoin, satsPerCoin, 'amount')
    if (amountSats <= 0n) throw new Error('Amount must be greater than 0')

    const nativeToAddress = await legacyAddressForNativeScript(toAddress, cryptoParams)
    const nativeChangeAddress = await legacyAddressForNativeScript(fromAddress, cryptoParams)
    const [toScript, changeScript, utxos, feeRatePerKb] = await Promise.all([
      nativeCoreService.addressToScript(coinId, nativeToAddress, cryptoParams),
      nativeCoreService.addressToScript(coinId, nativeChangeAddress, cryptoParams),
      fetchFundingUtxos(coinId, fromAddress, cryptoParams, {
        force,
        fast: true,
        excludeOutpoints,
      }),
      getFeeRate(coinId, { force }),
    ])
    if (utxos.length === 0) throw new Error('No spendable UTXOs (balance is 0 or unconfirmed)')

    const plan = await nativeCoreService.planTransaction({
      mode: 'send',
      utxos: toNativeUtxos(utxos),
      satsPerCoin,
      feeRatePerKb,
      amountSats,
      toScript,
      changeScript,
    })
    return {
      satoshis: plan.feeSatoshis,
      coin: satsToCoinText(plan.feeSatoshis, satsPerCoin),
    }
  },

  estimateMinimumRelayFee,

  async estimateMaxSend(params: {
    coinId: string
    cryptoParams: CoinCryptoParams
    satsPerCoin: number
    fromAddress: string
    feeCoin?: string
    excludeOutpoints?: Array<{ txid: string; vout: number }>
  }): Promise<CoinMaxSendResult> {
    const { coinId, cryptoParams, satsPerCoin, fromAddress, feeCoin, excludeOutpoints } = params
    const utxos = await fetchFundingUtxos(coinId, fromAddress, cryptoParams, { fast: true, excludeOutpoints })
    if (utxos.length === 0) throw new Error('No spendable UTXOs (balance is 0 or unconfirmed)')
    const manualFeeSats = feeCoin ? coinAmountToSats(feeCoin, satsPerCoin, 'fee') : undefined
    if (manualFeeSats !== undefined) {
      await assertManualFeeAboveRelay(coinId, satsPerCoin, manualFeeSats, utxos.length, 1)
    }

    const plan = await nativeCoreService.planTransaction({
        mode: 'max',
        utxos: toNativeUtxos(utxos),
        satsPerCoin,
        feeRatePerKb: feeCoin ? (COIN_FALLBACK_FEE_RATE_PER_KB[coinId] ?? FALLBACK_FEE_RATE_PER_KB) : await getFeeRate(coinId, { force: false }),
        manualFeeSats,
      })
    return {
      amountCoin: satsToCoinText(plan.amountSatoshis, satsPerCoin),
      feeCoin: satsToCoinText(plan.feeSatoshis, satsPerCoin),
      feeSatoshis: plan.feeSatoshis,
      inputCount: plan.inputCount,
    }
  },

  /**
   * Full send pipeline: derive key → fetch UTXOs → select → build → sign → broadcast.
   * Throws on every failure; the caller's catch decides what to surface.
   */
  async send(params: {
    coinId: string
    cryptoParams: CoinCryptoParams
    satsPerCoin: number
    mnemonic: string
    fromAddress: string
    toAddress: string
    amountCoin: string
    feeCoin?: string
    sendMax?: boolean
    excludeOutpoints?: Array<{ txid: string; vout: number }>
    onPrepared?: (prepared: PreparedCoinSend) => void | Promise<void>
  }): Promise<CoinSendResult> {
    const { coinId, cryptoParams, satsPerCoin, mnemonic, fromAddress, toAddress, amountCoin, feeCoin, sendMax, excludeOutpoints } = params

    // 1. Amount in sats
    const amountSat = sendMax ? 0n : coinAmountToSats(amountCoin, satsPerCoin, 'amount')
    if (!sendMax && amountSat <= 0n) throw new Error('Amount must be greater than 0')

    // 2. UTXOs
    // 3. Native fee, UTXO selection, change and output planning
    const nativeToAddress = await legacyAddressForNativeScript(toAddress, cryptoParams)
    const nativeChangeAddress = await legacyAddressForNativeScript(fromAddress, cryptoParams)
    const toScript     = await nativeCoreService.addressToScript(coinId, nativeToAddress, cryptoParams)
    const changeScript = await nativeCoreService.addressToScript(coinId, nativeChangeAddress, cryptoParams)
    const manualFeeSats = feeCoin ? coinAmountToSats(feeCoin, satsPerCoin, 'fee') : undefined

    const utxos = await fetchFundingUtxos(coinId, fromAddress, cryptoParams, {
      force: true,
      fast: false,
      excludeOutpoints,
    })
    if (utxos.length === 0) throw new Error('No spendable UTXOs (balance is 0 or unconfirmed)')

    const plan = await nativeCoreService.planTransaction({
      mode: sendMax ? 'max' : 'send',
      utxos: toNativeUtxos(utxos),
      satsPerCoin,
      feeRatePerKb: feeCoin
        ? (COIN_FALLBACK_FEE_RATE_PER_KB[coinId] ?? FALLBACK_FEE_RATE_PER_KB)
        : await getFeeRate(coinId, { force: true }),
      amountSats: sendMax ? undefined : amountSat,
      manualFeeSats,
      toScript,
      changeScript,
    })
    if (manualFeeSats !== undefined) {
      await assertManualFeeAboveRelay(coinId, satsPerCoin, manualFeeSats, plan.inputCount, plan.outputs.length)
    }

    const signed = await nativeCoreService.signTransaction({
      coinId,
      mnemonic,
      cryptoParams,
      inputs: plan.selectedInputs,
      outputs: plan.outputs,
    })
    const prepared: CoinSendResult = {
      txid: signed.txid,
      hex: signed.txHex,
      amountCoin: satsToCoinText(plan.amountSatoshis, satsPerCoin),
      feeSatoshis: plan.feeSatoshis,
      feeCoin: satsToCoinText(plan.feeSatoshis, satsPerCoin),
      spentOutpoints: plan.selectedInputs.map((input) => ({
        txid: input.txid,
        vout: input.vout,
        satoshis: input.satoshis,
      })),
    }
    await params.onPrepared?.(prepared)

    try {
      const broadcastTxid = await coinApiService.broadcast(coinId, signed.txHex, signed.txid)
      if (broadcastTxid.trim().toLowerCase() !== signed.txid.toLowerCase()) {
        throw new UtxoBroadcastError('Broadcast gateway returned a different transaction id', signed.txid, true)
      }
      return prepared
    } catch (error) {
      if (error instanceof UtxoBroadcastError) throw error
      if (isAlreadyAcceptedBroadcastError(error)) return prepared
      const message = error instanceof Error ? error.message : String(error)
      throw new UtxoBroadcastError(message, signed.txid, !isDeterministicBroadcastRejection(error))
    }
  },
}
