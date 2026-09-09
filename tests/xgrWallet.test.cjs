'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { Transaction, parseEther } = require('ethers')
const { createJiti } = require('jiti')

const jiti = createJiti(__filename)
const { coinApiService } = jiti('../src/services/coinApiService.ts')
const {
  XGR_CHAIN_ID,
  XGR_DERIVATION_PATH,
  xgrWalletService,
} = jiti('../src/services/xgrWalletService.ts')

const TEST_MNEMONIC = 'test test test test test test test test test test test junk'
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const feeContext = {
  from: TEST_ADDRESS,
  to: RECIPIENT,
  nonce: 7,
  coin: 'xgr',
  fee: '0.042021',
  feeSatoshis: 4_202_100,
  gasLimit: '21000',
  gasPrice: '2001000000000',
  gasPriceHex: '0x1d1e4e4ea00',
  maxFeePerGas: '2001000000000',
  maxPriorityFeePerGas: '1000000000',
  transactionType: 'eip1559',
  chainId: XGR_CHAIN_ID,
  source: 'xgr-rpc',
}

test('XGR derives the standard EVM account from the wallet mnemonic', () => {
  assert.equal(XGR_DERIVATION_PATH, "m/44'/60'/0'/0/0")
  assert.equal(xgrWalletService.deriveAddress(TEST_MNEMONIC), TEST_ADDRESS)
  assert.equal(xgrWalletService.isValidAddress(TEST_ADDRESS), true)
  assert.equal(xgrWalletService.isValidAddress('not-an-xgr-address'), false)
  assert.match(xgrWalletService.getPrivateKey(TEST_MNEMONIC), /^0x[0-9a-f]{64}$/i)
})

test('XGR fee rendering does not request a nonce-bearing transaction context', async () => {
  const originalFee = coinApiService.getAccountFeeEstimate
  const originalContext = coinApiService.getAccountTxContext
  try {
    coinApiService.getAccountFeeEstimate = async () => feeContext
    coinApiService.getAccountTxContext = async () => {
      throw new Error('transaction context must not be used for fee rendering')
    }
    const result = await xgrWalletService.estimateFee('xgr', {
      force: true,
      fromAddress: TEST_ADDRESS,
      toAddress: RECIPIENT,
      amountCoin: '3',
    })
    assert.deepEqual(result, { satoshis: 4_202_100, coin: '0.042021' })
  } finally {
    coinApiService.getAccountFeeEstimate = originalFee
    coinApiService.getAccountTxContext = originalContext
  }
})

test('XGR max send reserves the complete EIP-1559 maximum fee', async () => {
  const originalBalance = coinApiService.getBalance
  const originalFee = coinApiService.getAccountFeeEstimate
  const originalContext = coinApiService.getAccountTxContext
  try {
    coinApiService.getBalance = async () => ({
      balance: '100000000',
      balance_spendable: '100000000',
      received: '100000000',
      immature: '0',
    })
    coinApiService.getAccountFeeEstimate = async () => feeContext
    coinApiService.getAccountTxContext = async () => {
      throw new Error('transaction context must not be used for MAX')
    }
    const result = await xgrWalletService.estimateMaxSend('xgr', TEST_ADDRESS, undefined, RECIPIENT)
    assert.deepEqual(result, {
      amountCoin: '0.957979',
      feeCoin: '0.042021',
      feeSatoshis: 4_202_100,
    })
  } finally {
    coinApiService.getBalance = originalBalance
    coinApiService.getAccountFeeEstimate = originalFee
    coinApiService.getAccountTxContext = originalContext
  }
})

test('XGR max send uses the live wallet balance without another balance request', async () => {
  const originalBalance = coinApiService.getBalance
  const originalFee = coinApiService.getAccountFeeEstimate
  try {
    coinApiService.getBalance = async () => {
      throw new Error('MAX must reuse the balance already displayed by the wallet')
    }
    coinApiService.getAccountFeeEstimate = async () => feeContext
    const result = await xgrWalletService.estimateMaxSend(
      'xgr',
      TEST_ADDRESS,
      undefined,
      RECIPIENT,
      '35694.57200598',
    )
    assert.deepEqual(result, {
      amountCoin: '35694.52998498',
      feeCoin: '0.042021',
      feeSatoshis: 4_202_100,
    })
  } finally {
    coinApiService.getBalance = originalBalance
    coinApiService.getAccountFeeEstimate = originalFee
  }
})

test('XGR signs an EIP-1559 native transfer for chain 1643 before broadcast', async () => {
  const originalBalance = coinApiService.getBalance
  const originalContext = coinApiService.getAccountTxContext
  const originalBroadcast = coinApiService.broadcast
  let capturedRaw = ''
  let capturedExpectedTxid = ''
  try {
    coinApiService.getBalance = async () => ({
      balance: '100000000',
      balance_spendable: '100000000',
      received: '100000000',
      immature: '0',
    })
    coinApiService.getAccountTxContext = async () => feeContext
    coinApiService.broadcast = async (coinId, raw, expectedTxid) => {
      assert.equal(coinId, 'xgr')
      capturedRaw = raw
      capturedExpectedTxid = expectedTxid || ''
      return capturedExpectedTxid
    }
    const result = await xgrWalletService.send({
      coinId: 'xgr',
      mnemonic: TEST_MNEMONIC,
      fromAddress: TEST_ADDRESS,
      toAddress: RECIPIENT,
      amountCoin: '0.1',
    })
    const parsed = Transaction.from(capturedRaw)
    assert.equal(parsed.type, 2)
    assert.equal(parsed.chainId, BigInt(XGR_CHAIN_ID))
    assert.equal(parsed.from, TEST_ADDRESS)
    assert.equal(parsed.to, RECIPIENT)
    assert.equal(parsed.nonce, 7)
    assert.equal(parsed.gasLimit, 21_000n)
    assert.equal(parsed.maxFeePerGas, 2_001_000_000_000n)
    assert.equal(parsed.maxPriorityFeePerGas, 1_000_000_000n)
    assert.equal(parsed.value, parseEther('0.1'))
    assert.equal(result.txid, capturedExpectedTxid)
    assert.equal(result.amountCoin, '0.1')
    assert.equal(result.feeCoin, '0.042021')
  } finally {
    coinApiService.getBalance = originalBalance
    coinApiService.getAccountTxContext = originalContext
    coinApiService.broadcast = originalBroadcast
  }
})

test('XGR preserves the confirmed fee cap with manual gas rounding and rejects an increased network price', async (t) => {
  t.mock.method(coinApiService, 'getAccountTxContext', async () => feeContext)
  const broadcast = t.mock.method(coinApiService, 'broadcast', async (_coin, raw) => {
    const tx = Transaction.from(raw)
    assert.ok(tx.gasLimit * tx.maxFeePerGas <= parseEther('0.05'))
    return tx.hash
  })
  const params = { coinId: 'xgr', mnemonic: TEST_MNEMONIC, fromAddress: TEST_ADDRESS,
    toAddress: RECIPIENT, amountCoin: '0.1', feeCoin: '0.05', maxFeeCoin: '0.05', knownSpendableCoin: '1' }
  await xgrWalletService.send(params)
  assert.equal(broadcast.mock.callCount(), 1)
  t.mock.method(coinApiService, 'getAccountTxContext', async () => ({ ...feeContext, maxFeePerGas: '4002000000000' }))
  await assert.rejects(xgrWalletService.send(params), /fee increased/)
  assert.equal(broadcast.mock.callCount(), 1)
})
