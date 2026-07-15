import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCachedCoinRuntime, toCachedCoinRuntime } from '../src/services/coinRuntimeCache.ts'
import type { Coin } from '../src/types/coin.ts'

const baseCoin: Coin = {
  id: 'mydogecoin',
  name: 'Mydogecoin',
  ticker: 'MYDOGE',
  networkId: 'mydogecoin-mainnet',
  enabled: true,
  favorite: false,
  supportsMemo: false,
  satsPerCoin: 100_000_000,
  status: 'syncing',
  balance: '0',
  spendableBalance: '0',
  priceUsd: 0.0089,
  fiatValue: 0,
}

test('runtime balance fields survive cache serialization and restore', () => {
  const current = {
    ...baseCoin,
    status: 'active' as const,
    balance: '595.90811841',
    spendableBalance: '595.90811841',
    fiatValue: 5.36,
  }
  const restored = applyCachedCoinRuntime(baseCoin, toCachedCoinRuntime(current))

  assert.equal(restored.balance, current.balance)
  assert.equal(restored.spendableBalance, current.spendableBalance)
  assert.equal(restored.fiatValue, current.fiatValue)
  assert.equal(restored.status, 'active')
})
