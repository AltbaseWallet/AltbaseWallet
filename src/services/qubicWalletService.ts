import { QubicHelper } from '@qubic-lib/qubic-ts-library/dist/qubicHelper'
import { coinApiService } from './coinApiService'

const helper = new QubicHelper()
const QUBIC_SEED_LENGTH = 55

const qubicSeedFromMnemonic = async (mnemonic: string) => {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const material = new TextEncoder().encode(`altbase-qubic-v1\0${normalized}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material))
  let value = 0n
  for (const byte of digest) value = (value << 8n) | BigInt(byte)

  let seed = ''
  while (value > 0n) {
    seed = String.fromCharCode(97 + Number(value % 26n)) + seed
    value /= 26n
  }
  return seed.padStart(QUBIC_SEED_LENGTH, 'a').slice(-QUBIC_SEED_LENGTH)
}

const parseQuAmount = (value: string) => {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) throw new Error('Qubic amount must be a whole number of QU')
  const amount = BigInt(normalized)
  if (amount <= 0n) throw new Error('Amount must be greater than 0')
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Qubic amount is too large for the signing library')
  return amount
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const qubicWalletService = {
  async deriveAddress(mnemonic: string) {
    const seed = await qubicSeedFromMnemonic(mnemonic)
    return (await helper.createIdPackage(seed)).publicId
  },

  async exportSeed(mnemonic: string) {
    return qubicSeedFromMnemonic(mnemonic)
  },

  async isValidAddress(address: string) {
    try {
      return await helper.verifyIdentity(address.trim().toUpperCase())
    } catch {
      return false
    }
  },

  async estimateFee() {
    return { satoshis: 0, coin: '0' }
  },

  async estimateMaxSend(coinId: string, address: string) {
    const balance = await coinApiService.getBalance(coinId, address)
    return { amountCoin: String(balance.balance_spendable ?? balance.balance), feeCoin: '0', feeSatoshis: 0 }
  },

  async send(params: {
    coinId: string
    mnemonic: string
    fromAddress: string
    toAddress: string
    amountCoin: string
    sendMax?: boolean
  }) {
    const seed = await qubicSeedFromMnemonic(params.mnemonic)
    const identity = (await helper.createIdPackage(seed)).publicId
    if (identity !== params.fromAddress.trim().toUpperCase()) throw new Error('Qubic address does not match this wallet')
    if (!(await this.isValidAddress(params.toAddress))) throw new Error('Invalid Qubic identity')

    const balance = await coinApiService.getBalance(params.coinId, identity)
    const amount = params.sendMax
      ? BigInt(String(balance.balance_spendable ?? balance.balance))
      : parseQuAmount(params.amountCoin)
    if (amount <= 0n) throw new Error('Insufficient Qubic balance')
    if (amount > BigInt(String(balance.balance_spendable ?? balance.balance))) throw new Error('Insufficient Qubic balance')
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Qubic amount is too large for the signing library')

    const context = await coinApiService.getAccountTxContext(params.coinId, identity, params.toAddress)
    const targetTick = Number(context.targetTick)
    if (!Number.isSafeInteger(targetTick) || targetTick <= 0) throw new Error('Qubic node did not return a valid target tick')
    const signed = await helper.createTransaction(seed, params.toAddress.trim().toUpperCase(), Number(amount), targetTick)
    const envelope = JSON.stringify({
      encodedTransaction: bytesToBase64(signed),
      from: identity,
      to: params.toAddress.trim().toUpperCase(),
      amount: amount.toString(),
      targetTick,
    })
    const txid = await coinApiService.broadcast(params.coinId, envelope)
    return { txid, amountCoin: amount.toString(), feeCoin: '0' }
  },
}
