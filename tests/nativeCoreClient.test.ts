import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { NativeCoreClient } = require('../electron/native-core-client.cjs') as {
  NativeCoreClient: new (app: unknown) => {
    timeoutFor(method: string, params?: Record<string, unknown>): number
    refreshTimeoutOnProgress(method: string, params?: Record<string, unknown>): boolean
    stderrBuffer: string
    exitMessage(code: number | null, signal: string | null): string
    pending: Map<string, { method: string; params: Record<string, unknown> }>
    child: unknown
    children: Set<unknown>
    hasPendingEpicSend(): boolean
    waitForEpicSend(timeoutMs?: number): Promise<void>
    terminateChild(child: unknown, forceAfterMs?: number): void
    stop(): void
    request(method: string, params?: Record<string, unknown>): Promise<unknown>
    requestNow(method: string, params?: Record<string, unknown>): Promise<unknown>
  }
}

const client = new NativeCoreClient({})

test('coin node timeout includes a bounded process grace period', () => {
  assert.equal(client.timeoutFor('coinNodeRequest', { timeoutMs: 2_500 }), 30_000)
  assert.equal(client.timeoutFor('coinNodeRequest', { timeoutMs: 120_000 }), 90_000)
  assert.equal(client.timeoutFor('coinNodeRequest', { timeoutMs: -1 }), 30_000)
})

test('coin node requests start one at a time instead of expiring in the native queue', async () => {
  const queuedClient = new NativeCoreClient({})
  const order: string[] = []
  let active = 0
  let maxActive = 0
  queuedClient.requestNow = async (_method, params = {}) => {
    const id = String(params.id)
    active += 1
    maxActive = Math.max(maxActive, active)
    order.push(`start:${id}`)
    await new Promise((resolve) => setTimeout(resolve, 15))
    order.push(`end:${id}`)
    active -= 1
    return id
  }
  const results = await Promise.all([
    queuedClient.request('coinNodeRequest', { id: 1 }),
    queuedClient.request('coinNodeRequest', { id: 2 }),
    queuedClient.request('coinNodeRequest', { id: 3 }),
  ])
  assert.deepEqual(results, ['1', '2', '3'])
  assert.equal(maxActive, 1)
  assert.deepEqual(order, ['start:1', 'end:1', 'start:2', 'end:2', 'start:3', 'end:3'])
})

test('privacy wallet operations keep their longer synchronization window', () => {
  assert.equal(client.timeoutFor('privacyLightWallet', { action: 'send' }), 120_000)
  assert.equal(client.timeoutFor('privacyLightWallet', { coin: 'epic', action: 'send' }), 240_000)
  assert.equal(client.timeoutFor('privacyLightWallet', { coin: 'epic', action: 'snapshot' }), 3_600_000)
  assert.equal(client.timeoutFor('privacyLightWallet', { coin: 'monero', action: 'snapshot' }), 3_600_000)
  assert.equal(client.refreshTimeoutOnProgress('privacyLightWallet', { coin: 'monero', action: 'snapshot' }), true)
  assert.equal(client.refreshTimeoutOnProgress('privacyLightWallet', { coin: 'monero', action: 'send' }), false)
  assert.equal(client.refreshTimeoutOnProgress('coinNodeRequest'), false)
})

test('local native operations have bounded recovery time', () => {
  assert.equal(client.timeoutFor('validateAddress'), 30_000)
  assert.equal(client.timeoutFor('planTransaction'), 30_000)
  assert.equal(client.timeoutFor('signTransaction'), 60_000)
})

test('native core exit reports the Windows loader status and bounded stderr', () => {
  client.stderrBuffer = 'failed to load altbase_wallet_vault.dll\r\n'
  assert.equal(
    client.exitMessage(-1073741515, null),
    'native core exited (code -1073741515): failed to load altbase_wallet_vault.dll',
  )
})

test('native core session reset force-stops a helper blocked in native code', async () => {
  const signals: string[] = []
  const child = {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill(signal = 'SIGTERM') {
      signals.push(signal)
      if (signal === 'SIGKILL') this.signalCode = signal
      return true
    },
  }
  client.terminateChild(child, 5)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('native core session reset stops current and previously detached helpers', () => {
  const orphanClient = new NativeCoreClient({})
  const stopped: number[] = []
  const fakeChild = (id: number) => Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill() {
      stopped.push(id)
      this.signalCode = 'SIGTERM'
      this.emit('exit', null, 'SIGTERM')
      return true
    },
  })
  const detached = fakeChild(1)
  const current = fakeChild(2)
  orphanClient.children.add(detached)
  orphanClient.children.add(current)
  orphanClient.child = current
  orphanClient.stop()
  assert.deepEqual(stopped.sort(), [1, 2])
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
