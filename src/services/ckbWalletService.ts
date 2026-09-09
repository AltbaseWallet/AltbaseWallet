import {
  Address,
  Cell,
  ClientPublicMainnet,
  SignerCkbPrivateKey,
  SignerCkbScriptReadonly,
  KnownScript,
  type Signer,
  type TransactionLike,
  Transaction,
  stringify,
} from '@ckb-ccc/core'
import { HDNodeWallet } from 'ethers'
import { coinApiService, type Utxo } from './coinApiService'
import { assertApprovedSpend } from '../utils/sendFeePolicy'
import { assertProvenCkbCell } from '../utils/ckbTransactionProof'

const SHANNONS_PER_CKB = 100_000_000n
const DEFAULT_FEE_RATE = 1_000n
// Use HTTPS explicitly: the renderer allows these public RPC origins, while
// the SDK's default WebSocket transport is outside the connection policy.
const createClient = () => new ClientPublicMainnet({
  url: 'https://mainnet.ckb.dev/',
  fallbacks: ['https://mainnet.ckbapp.dev/'],
  timeout: 15_000,
})

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
  const client = createClient()
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

class CkbFeeEstimator extends SignerCkbScriptReadonly {
  async prepareTransaction(txLike: TransactionLike) {
    const tx = Transaction.from(txLike)
    await tx.prepareSighashAllWitness(this.scripts[0], 65, this.client)
    await tx.addCellDepInfos(this.client, (await this.client.getKnownScript(KnownScript.Secp256k1Blake160)).cellDeps)
    return tx
  }
}

const readonlyWallet = async (addressText: string) => {
  const client = createClient()
  const address = await Address.fromString(addressText, client)
  const known = await client.getKnownScript(KnownScript.Secp256k1Blake160)
  if (address.script.codeHash !== known.codeHash || address.script.hashType !== known.hashType || address.script.args.length !== 42) {
    throw new Error('CKB MAX supports plain secp256k1 addresses only')
  }
  return {client, address, addressText, signer: new CkbFeeEstimator(client, address.script)}
}

const buildUnsignedTransaction = async (params: {
  wallet: {client: ClientPublicMainnet; signer: Signer; address: Address; addressText: string}
  toAddress: string
  utxos: Utxo[]
  amount: bigint
  feeRate: bigint
  sendMax: boolean
}) => {
  const wallet = params.wallet
  const destination = await Address.fromString(params.toAddress, wallet.client)
  const cells = params.utxos.map(cellFromUtxo)
  const totalInput = cells.reduce((sum, cell) => sum + cell.cellOutput.capacity, 0n)
  if (totalInput <= 0n) throw new Error('No spendable CKB cells')
  const transaction = Transaction.from({
    outputs: [{ capacity: params.sendMax ? 0n : params.amount, lock: destination.script }],
  })
  const minimumOutput = BigInt(transaction.outputs[0].occupiedSize) * SHANNONS_PER_CKB
  // Start MAX at the cell's occupied capacity. The SDK adds all remaining
  // capacity after computing the actual fee; no fixed one-CKB reserve is needed.
  const amount = params.sendMax ? minimumOutput : params.amount
  if (amount < minimumOutput) throw new Error(`CKB recipient output must be at least ${shannonsText(minimumOutput)} CKB`)
  if (params.sendMax && totalInput <= minimumOutput) {
    throw new Error(`CKB MAX requires at least ${shannonsText(minimumOutput)} CKB for the recipient cell plus the network fee`)
  }
  transaction.outputs[0].capacity = amount
  const proofs = new Map<string, Transaction>()
  const hashes = [...new Set(cells.map(cell => cell.outPoint.txHash))]
  // Bound concurrent proof lookups; a wallet with many cells must not make
  // one full RPC timeout per cell in sequence.
  for (let offset = 0; offset < hashes.length; offset += 4) {
    await Promise.all(hashes.slice(offset, offset + 4).map(async hash => {
      const parent = (await wallet.client.getTransaction(hash))?.transaction
      if (parent) proofs.set(hash, parent)
    }))
  }
  for (const cell of cells) {
    if (!cell.cellOutput.lock.eq(wallet.address.script) || cell.cellOutput.type || cell.outputData !== '0x') {
      throw new Error('CKB input is not a plain cell belonging to this address')
    }
    assertProvenCkbCell(proofs.get(cell.outPoint.txHash), cell)
  }
  await wallet.client.cache.recordCells(cells)
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
  if (transaction.outputs[0].capacity < minimumOutput) {
    throw new Error(`CKB MAX requires at least ${shannonsText(minimumOutput)} CKB for the recipient cell plus the network fee`)
  }
  const fee = totalInput - sumOutputs(transaction)
  const sentAmount = transaction.outputs[0]?.capacity ?? amount
  return { transaction, fee, sentAmount, fromAddress: wallet.addressText }
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
      await Address.fromString(address.trim(), createClient())
      return address.trim().startsWith('ckb1')
    } catch {
      return false
    }
  },

  async estimateFee(coinId: string, options: { fromAddress?: string; force?: boolean } = {}) {
    const rate = await feeRateShannonsPerKb(coinId, options.force)
    const inputs = options.fromAddress
      ? (await coinApiService.getUtxos(coinId, options.fromAddress, { force: options.force, priority: true })).length
      : 1
    // This wallet spends all plain secp256k1 cells. Budget 48 bytes per input
    // plus 512 for two outputs, dependencies and the signature witness.
    const bytes = BigInt(Math.max(1_000, 512 + inputs * 48))
    const fee = (rate * bytes + 999n) / 1_000n
    return { satoshis: Number(fee), coin: shannonsText(fee) }
  },

  async estimateMaxSend(coinId: string, address: string, toAddress?: string) {
    if (!toAddress) throw new Error('Enter the CKB recipient before using MAX')
    if (!(await this.isValidAddress(toAddress))) throw new Error('Invalid CKB address')
    const utxos = await coinApiService.getUtxos(coinId, address, { force: true, priority: true })
    if (utxos.length === 0) throw new Error('No spendable CKB cells')
    const built = await buildUnsignedTransaction({
      wallet: await readonlyWallet(address),
      toAddress,
      utxos,
      amount: 0n,
      feeRate: await feeRateShannonsPerKb(coinId, true),
      sendMax: true,
    })
    return {
      amountCoin: shannonsText(built.sentAmount),
      feeCoin: shannonsText(built.fee),
      feeSatoshis: Number(built.fee),
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
    maxFeeCoin?: string
  }) {
    const derived = await this.deriveAddress(params.mnemonic)
    if (derived !== params.fromAddress) throw new Error('CKB address does not match this wallet')
    if (!(await this.isValidAddress(params.toAddress))) throw new Error('Invalid CKB address')
    const utxos = await coinApiService.getUtxos(params.coinId, derived, { force: true, priority: true })
    if (utxos.length === 0) throw new Error('No spendable CKB cells')
    const expectedMaxAmount = params.sendMax ? parseCkbAmount(params.amountCoin) : null
    const amount = params.sendMax ? 0n : parseCkbAmount(params.amountCoin)
    if (!params.sendMax && amount <= 0n) throw new Error('Amount must be greater than 0')
    const wallet = await walletKey(params.mnemonic)
    const built = await buildUnsignedTransaction({
      wallet,
      toAddress: params.toAddress,
      utxos,
      amount,
      feeRate: await feeRateShannonsPerKb(params.coinId, true),
      sendMax: params.sendMax === true,
    })
    if (expectedMaxAmount !== null && built.sentAmount !== expectedMaxAmount) {
      throw new Error('CKB MAX amount changed before signing; click MAX again and confirm the updated amount')
    }
    assertApprovedSpend({ actualFee: shannonsText(built.fee), maxFee: params.maxFeeCoin,
      actualAmount: shannonsText(built.sentAmount), approvedAmount: params.amountCoin, sendMax: params.sendMax })
    const signed = await wallet.signer.signOnlyTransaction(built.transaction)
    const transaction = JSON.parse(stringify(signed)) as unknown
    const envelope = JSON.stringify({
      transaction,
      txid: signed.hash(),
      from: built.fromAddress,
      to: params.toAddress,
      amount: built.sentAmount.toString(),
      fee: built.fee.toString(),
    })
    const txid = await coinApiService.broadcast(params.coinId, envelope, signed.hash())
    return { txid, amountCoin: shannonsText(built.sentAmount), feeCoin: shannonsText(built.fee) }
  },
}
