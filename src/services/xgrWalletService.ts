import {
  HDNodeWallet,
  Transaction,
  formatEther,
  isAddress,
  keccak256,
  parseEther,
} from 'ethers'
import { atomicAmountToBigInt, coinApiService, type AccountFeeEstimate } from './coinApiService'

export const XGR_CHAIN_ID = 1643
export const XGR_DERIVATION_PATH = "m/44'/60'/0'/0/0"

const XGR_COIN_ID = 'xgr'
const WEI_PER_UI_BASE = 10_000_000_000n
const NATIVE_TRANSFER_GAS = 21_000n

const trimCoinText = (value: string, decimals = 12) => {
  const [whole, fraction = ''] = value.split('.')
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

const ceilCoinText = (wei: bigint, decimals = 8) => {
  const factor = 10n ** BigInt(18 - decimals)
  const rounded = wei === 0n ? 0n : ((wei + factor - 1n) / factor) * factor
  return trimCoinText(formatEther(rounded), decimals)
}

const floorCoinText = (wei: bigint, decimals = 8) => {
  const factor = 10n ** BigInt(18 - decimals)
  return trimCoinText(formatEther((wei / factor) * factor), decimals)
}

const ceilDiv = (value: bigint, divisor: bigint) =>
  value === 0n ? 0n : (value + divisor - 1n) / divisor

const positiveBigInt = (value: unknown, fallback = 0n) => {
  try {
    const parsed = BigInt(String(value ?? ''))
    return parsed > 0n ? parsed : fallback
  } catch {
    return fallback
  }
}

const ensureWallet = (mnemonic: string) =>
  HDNodeWallet.fromPhrase(mnemonic, undefined, XGR_DERIVATION_PATH)

type XgrFeeContext = AccountFeeEstimate & {
  maxFeePerGas?: string | number | bigint
  maxPriorityFeePerGas?: string | number | bigint
  transactionType?: string
}

const gasPlan = (context: XgrFeeContext, requestedFeeCoin?: string) => {
  const gasLimit = positiveBigInt(context.gasLimit, NATIVE_TRANSFER_GAS)
  const legacyGasPrice = positiveBigInt(context.gasPrice)
  const contextMaxFee = positiveBigInt(context.maxFeePerGas)
  const maxPriorityFeePerGas = positiveBigInt(context.maxPriorityFeePerGas)
  const networkPrice = contextMaxFee > 0n ? contextMaxFee : legacyGasPrice
  if (networkPrice <= 0n) throw new Error('XGR node returned an invalid gas price')

  const requestedPrice = requestedFeeCoin
    ? ceilDiv(parseEther(requestedFeeCoin), gasLimit)
    : 0n
  const signingPrice = requestedPrice > networkPrice ? requestedPrice : networkPrice
  const useEip1559 = contextMaxFee > 0n || context.transactionType === 'eip1559'

  return {
    gasLimit,
    feeWei: signingPrice * gasLimit,
    transactionFields: useEip1559
      ? {
          type: 2 as const,
          maxFeePerGas: signingPrice,
          maxPriorityFeePerGas: maxPriorityFeePerGas > signingPrice ? signingPrice : maxPriorityFeePerGas,
        }
      : {
          type: 0 as const,
          gasPrice: signingPrice,
        },
  }
}

export const xgrWalletService = {
  deriveAddress(mnemonic: string) {
    return ensureWallet(mnemonic).address
  },

  getPrivateKey(mnemonic: string) {
    return ensureWallet(mnemonic).privateKey
  },

  isValidAddress(address: string) {
    return isAddress(String(address || '').trim())
  },

  async estimateFee(coinId = XGR_COIN_ID, options: {
    force?: boolean
    fromAddress?: string
    toAddress?: string
    amountCoin?: string
  } = {}) {
    // A native XGR transfer always uses 21,000 gas. Fee rendering and MAX do
    // not need a nonce or a recipient-specific transaction context. Keeping
    // those reads on the cached fee endpoint prevents three serial native
    // requests from piling up while the send form is being edited.
    const context = await coinApiService.getAccountFeeEstimate(coinId, 12_000, options) as XgrFeeContext
    const { feeWei } = gasPlan(context)
    return {
      satoshis: Math.max(1, Number(ceilDiv(feeWei, WEI_PER_UI_BASE))),
      coin: ceilCoinText(feeWei, 8),
    }
  },

  async estimateMaxSend(
    coinId: string,
    address: string,
    feeCoin?: string,
    _toAddress?: string,
    knownSpendableCoin?: string,
  ) {
    const [balance, context] = await Promise.all([
      knownSpendableCoin === undefined
        ? coinApiService.getBalance(coinId, address)
        : Promise.resolve(null),
      coinApiService.getAccountFeeEstimate(coinId, 12_000) as Promise<XgrFeeContext>,
    ])
    const spendableWei = knownSpendableCoin !== undefined
      ? parseEther(knownSpendableCoin || '0')
      : (() => {
          const spendableBase = atomicAmountToBigInt(balance?.balance_spendable ?? balance?.balance)
          return (spendableBase > 0n ? spendableBase : 0n) * WEI_PER_UI_BASE
        })()
    const { feeWei } = gasPlan(context, feeCoin)
    const amountWei = spendableWei > feeWei ? spendableWei - feeWei : 0n
    return {
      amountCoin: floorCoinText(amountWei, 8),
      feeCoin: ceilCoinText(feeWei, 8),
      feeSatoshis: Number(ceilDiv(feeWei, WEI_PER_UI_BASE)),
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
    knownSpendableCoin?: string
  }) {
    if (!isAddress(params.toAddress)) throw new Error('Invalid XGR address')

    const wallet = ensureWallet(params.mnemonic)
    const fromAddress = params.fromAddress || wallet.address
    if (fromAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error('XGR address does not match this wallet')
    }

    const requestedValueWei = params.sendMax ? undefined : parseEther(params.amountCoin)
    const [context, balance] = await Promise.all([
      coinApiService.getAccountTxContext(
        params.coinId,
        fromAddress,
        params.toAddress,
        { valueWeiHex: requestedValueWei === undefined ? undefined : `0x${requestedValueWei.toString(16)}` },
      ) as Promise<XgrFeeContext & { nonce: number }>,
      params.knownSpendableCoin === undefined
        ? coinApiService.getBalance(params.coinId, fromAddress, { priority: true })
        : Promise.resolve(null),
    ])
    const { gasLimit, feeWei, transactionFields } = gasPlan(context, params.feeCoin)
    const spendableWei = params.knownSpendableCoin === undefined
      ? (() => {
          const spendableBase = atomicAmountToBigInt(balance?.balance_spendable ?? balance?.balance)
          return (spendableBase > 0n ? spendableBase : 0n) * WEI_PER_UI_BASE
        })()
      : parseEther(params.knownSpendableCoin || '0')
    const valueWei = params.sendMax
      ? (() => {
          if (spendableWei <= feeWei) throw new Error('Insufficient XGR balance for the network fee')
          return spendableWei - feeWei
        })()
      : requestedValueWei ?? parseEther(params.amountCoin)
    if (valueWei <= 0n) throw new Error('XGR amount must be greater than zero')
    if (valueWei + feeWei > spendableWei) {
      throw new Error('Insufficient XGR balance for the amount and network fee')
    }

    const chainId = Number(context.chainId ?? XGR_CHAIN_ID)
    if (chainId !== XGR_CHAIN_ID) throw new Error(`Unexpected XGR chain id: ${chainId}`)
    const signedTx = await wallet.signTransaction({
      ...transactionFields,
      chainId,
      nonce: context.nonce,
      gasLimit,
      to: params.toAddress,
      value: valueWei,
      data: '0x',
    })
    const parsed = Transaction.from(signedTx)
    const txid = parsed.hash ?? keccak256(signedTx)
    const broadcastTxid = await coinApiService.broadcast(params.coinId, signedTx, txid)
    return {
      txid: broadcastTxid || txid,
      amountCoin: floorCoinText(valueWei, 8),
      feeCoin: ceilCoinText(feeWei, 8),
    }
  },
}
