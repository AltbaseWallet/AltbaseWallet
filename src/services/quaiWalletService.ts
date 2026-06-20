import {
  QuaiHDWallet,
  QuaiTransaction,
  Zone,
  formatQuai,
  isQuaiAddress,
  parseQuai,
} from 'quais'
import { coinApiService } from './coinApiService'
import { quaiDebugLog } from '../utils/quaiDebugLog'

const QUAI_COIN_ID = 'quai'
const WEI_PER_UI_BASE = 10_000_000_000n
const QUAI_NATIVE_TRANSFER_GAS = 21_000n
// Quai transfers can require more than the bare 21000 intrinsic depending on
// the route, so estimated sends keep a 60000 floor and fall back to the server's
// configured 80000 limit when estimateGas is unavailable. The larger value is a
// signing/broadcast reserve; the wallet balance preview should still use the
// native transfer gas actually charged by the network.
const QUAI_MIN_TRANSFER_GAS_LIMIT = 60_000n

const trimCoinText = (value: string, decimals = 12) => {
  const [whole, fraction = ''] = value.split('.')
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

const ceilQuaiText = (wei: bigint, decimals = 8) => {
  const factor = 10n ** BigInt(18 - decimals)
  const rounded = wei === 0n ? 0n : ((wei + factor - 1n) / factor) * factor
  return trimCoinText(formatQuai(rounded), decimals)
}

const floorQuaiText = (wei: bigint, decimals = 8) => {
  const factor = 10n ** BigInt(18 - decimals)
  const rounded = (wei / factor) * factor
  return trimCoinText(formatQuai(rounded), decimals)
}

const ceilDiv = (value: bigint, divisor: bigint) =>
  value === 0n ? 0n : (value + divisor - 1n) / divisor

const feeBaseUnitsFromWei = (wei: bigint) =>
  ceilDiv(wei, WEI_PER_UI_BASE)

const ensureQuaiWallet = (mnemonic: string) => {
  const wallet = QuaiHDWallet.fromPhrase(mnemonic)
  const address = wallet.getNextAddressSync(0, Zone.Cyprus1).address
  return { wallet, address }
}

const parsePositiveBigInt = (value: unknown, fallback: bigint) => {
  try {
    const parsed = BigInt(String(value ?? ''))
    return parsed > 0n ? parsed : fallback
  } catch {
    return fallback
  }
}

type QuaiGasContext = {
  fee?: string | number
  gasPrice?: string | number | bigint
  gasLimit?: string | number | bigint
  source?: string
}

const gasLimitFromEstimate = (fee: { gasLimit?: string | number | bigint }) =>
  parsePositiveBigInt(fee.gasLimit, QUAI_MIN_TRANSFER_GAS_LIMIT)

const feeWeiFromEstimate = (fee: QuaiGasContext) => {
  try {
    const parsed = parseQuai(String(fee.fee ?? ''))
    if (parsed > 0n) return parsed
  } catch {
    // Fall back to gasPrice * gasLimit below.
  }
  return parsePositiveBigInt(fee.gasPrice, 0n) * gasLimitFromEstimate(fee)
}

const effectiveGasPlan = (
  context: QuaiGasContext,
  freshFee?: QuaiGasContext | null,
  feeCoin?: string,
) => {
  const estimateGasLimit = gasLimitFromEstimate(context)
  const signGasLimit = estimateGasLimit > QUAI_MIN_TRANSFER_GAS_LIMIT ? estimateGasLimit : QUAI_MIN_TRANSFER_GAS_LIMIT
  const contextGasPrice = parsePositiveBigInt(context.gasPrice, 0n)
  const freshGasPrice = parsePositiveBigInt(freshFee?.gasPrice, 0n)
  const baseGasPrice = freshGasPrice > contextGasPrice ? freshGasPrice : contextGasPrice
  // Use the freshest server gas price directly. Adding local headroom makes
  // low-balance MAX sends impossible even when the node accepts the current fee.
  const networkGasPrice = baseGasPrice
  const gasPrice = feeCoin
    ? (() => {
        const requested = ceilDiv(parseQuai(feeCoin), signGasLimit)
        return requested > networkGasPrice ? requested : networkGasPrice
      })()
    : networkGasPrice
  return {
    signGasLimit,
    gasPrice,
    reserveFeeWei: gasPrice * signGasLimit,
    feeWei: gasPrice * QUAI_NATIVE_TRANSFER_GAS,
  }
}

type PreparedQuaiTransaction = {
  txid: string
  amountCoin: string
  feeCoin: string
}

export const quaiWalletService = {
  deriveAddress(mnemonic: string) {
    return ensureQuaiWallet(mnemonic).address
  },

  getPrivateKey(mnemonic: string) {
    const { wallet, address } = ensureQuaiWallet(mnemonic)
    return wallet.getPrivateKey(address)
  },

  isValidAddress(address: string) {
    return isQuaiAddress(address)
  },

  async estimateFee(coinId = QUAI_COIN_ID, options: {
    force?: boolean
    fromAddress?: string
    toAddress?: string
    amountCoin?: string
  } = {}) {
    const from = options.fromAddress && isQuaiAddress(options.fromAddress) ? options.fromAddress : undefined
    const to = options.toAddress && isQuaiAddress(options.toAddress) ? options.toAddress : undefined
    const amountWei = (() => {
      if (!options.amountCoin || !/^\d+(\.\d+)?$/.test(options.amountCoin.trim())) return undefined
      try {
        const parsed = parseQuai(options.amountCoin.trim())
        return parsed > 0n ? parsed : undefined
      } catch {
        return undefined
      }
    })()
    const fee = from && to
      ? await coinApiService.getAccountTxContext(
          coinId,
          from,
          to,
          { valueWeiHex: amountWei === undefined ? undefined : `0x${amountWei.toString(16)}` },
        )
      : await coinApiService.getAccountFeeEstimate(coinId, 12_000, options)
    const plan = effectiveGasPlan(fee, null)
    const feeWei = plan.feeWei > 0n ? plan.feeWei : feeWeiFromEstimate(fee)
    return {
      satoshis: Math.max(1, Number(feeBaseUnitsFromWei(feeWei))),
      coin: ceilQuaiText(feeWei, 8),
    }
  },

  async estimateMaxSend(coinId: string, address: string, feeCoin?: string, toAddress?: string) {
    const recipient = toAddress && isQuaiAddress(toAddress) ? toAddress : undefined
    const [balance, context, freshFee] = await Promise.all([
      coinApiService.getBalance(coinId, address),
      coinApiService.getAccountTxContext(coinId, address, recipient),
      coinApiService.getAccountFeeEstimate(coinId, 8_000, { force: true }).catch(() => null),
    ])
    const spendableBase = BigInt(Math.max(0, Math.floor(balance.balance_spendable ?? balance.balance ?? 0)))
    const spendableWei = spendableBase * WEI_PER_UI_BASE
    const { signGasLimit, gasPrice, reserveFeeWei, feeWei } = effectiveGasPlan(context, freshFee, feeCoin)
    const maxWei = spendableWei > reserveFeeWei ? spendableWei - reserveFeeWei : 0n
    quaiDebugLog('send.quai.maxPlan', {
      address,
      to: recipient,
      spendable: formatQuai(spendableWei),
      gasLimit: signGasLimit.toString(),
      gasPrice: gasPrice.toString(),
      reserveFee: formatQuai(reserveFeeWei),
      expectedFee: formatQuai(feeWei),
      fee: formatQuai(feeWei),
      amount: formatQuai(maxWei),
      context: {
        gasLimit: context.gasLimit,
        gasPrice: context.gasPrice,
        fee: context.fee,
        source: context.source,
      },
      freshFee: freshFee
        ? {
            gasLimit: freshFee.gasLimit,
            gasPrice: freshFee.gasPrice,
            fee: freshFee.fee,
            source: freshFee.source,
          }
        : null,
    })
    return {
      amountCoin: floorQuaiText(maxWei, 8),
      feeCoin: ceilQuaiText(feeWei, 8),
      feeSatoshis: Number(feeBaseUnitsFromWei(feeWei)),
    }
  },

  async send(params: {
    coinId: string
    mnemonic: string
    fromAddress: string
    toAddress: string
    amountCoin: string
    feeCoin?: string
    sendMax?: boolean
    onPrepared?: (prepared: PreparedQuaiTransaction) => void | Promise<void>
  }) {
    if (!isQuaiAddress(params.toAddress)) throw new Error('Invalid Quai address')

    const { wallet, address } = ensureQuaiWallet(params.mnemonic)
    const fromAddress = params.fromAddress || address
    if (fromAddress.toLowerCase() !== address.toLowerCase()) {
      throw new Error('Quai address does not match this wallet')
    }

    const requestedValueWei = params.sendMax ? undefined : parseQuai(params.amountCoin)
    const [context, balance, freshFee] = await Promise.all([
      coinApiService.getAccountTxContext(
        params.coinId,
        fromAddress,
        params.toAddress,
        { valueWeiHex: requestedValueWei === undefined ? undefined : `0x${requestedValueWei.toString(16)}` },
      ),
      coinApiService.getBalance(params.coinId, fromAddress),
      // Quai's network gas price drifts and the gateway caches it ~15 min, so the
      // tx-context price can be stale-low and the node bounces the send with
      // "incorrect or low gas price". Pull a forced fresh estimate too and take
      // the higher of the two.
      coinApiService.getAccountFeeEstimate(params.coinId, 8_000, { force: true }).catch(() => null),
    ])
    const { signGasLimit, gasPrice, reserveFeeWei, feeWei } = effectiveGasPlan(context, freshFee, params.feeCoin)
    const spendableBase = BigInt(Math.max(0, Math.floor(balance.balance_spendable ?? balance.balance ?? 0)))
    const spendableWei = spendableBase * WEI_PER_UI_BASE
    const valueWei = params.sendMax
      ? (() => {
          if (spendableWei <= reserveFeeWei) throw new Error('Insufficient balance for the amount and network fee')
          return spendableWei - reserveFeeWei
        })()
      : requestedValueWei ?? parseQuai(params.amountCoin)
    if (valueWei + reserveFeeWei > spendableWei) {
      throw new Error('Insufficient balance for gas * price + value')
    }
    quaiDebugLog('send.quai.gasPlan', {
      from: fromAddress,
      to: params.toAddress,
      sendMax: params.sendMax === true,
      requestedAmount: params.amountCoin,
      amount: formatQuai(valueWei),
      spendable: formatQuai(spendableWei),
      gasLimit: signGasLimit.toString(),
      gasPrice: gasPrice.toString(),
      reserveFee: formatQuai(reserveFeeWei),
      expectedFee: formatQuai(feeWei),
      fee: formatQuai(feeWei),
      context: {
        gasLimit: context.gasLimit,
        gasPrice: context.gasPrice,
        fee: context.fee,
        nonce: context.nonce,
        source: context.source,
      },
      freshFee: freshFee
        ? {
            gasLimit: freshFee.gasLimit,
            gasPrice: freshFee.gasPrice,
            fee: freshFee.fee,
            source: freshFee.source,
          }
        : null,
    })

    const signedTx = await wallet.signTransaction({
      type: 0,
      from: fromAddress,
      to: params.toAddress,
      value: valueWei,
      chainId: BigInt(context.chainId ?? 9),
      nonce: context.nonce,
      gasLimit: signGasLimit,
      gasPrice,
      data: '0x',
    })
    const txid = QuaiTransaction.from(signedTx).hash
    if (!txid) throw new Error('Quai wallet engine did not return a transaction hash')
    const amountCoin = floorQuaiText(valueWei, 8)
    const feeCoin = ceilQuaiText(feeWei, 8)
    await params.onPrepared?.({ txid, amountCoin, feeCoin })
    const broadcastTxid = await coinApiService.broadcast(params.coinId, signedTx)
    return {
      txid: broadcastTxid || txid,
      amountCoin,
      feeCoin,
    }
  },
}
