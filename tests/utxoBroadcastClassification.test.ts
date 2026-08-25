import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../src/services/coinTxService.ts', import.meta.url), 'utf8')
const transactionStoreSource = fs.readFileSync(new URL('../src/store/transactionStore.ts', import.meta.url), 'utf8')

test('a full mempool is a definite rejection of this broadcast attempt', () => {
  assert.match(source, /isDeterministicBroadcastRejection[\s\S]*?mempool full/)
})

test('a transport timeout remains uncertain until network monitoring resolves it', () => {
  assert.doesNotMatch(source, /isDeterministicBroadcastRejection[\s\S]*?Timeout was reached/)
})

test('a signed UTXO broadcast is not declared failed from one missing history snapshot', () => {
  const evidence = transactionStoreSource.match(/const hasLocalBroadcastEvidence[\s\S]*?\n\n/)?.[0] ?? ''
  const classifier = transactionStoreSource.match(/const isDroppedLocalPending[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(evidence, /spentOutpoints\?\.length/)
  assert.match(evidence, /balanceBefore/)
  assert.match(classifier, /hasLocalBroadcastEvidence\(tx\)[\s\S]*?return false/)
})

test('stored auto-failed UTXO broadcasts are repaired to pending on the next launch', () => {
  const normalizer = transactionStoreSource.match(/const normalizeStoredTransaction[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(normalizer, /status === 'failed'[\s\S]*?hasLocalBroadcastEvidence\(tx\)[\s\S]*?status: 'pending'/)
})
