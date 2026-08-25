import assert from 'node:assert/strict'
import test from 'node:test'
import { preserveVerifiedPrivacyStatus, reconcileVerifiedPrivacyRuntime } from '../src/utils/privacyStatusStability.ts'

test('verified active privacy wallets stay active during background catch-up', () => {
  assert.equal(preserveVerifiedPrivacyStatus('active', 'syncing', true, false), 'active')
  assert.equal(preserveVerifiedPrivacyStatus('active', 'preparing', true, false), 'active')
})

test('manual recovery can move a verified wallet back to syncing', () => {
  assert.equal(preserveVerifiedPrivacyStatus('active', 'syncing', true, true), 'syncing')
  assert.equal(preserveVerifiedPrivacyStatus('active', 'syncing', false, false), 'syncing')
})

test('real network failures remain visible after verification', () => {
  assert.equal(preserveVerifiedPrivacyStatus('active', 'maintenance', true, false), 'maintenance')
  assert.equal(preserveVerifiedPrivacyStatus('active', 'offline', true, false), 'offline')
})

test('a delayed syncing commit cannot hide a wallet that became ready meanwhile', () => {
  const current = {
    status: 'active' as const,
    balance: '1.25',
    spendableBalance: '1.2',
    recoveryProgress: undefined,
    priceUsd: 2,
    fiatValue: 2.5,
  }
  const stale = {
    status: 'syncing' as const,
    balance: '0',
    spendableBalance: '0',
    recoveryProgress: { blocksRemaining: 10 },
    priceUsd: 3,
    fiatValue: 0,
  }

  assert.deepEqual(reconcileVerifiedPrivacyRuntime(stale, current, true, false), {
    ...stale,
    status: 'active',
    balance: '1.25',
    spendableBalance: '1.2',
    recoveryProgress: undefined,
    fiatValue: 3.75,
  })
})
