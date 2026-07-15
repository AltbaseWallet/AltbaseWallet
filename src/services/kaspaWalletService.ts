import { coinApiService, type Utxo } from './coinApiService'

type KaspaSdk = typeof import('kaspa-wasm')
type KaspaWalletSdk = KaspaSdk & {
  deriveKaspaWallet: (mnemonic: string) => { address: string; privateKey: string }
  validateKaspaAddress: (address: string) => boolean
  createSweepTransaction: (settings: unknown) => KaspaTransactionPlan
}
type KaspaPendingTransaction = {
  readonly id: string
  readonly feeAmount: bigint
  sign: (privateKeys: string[]) => void
  serializeToSafeJSON: () => string
}
type KaspaTransactionPlan = { transactions: KaspaPendingTransaction[] }
let sdkPromise: Promise<KaspaSdk> | null = null
let wasmBytes: Uint8Array<ArrayBuffer> | null = null

const embeddedWasmBytes = (kaspaWasmBase64: string) => {
  if (wasmBytes) return wasmBytes
  const binary = atob(kaspaWasmBase64)
  wasmBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return wasmBytes
}

const kaspaSdk = () => {
  sdkPromise ??= Promise.all([
    import('kaspa-wasm'),
    import('kaspa-wasm/kaspa_bg.base64.js'),
  ]).then(async ([sdk, embedded]) => {
    await sdk.default({ module_or_path: embeddedWasmBytes(embedded.default) })
    return sdk
  })
  return sdkPromise
}

const parseKasAmount = (value: string) => {
  const normalized = value.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('Invalid Kaspa amount')
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > 8) throw new Error('Kaspa amount has too many decimal places')
  return BigInt(whole) * 100_000_000n + BigInt((fraction + '00000000').slice(0, 8))
}

const sompiText = (amount: bigint) => {
  const whole = amount / 100_000_000n
  const fraction = (amount % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

const walletKey = async (mnemonic: string) => {
  const sdk = await kaspaSdk() as KaspaWalletSdk
  const wallet = sdk.deriveKaspaWallet(mnemonic.trim().toLowerCase().replace(/\s+/g, ' '))
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
  const fee = await coinApiService.getFeeRate(coinId, 1, 12_000, { force }).catch(() => null)
  if (!fee || !Number.isFinite(fee.feerate) || fee.feerate <= 0) return 1
  return Math.max(1, Math.ceil((fee.feerate * 100_000_000) / 1_000))
}

const createPlan = async (params: {
  sdk: KaspaSdk
  entries: ReturnType<typeof sdkUtxos>
  toAddress: string
  changeAddress: string
  amount: bigint
  feeRate: number
}): Promise<KaspaTransactionPlan> => params.sdk.createTransactions({
  outputs: [{ address: params.toAddress, amount: params.amount }],
  changeAddress: params.changeAddress,
  feeRate: params.feeRate,
  priorityFee: 0n,
  entries: params.entries,
  networkId: 'mainnet',
}) as KaspaTransactionPlan

const createSweepPlan = (params: {
  sdk: KaspaWalletSdk
  entries: ReturnType<typeof sdkUtxos>
  toAddress: string
  feeRate: number
}): KaspaTransactionPlan => params.sdk.createSweepTransaction({
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
  const sdk = await kaspaSdk() as KaspaWalletSdk
  if (!sdk.validateKaspaAddress(params.toAddress.trim())) throw new Error('Invalid Kaspa address')
  const utxos = await coinApiService.getUtxos(params.coinId, params.fromAddress, { force: params.force === true })
  if (utxos.length === 0) throw new Error('No spendable Kaspa UTXOs')
  const amount = parseKasAmount(params.amountCoin)
  if (amount <= 0n) throw new Error('Amount must be greater than 0')
  const feeRate = await feeRateSompiPerGram(params.coinId, params.force === true)
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
  const sdk = await kaspaSdk() as KaspaWalletSdk
  const recipient = toAddress.trim() || address
  if (!sdk.validateKaspaAddress(recipient)) throw new Error('Invalid Kaspa address')
  const utxos = await coinApiService.getUtxos(coinId, address, { force: true })
  if (utxos.length === 0) throw new Error('No spendable Kaspa UTXOs')
  const entries = sdkUtxos(utxos)
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0n)
  const feeRate = await feeRateSompiPerGram(coinId, true)
  const plan = createSweepPlan({ sdk, entries, toAddress: recipient, feeRate })
  const fee = plan.transactions.reduce((sum, tx) => sum + tx.feeAmount, 0n)
  if (fee >= total) throw new Error('Kaspa balance is too small to cover the network fee')
  return { amount: total - fee, fee, inputCount: utxos.length }
}

export const kaspaWalletService = {
  async deriveAddress(mnemonic: string) {
    return (await walletKey(mnemonic)).address
  },

  async exportPrivateKey(mnemonic: string) {
    return (await walletKey(mnemonic)).privateKey
  },

  async isValidAddress(address: string) {
    try {
      const sdk = await kaspaSdk() as KaspaWalletSdk
      return sdk.validateKaspaAddress(address.trim())
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
    }
  },

  async send(params: {
    coinId: string
    mnemonic: string
    fromAddress: string
    toAddress: string
    amountCoin: string
    sendMax?: boolean
  }) {
    const { sdk: loadedSdk, privateKey, address } = await walletKey(params.mnemonic)
    const sdk = loadedSdk as KaspaWalletSdk
    if (address !== params.fromAddress) throw new Error('Kaspa address does not match this wallet')
    if (!(await this.isValidAddress(params.toAddress))) throw new Error('Invalid Kaspa address')
    const utxos = await coinApiService.getUtxos(params.coinId, address, { force: true })
    if (utxos.length === 0) throw new Error('No spendable Kaspa UTXOs')
    const entries = sdkUtxos(utxos)
    const feeRate = await feeRateSompiPerGram(params.coinId, true)
    const plan = params.sendMax
      ? createSweepPlan({ sdk, entries, toAddress: params.toAddress, feeRate })
      : await createPlan({
        sdk,
        entries,
        toAddress: params.toAddress,
        changeAddress: address,
        amount: parseKasAmount(params.amountCoin),
        feeRate,
      })
    const totalFee = plan.transactions.reduce((sum, pending) => sum + pending.feeAmount, 0n)
    const totalInput = entries.reduce((sum, entry) => sum + entry.amount, 0n)
    const amount = params.sendMax ? totalInput - totalFee : parseKasAmount(params.amountCoin)
    if (amount <= 0n) throw new Error('Amount must be greater than 0')
    if (plan.transactions.length === 0) throw new Error('Kaspa signing library returned no transactions')
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
