import assert from 'node:assert/strict'
import { createECDH } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import initKaspa, {
  createSweepTransaction,
  createTransactions,
  deriveKaspaWallet,
  validateKaspaAddress,
} from '../vendor/kaspa-wasm-v2.0.1/kaspa.js'

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SECOND_TEST_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

let initialized: Promise<unknown> | null = null
const initialize = () => {
  initialized ??= readFile(new URL('../vendor/kaspa-wasm-v2.0.1/kaspa_bg.wasm', import.meta.url))
    .then((module) => initKaspa({ module_or_path: module }))
  return initialized
}

test('wallet-only Kaspa WASM derives and signs the public REST transaction shape', async () => {
  await initialize()
  const wallet = deriveKaspaWallet(TEST_MNEMONIC) as { address: string; privateKey: string }
  assert.equal(wallet.address, 'kaspa:qqd6e65yefepe9wk0m9vuxdufxd80sphy67gwwd0vdaumzdt4tc9s3qt0lqeh')
  assert.equal(validateKaspaAddress(wallet.address), true)
  assert.equal(wallet.privateKey.length, 64)

  const publicKey = createECDH('secp256k1')
  publicKey.setPrivateKey(Buffer.from(wallet.privateKey, 'hex'))
  const xOnlyPublicKey = publicKey.getPublicKey(undefined, 'compressed').subarray(1).toString('hex')
  const plan = createTransactions({
    networkId: 'mainnet',
    changeAddress: wallet.address,
    feeRate: 100,
    priorityFee: 0n,
    entries: [{
      outpoint: { transactionId: '11'.repeat(32), index: 0 },
      amount: 1_000_000_000n,
      scriptPublicKey: { version: 0, script: `20${xOnlyPublicKey}ac` },
      blockDaaScore: 1n,
      isCoinbase: false,
    }],
    outputs: [{ address: wallet.address, amount: 500_000_000n }],
  }) as { transactions: Array<{
    id: string
    feeAmount: bigint
    sign: (keys: string[]) => void
    serializeToSafeJSON: () => string
  }> }

  assert.equal(plan.transactions.length, 1)
  const pending = plan.transactions[0]
  pending.sign([wallet.privateKey])
  const transaction = JSON.parse(pending.serializeToSafeJSON()) as {
    version: number
    inputs: Array<{
      previousOutpoint: { transactionId: string; index: number }
      signatureScript: string
      sequence: number
      sigOpCount: number
    }>
    outputs: Array<{
      amount: number
      scriptPublicKey: { version: number; scriptPublicKey: string }
    }>
    lockTime: number
    subnetworkId: string
  }

  assert.equal(pending.id.length, 64)
  assert.ok(pending.feeAmount > 0n)
  assert.deepEqual(Object.keys(transaction).sort(), ['inputs', 'lockTime', 'outputs', 'subnetworkId', 'version'])
  assert.equal(transaction.inputs.length, 1)
  assert.equal(transaction.inputs[0].signatureScript.length, 132)
  assert.equal(transaction.inputs[0].sigOpCount, 1)
  assert.equal(transaction.outputs.length, 2)
  assert.equal(transaction.outputs[0].amount, 500_000_000)
  assert.equal(transaction.outputs[0].scriptPublicKey.version, 0)
  assert.match(transaction.outputs[0].scriptPublicKey.scriptPublicKey, /^[0-9a-f]+$/)
  assert.equal(transaction.subnetworkId, '00'.repeat(20))
})

test('wallet-only Kaspa WASM keeps the second test wallet derivation stable', async () => {
  await initialize()
  const wallet = deriveKaspaWallet(SECOND_TEST_MNEMONIC) as { address: string }
  assert.equal(wallet.address, 'kaspa:qzyppkvjrluc4cdfy4md8pssacw4yfz75usesqzzmcsym8ueyrm22qe2ete6x')
  assert.equal(validateKaspaAddress(wallet.address), true)
})

test('Kaspa storage-mass rejection identifies a too-small payment from one large UTXO', async () => {
  await initialize()
  const wallet = deriveKaspaWallet(TEST_MNEMONIC) as { address: string; privateKey: string }
  const recipient = deriveKaspaWallet(SECOND_TEST_MNEMONIC) as { address: string }
  const publicKey = createECDH('secp256k1')
  publicKey.setPrivateKey(Buffer.from(wallet.privateKey, 'hex'))
  const xOnlyPublicKey = publicKey.getPublicKey(undefined, 'compressed').subarray(1).toString('hex')
  const entries = [{
    outpoint: { transactionId: '22'.repeat(32), index: 0 },
    amount: 36_119_802_000n,
    scriptPublicKey: { version: 0, script: `20${xOnlyPublicKey}ac` },
    blockDaaScore: 1n,
    isCoinbase: false,
  }]

  assert.throws(() => createTransactions({
    networkId: 'mainnet',
    changeAddress: wallet.address,
    feeRate: 1,
    priorityFee: 0n,
    entries,
    outputs: [{ address: recipient.address, amount: 1_000_000n }],
  }), /amount is too small for the selected UTXO/)

  const validPlan = createTransactions({
    networkId: 'mainnet',
    changeAddress: wallet.address,
    feeRate: 1,
    priorityFee: 0n,
    entries,
    outputs: [{ address: recipient.address, amount: 10_000_000n }],
  }) as { transactions: Array<{ feeAmount: bigint }> }
  assert.equal(validPlan.transactions.length, 1)
  assert.equal(validPlan.transactions[0].feeAmount, 203_600n)
})

test('Kaspa planner adds another UTXO when it reduces storage mass', async () => {
  await initialize()
  const wallet = deriveKaspaWallet(TEST_MNEMONIC) as { address: string; privateKey: string }
  const recipient = deriveKaspaWallet(SECOND_TEST_MNEMONIC) as { address: string }
  const publicKey = createECDH('secp256k1')
  publicKey.setPrivateKey(Buffer.from(wallet.privateKey, 'hex'))
  const script = `20${publicKey.getPublicKey(undefined, 'compressed').subarray(1).toString('hex')}ac`
  const plan = createTransactions({
    networkId: 'mainnet',
    changeAddress: wallet.address,
    feeRate: 1,
    priorityFee: 0n,
    entries: [{
      outpoint: { transactionId: '33'.repeat(32), index: 0 },
      amount: 36_119_802_000n,
      scriptPublicKey: { version: 0, script },
      blockDaaScore: 1n,
      isCoinbase: false,
    }, {
      outpoint: { transactionId: '44'.repeat(32), index: 0 },
      amount: 1_000_000n,
      scriptPublicKey: { version: 0, script },
      blockDaaScore: 1n,
      isCoinbase: false,
    }],
    outputs: [{ address: recipient.address, amount: 1_000_000n }],
  }) as { transactions: Array<{
    sign: (keys: string[]) => void
    serializeToSafeJSON: () => string
  }> }

  assert.equal(plan.transactions.length, 1)
  plan.transactions[0].sign([wallet.privateKey])
  const transaction = JSON.parse(plan.transactions[0].serializeToSafeJSON()) as { inputs: unknown[] }
  assert.equal(transaction.inputs.length, 2)
})

test('Kaspa sweep sends the exact 59.175982 KAS balance minus its final fee', async () => {
  await initialize()
  const wallet = deriveKaspaWallet(TEST_MNEMONIC) as { address: string; privateKey: string }
  const recipient = deriveKaspaWallet(SECOND_TEST_MNEMONIC) as { address: string }
  const publicKey = createECDH('secp256k1')
  publicKey.setPrivateKey(Buffer.from(wallet.privateKey, 'hex'))
  const total = 5_917_598_200n
  const plan = createSweepTransaction({
    networkId: 'mainnet',
    address: recipient.address,
    feeRate: 1,
    priorityFee: 0n,
    entries: [{
      outpoint: { transactionId: '55'.repeat(32), index: 0 },
      amount: total,
      scriptPublicKey: {
        version: 0,
        script: `20${publicKey.getPublicKey(undefined, 'compressed').subarray(1).toString('hex')}ac`,
      },
      blockDaaScore: 1n,
      isCoinbase: false,
    }],
  }) as { transactions: Array<{
    feeAmount: bigint
    sign: (keys: string[]) => void
    serializeToSafeJSON: () => string
  }> }

  assert.equal(plan.transactions.length, 1)
  const pending = plan.transactions[0]
  pending.sign([wallet.privateKey])
  const transaction = JSON.parse(pending.serializeToSafeJSON()) as { outputs: Array<{ amount: number }> }
  assert.equal(transaction.outputs.length, 1)
  assert.equal(BigInt(transaction.outputs[0].amount) + pending.feeAmount, total)
  assert.ok(pending.feeAmount > 0n)
})

test('Kaspa 59 KAS payment from the real 59.175982 KAS UTXO includes its change mass in the fee', async () => {
  await initialize()
  const wallet = deriveKaspaWallet(TEST_MNEMONIC) as { address: string; privateKey: string }
  const recipient = deriveKaspaWallet(SECOND_TEST_MNEMONIC) as { address: string }
  const publicKey = createECDH('secp256k1')
  publicKey.setPrivateKey(Buffer.from(wallet.privateKey, 'hex'))
  const total = 5_917_598_200n
  const plan = createTransactions({
    networkId: 'mainnet',
    changeAddress: wallet.address,
    feeRate: 100,
    priorityFee: 0n,
    entries: [{
      outpoint: { transactionId: '66'.repeat(32), index: 0 },
      amount: total,
      scriptPublicKey: {
        version: 0,
        script: `20${publicKey.getPublicKey(undefined, 'compressed').subarray(1).toString('hex')}ac`,
      },
      blockDaaScore: 1n,
      isCoinbase: false,
    }],
    outputs: [{ address: recipient.address, amount: 5_900_000_000n }],
  }) as { transactions: Array<{
    feeAmount: bigint
    sign: (keys: string[]) => void
    serializeToSafeJSON: () => string
  }> }

  const pending = plan.transactions[0]
  pending.sign([wallet.privateKey])
  const transaction = JSON.parse(pending.serializeToSafeJSON()) as { outputs: Array<{ amount: number }> }
  const outputTotal = transaction.outputs.reduce((sum, output) => sum + BigInt(output.amount), 0n)
  assert.equal(transaction.outputs.length, 2)
  assert.equal(outputTotal + pending.feeAmount, total)
  assert.ok(pending.feeAmount > 203_600n)
})
