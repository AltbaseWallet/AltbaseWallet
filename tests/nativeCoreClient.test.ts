import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { NativeCoreClient } = require('../electron/native-core-client.cjs') as {
  NativeCoreClient: new (app: unknown) => {
    timeoutFor(method: string, params?: Record<string, unknown>): number
    pending: Map<string, { method: string; params: Record<string, unknown> }>
    hasPendingEpicSend(): boolean
    waitForEpicSend(timeoutMs?: number): Promise<void>
  }
}

const client = new NativeCoreClient({})

test('coin node timeout includes a bounded process grace period', () => {
  assert.equal(client.timeoutFor('coinNodeRequest', { timeoutMs: 2_500 }), 7_500)
  assert.equal(client.timeoutFor('coinNodeRequest', { timeoutMs: 120_000 }), 65_000)
  assert.equal(client.timeoutFor('coinNodeRequest', { timeoutMs: -1 }), 15_000)
})

test('privacy wallet operations keep their longer synchronization window', () => {
  assert.equal(client.timeoutFor('privacyLightWallet', { action: 'send' }), 120_000)
  assert.equal(client.timeoutFor('privacyLightWallet', { coin: 'epic', action: 'send' }), 240_000)
  assert.equal(client.timeoutFor('privacyLightWallet', { action: 'sync' }), 600_000)
})

test('local native operations have bounded recovery time', () => {
  assert.equal(client.timeoutFor('validateAddress'), 30_000)
  assert.equal(client.timeoutFor('planTransaction'), 30_000)
  assert.equal(client.timeoutFor('signTransaction'), 60_000)
})

test('Epic close guard waits for the active native send', async () => {
  client.pending.set('epic-send', {
    method: 'privacyLightWallet',
    params: { coin: 'epic', action: 'send' },
  })
  assert.equal(client.hasPendingEpicSend(), true)
  setTimeout(() => client.pending.delete('epic-send'), 20)
  await client.waitForEpicSend(500)
  assert.equal(client.hasPendingEpicSend(), false)
})
