import {
  Address,
  Cell,
  ClientPublicMainnet,
  SignerCkbPrivateKey,
  Transaction,
  stringify,
} from '@ckb-ccc/core'
import { HDNodeWallet } from 'ethers'
import { coinApiService, type Utxo } from './coinApiService'

const SHANNONS_PER_CKB = 100_000_000n
const DEFAULT_FEE_RATE = 1_000n
const MAX_SEND_FEE_RESERVE = SHANNONS_PER_CKB

const parseCkbAmount = (value: string) => {
  const normalized = value.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('Invalid CKB amount')
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > 8) throw new Error('CKB amount has too many decimal places')
  return BigInt(whole) * SHANNONS_PER_CKB + BigInt((fraction + '00000000').slice(0, 8))
}

const shannonsText = (amount: bigint) => {
  const whole = amount / SHANNONS_PER_CKB
  const fraction = (amount % SHANNONS_PER_CKB).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

const privateKeyFromMnemonic = (mnemonic: string) =>
  HDNodeWallet.fromPhrase(
    mnemonic.trim().toLowerCase().replace(/\s+/g, ' '),
    undefined,
    "m/44'/309'/0'/0/0",
  ).privateKey

const walletKey = async (mnemonic: string) => {
  const client = new ClientPublicMainnet()
  const privateKey = privateKeyFromMnemonic(mnemonic)
  const signer = new SignerCkbPrivateKey(client, privateKey)
  const address = await signer.getRecommendedAddressObj()
  return { client, signer, privateKey, address, addressText: address.toString() }
}

const cellFromUtxo = (utxo: Utxo) => {
  if (!utxo.cellOutput) throw new Error('CKB node returned a cell without cellOutput')
  return Cell.from({
    outPoint: { txHash: utxo.txid, index: utxo.outputIndex },
    cellOutput: {
      capacity: BigInt(utxo.cellOutput.capacity),
      lock: utxo.cellOutput.lock,
      type: utxo.cellOutput.type,
    },
    outputData: utxo.outputData ?? '0x',
  })
}

const feeRateShannonsPerKb = async (coinId: string, force = false) => {
  const fee = await coinApiService.getFeeRate(coinId, 1, 12_000, { force }).catch(() => null)
  if (!fee || !Number.isFinite(fee.feerate) || fee.feerate <= 0) return DEFAULT_FEE_RATE
  return BigInt(Math.max(1_000, Math.ceil(fee.feerate * Number(SHANNONS_PER_CKB))))
}

const sumOutputs = (transaction: Transaction) =>
  transaction.outputs.reduce((sum, output) => sum + output.capacity, 0n)

const buildSignedTransaction = async (params: {
  mnemonic: string
  toAddress: string
  utxos: Utxo[]
  amount: bigint
  feeRate: bigint
  sendMax: boolean
}) => {
  const wallet = await walletKey(params.mnemonic)
  const destination = await Address.fromString(params.toAddress, wallet.client)
  const cells = params.utxos.map(cellFromUtxo)
  const totalInput = cells.reduce((sum, cell) => sum + cell.cellOutput.capacity, 0n)
  if (totalInput <= 0n) throw new Error('No spendable CKB cells')
  await wallet.client.cache.recordCells(cells)

  const amount = params.sendMax
    ? (() => {
        if (totalInput <= MAX_SEND_FEE_RESERVE) throw new Error('CKB balance is too small to cover the network fee')
        return totalInput - MAX_SEND_FEE_RESERVE
      })()
    : params.amount
  const transaction = Transaction.from({
    outputs: [{ capacity: amount, lock: destination.script }],
  })
  const minimumOutput = BigInt(transaction.outputs[0].occupiedSize) * SHANNONS_PER_CKB
  if (amount < minimumOutput) throw new Error(`CKB recipient output must be at least ${shannonsText(minimumOutput)} CKB`)
  for (const cell of cells) transaction.addInput({ previousOutput: cell.outPoint })

  if (params.sendMax) {
    await transaction.completeFeeChangeToOutput(
      wallet.signer,
      0,
      params.feeRate,
      undefined,
      { shouldAddInputs: false },
    )
  } else {
    await transaction.completeFeeChangeToLock(
      wallet.signer,
      wallet.address.script,
      params.feeRate,
      undefined,
      { shouldAddInputs: false },
    )
  }
  const signed = await wallet.signer.signOnlyTransaction(transaction)
  const fee = totalInput - sumOutputs(signed)
  const sentAmount = signed.outputs[0]?.capacity ?? amount
  return { signed, fee, sentAmount, fromAddress: wallet.addressText }
}

export const ckbWalletService = {
  async deriveAddress(mnemonic: string) {
    return (await walletKey(mnemonic)).addressText
  },

  async exportPrivateKey(mnemonic: string) {
    return privateKeyFromMnemonic(mnemonic)
  },

  async isValidAddress(address: string) {
    try {
      await Address.fromString(address.trim(), new ClientPublicMainnet())
      return address.trim().startsWith('ckb1')
    } catch {
      return false
    }
  },

  async estimateFee(coinId: string) {
    const fee = await feeRateShannonsPerKb(coinId)
    return { satoshis: Number(fee), coin: shannonsText(fee) }
  },

  async estimateMaxSend(coinId: string, address: string) {
    const utxos = await coinApiService.getUtxos(coinId, address, { force: true })
    if (utxos.length === 0) throw new Error('No spendable CKB cells')
    const total = utxos.reduce((sum, utxo) => sum + BigInt(utxo.cellOutput?.capacity ?? utxo.satoshis), 0n)
    const reserve = total > MAX_SEND_FEE_RESERVE ? MAX_SEND_FEE_RESERVE : total
    return {
      amountCoin: shannonsText(total - reserve),
      feeCoin: shannonsText(reserve),
      feeSatoshis: Number(reserve),
      inputCount: utxos.length,
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
    const derived = await this.deriveAddress(params.mnemonic)
    if (derived !== params.fromAddress) throw new Error('CKB address does not match this wallet')
    if (!(await this.isValidAddress(params.toAddress))) throw new Error('Invalid CKB address')
    const utxos = await coinApiService.getUtxos(params.coinId, derived, { force: true })
    if (utxos.length === 0) throw new Error('No spendable CKB cells')
    const amount = params.sendMax ? 0n : parseCkbAmount(params.amountCoin)
    if (!params.sendMax && amount <= 0n) throw new Error('Amount must be greater than 0')
    const built = await buildSignedTransaction({
      mnemonic: params.mnemonic,
      toAddress: params.toAddress,
      utxos,
      amount,
      feeRate: await feeRateShannonsPerKb(params.coinId, true),
      sendMax: params.sendMax === true,
    })
    const transaction = JSON.parse(stringify(built.signed)) as unknown
    const envelope = JSON.stringify({
      transaction,
      txid: built.signed.hash(),
      from: built.fromAddress,
      to: params.toAddress,
      amount: built.sentAmount.toString(),
      fee: built.fee.toString(),
    })
    const txid = await coinApiService.broadcast(params.coinId, envelope, built.signed.hash())
    return { txid, amountCoin: shannonsText(built.sentAmount), feeCoin: shannonsText(built.fee) }
  },
}
