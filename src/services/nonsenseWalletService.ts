import { coinApiService, type Utxo } from './coinApiService'
import { assertApprovedSpend } from '../utils/sendFeePolicy'
import { planNonsenseMax } from '../utils/nonsenseMaxPlan'

type NonsenseSdk = typeof import('nonsense-wasm')
type NonsenseWalletSdk = NonsenseSdk & {
  deriveNonsenseWallet: (mnemonic: string) => { address: string; privateKey: string }
  validateNonsenseAddress: (address: string) => boolean
  createSweepTransaction: (settings: unknown) => NonsenseTransactionPlan
}
type NonsensePendingTransaction = {
  readonly id: string
  readonly feeAmount: bigint
  sign: (privateKeys: string[]) => void
  serializeToSafeJSON: () => string
}
type NonsenseTransactionPlan = { transactions: NonsensePendingTransaction[] }
let sdkPromise: Promise<NonsenseSdk> | null = null
let wasmBytes: Uint8Array<ArrayBuffer> | null = null

const embeddedWasmBytes = (nonsenseWasmBase64: string) => {
  if (wasmBytes) return wasmBytes
  const binary = atob(nonsenseWasmBase64)
  wasmBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return wasmBytes
}

const nonsenseSdk = () => {
  sdkPromise ??= Promise.all([
    import('nonsense-wasm'),
    import('nonsense-wasm/nonsense_bg.base64.js'),
  ]).then(async ([sdk, embedded]) => {
    await sdk.default({ module_or_path: embeddedWasmBytes(embedded.default) })
    return sdk
  })
  return sdkPromise
}

const parseNnnAmount = (value: string) => {
  const normalized = value.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('Invalid Nonsense amount')
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > 8) throw new Error('Nonsense amount has too many decimal places')
  return BigInt(whole) * 100_000_000n + BigInt((fraction + '00000000').slice(0, 8))
}

const sompiText = (amount: bigint) => {
  const whole = amount / 100_000_000n
  const fraction = (amount % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

const walletKey = async (mnemonic: string) => {
  const sdk = await nonsenseSdk() as NonsenseWalletSdk
  const wallet = sdk.deriveNonsenseWallet(mnemonic.trim().toLowerCase().replace(/\s+/g, ' '))
  return { sdk, privateKey: wallet.privateKey, address: wallet.address }
}

const sdkUtxos = (utxos: Utxo[]) => utxos.map((utxo) => ({
  outpoint: { transactionId: utxo.txid, index: utxo.outputIndex },
  amount: BigInt(utxo.satoshis),
  scriptPublicKey: { version: utxo.scriptPublicKeyVersion ?? 0, script: utxo.script },
  blockDaaScore: BigInt(utxo.blockDaaScore ?? 0),
  isCoinbase: utxo.isCoinbase === true,
}))

const feeRateSompiPerGram = async (coinId: string, force = false) => {
  const fee = await coinApiService.getFeeRate(coinId, 1, 45_000, { force, priority: true }).catch(() => null)
  if (!fee || !Number.isFinite(fee.feerate) || fee.feerate <= 0) return 1
  return Math.max(1, Math.ceil((fee.feerate * 100_000_000) / 1_000))
}

const createPlan = async (params: {
  sdk: NonsenseSdk
  entries: ReturnType<typeof sdkUtxos>
  toAddress: string
  changeAddress: string
  amount: bigint
  feeRate: number
}): Promise<NonsenseTransactionPlan> => params.sdk.createTransactions({
  outputs: [{ address: params.toAddress, amount: params.amount }],
  changeAddress: params.changeAddress,
  feeRate: params.feeRate,
  priorityFee: 0n,
  entries: params.entries,
  networkId: 'mainnet',
}) as NonsenseTransactionPlan

const createSweepPlan = (params: {
  sdk: NonsenseWalletSdk
  entries: ReturnType<typeof sdkUtxos>
  toAddress: string
  feeRate: number
}): NonsenseTransactionPlan => params.sdk.createSweepTransaction({
  address: params.toAddress,
  feeRate: params.feeRate,
  priorityFee: 0n,
  entries: params.entries,
  networkId: 'mainnet',
})

const estimateSendPlan = async (params: {
  coinId: string
  fromAddress: string
  toAddress: string
  amountCoin: string
  force?: boolean
}) => {
  const [sdk, utxos, feeRate] = await Promise.all([
    nonsenseSdk() as Promise<NonsenseWalletSdk>,
    coinApiService.getUtxos(params.coinId, params.fromAddress, { force: params.force === true, priority: true }),
    feeRateSompiPerGram(params.coinId, params.force === true),
  ])
  if (!sdk.validateNonsenseAddress(params.toAddress.trim())) throw new Error('Invalid Nonsense address')
  if (utxos.length === 0) throw new Error('No spendable Nonsense UTXOs')
  const amount = parseNnnAmount(params.amountCoin)
  if (amount <= 0n) throw new Error('Amount must be greater than 0')
  const plan = await createPlan({
    sdk,
    entries: sdkUtxos(utxos),
    toAddress: params.toAddress.trim(),
    changeAddress: params.fromAddress,
    amount,
    feeRate,
  })
  const fee = plan.transactions.reduce((sum, transaction) => sum + transaction.feeAmount, 0n)
  return { plan, amount, fee, inputCount: utxos.length }
}

const estimateMaxPlan = async (coinId: string, address: string, toAddress = address) => {
  const [sdk, utxos, feeRate] = await Promise.all([
    nonsenseSdk() as Promise<NonsenseWalletSdk>,
    coinApiService.getUtxos(coinId, address, { force: true, priority: true }),
    feeRateSompiPerGram(coinId, true),
  ])
  const recipient = toAddress.trim() || address
  if (!sdk.validateNonsenseAddress(recipient)) throw new Error('Invalid Nonsense address')
  if (utxos.length === 0) throw new Error('No spendable Nonsense UTXOs')
  const entries = sdkUtxos(utxos)
  const selected = planNonsenseMax(entries, entries => createSweepPlan({ sdk, entries, toAddress: recipient, feeRate }))
  const total = selected.entries.reduce((sum, entry) => sum + entry.amount, 0n)
  const plan = selected.plan
  const fee = plan.transactions.reduce((sum, tx) => sum + tx.feeAmount, 0n)
  if (fee >= total) throw new Error('Nonsense balance is too small to cover the network fee')
  return { amount: total - fee, fee, inputCount: selected.entries.length,
    remainingInputCount: selected.remainingInputCount, remainingAmount: selected.remainingAmount }
}

export const nonsenseWalletService = {
  async deriveAddress(mnemonic: string) {
    return (await walletKey(mnemonic)).address
  },

  async exportPrivateKey(mnemonic: string) {
    return (await walletKey(mnemonic)).privateKey
  },

  async isValidAddress(address: string) {
    try {
      const sdk = await nonsenseSdk() as NonsenseWalletSdk
      return sdk.validateNonsenseAddress(address.trim())
    } catch {
      return false
    }
  },

  async estimateFee(coinId: string) {
    const rate = await feeRateSompiPerGram(coinId)
    const fee = BigInt(Math.max(1_000, Math.ceil(rate * 1_000)))
    return { satoshis: Number(fee), coin: sompiText(fee) }
  },

  async estimateSendFee(params: {
    coinId: string
    fromAddress: string
    toAddress: string
    amountCoin: string
    force?: boolean
  }) {
    const result = await estimateSendPlan(params)
    return {
      satoshis: Number(result.fee),
      coin: sompiText(result.fee),
      inputCount: result.inputCount,
    }
  },

  async estimateMaxSend(coinId: string, address: string, toAddress?: string) {
    const plan = await estimateMaxPlan(coinId, address, toAddress)
    return {
      amountCoin: sompiText(plan.amount),
      feeCoin: sompiText(plan.fee),
      feeSatoshis: Number(plan.fee),
      inputCount: plan.inputCount,
      remainingInputCount: plan.remainingInputCount,
      remainingAmountCoin: sompiText(plan.remainingAmount),
    }
  },

  async send(params: {
    coinId: string
    mnemonic: string
    fromAddress: string
    toAddress: string
    amountCoin: string
    sendMax?: boolean
    maxFeeCoin?: string
  }) {
    const { sdk: loadedSdk, privateKey, address } = await walletKey(params.mnemonic)
    const sdk = loadedSdk as NonsenseWalletSdk
    if (address !== params.fromAddress) throw new Error('Nonsense address does not match this wallet')
    if (!(await this.isValidAddress(params.toAddress))) throw new Error('Invalid Nonsense address')
    const [utxos, feeRate] = await Promise.all([
      coinApiService.getUtxos(params.coinId, address, { force: true, priority: true }),
      feeRateSompiPerGram(params.coinId, true),
    ])
    if (utxos.length === 0) throw new Error('No spendable Nonsense UTXOs')
    let entries = sdkUtxos(utxos)
    const maxPlan = params.sendMax
      ? planNonsenseMax(entries, entries => createSweepPlan({ sdk, entries, toAddress: params.toAddress, feeRate }))
      : null
    if (maxPlan) entries = maxPlan.entries
    const plan = params.sendMax
      ? maxPlan!.plan
      : await createPlan({
        sdk,
        entries,
        toAddress: params.toAddress,
        changeAddress: address,
        amount: parseNnnAmount(params.amountCoin),
        feeRate,
      })
    const totalFee = plan.transactions.reduce((sum, pending) => sum + pending.feeAmount, 0n)
    const totalInput = entries.reduce((sum, entry) => sum + entry.amount, 0n)
    const amount = params.sendMax ? totalInput - totalFee : parseNnnAmount(params.amountCoin)
    if (amount <= 0n) throw new Error('Amount must be greater than 0')
    assertApprovedSpend({ actualFee: sompiText(totalFee), maxFee: params.maxFeeCoin,
      actualAmount: sompiText(amount), approvedAmount: params.amountCoin, sendMax: params.sendMax })
    if (plan.transactions.length === 0) throw new Error('Nonsense signing library returned no transactions')
    let finalTxid = ''
    let signedFee = 0n
    for (const pending of plan.transactions) {
      pending.sign([privateKey])
      signedFee += pending.feeAmount
      const transaction = JSON.parse(pending.serializeToSafeJSON()) as unknown
      const envelope = JSON.stringify({
        transaction,
        txid: pending.id,
        from: address,
        to: params.toAddress,
        amount: amount.toString(),
        fee: pending.feeAmount.toString(),
      })
      finalTxid = await coinApiService.broadcast(params.coinId, envelope, pending.id)
    }
    return { txid: finalTxid, amountCoin: sompiText(amount), feeCoin: sompiText(signedFee) }
  },
}
