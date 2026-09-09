import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const jiti = createRequire(import.meta.url)('jiti').createJiti(import.meta.url)
const { privacyCacheService } = jiti('../src/services/privacyCacheService.ts')
const debug = jiti('../src/utils/quaiDebugLog.ts')
const { nativeCoreService } = jiti('../src/services/nativeCoreService.ts')

for (const coin of ['monero', 'epic', 'zano']) {
  test(`${coin}: session reset cancels queued work and in-flight preparation before calling native code`, async (t) => {
    t.mock.method(debug, 'coinDebugLog', () => undefined)
    t.mock.method(debug, 'coinDebugLogError', () => undefined)
    const service = jiti(`../src/services/privacy/${coin}PrivacyWalletService.ts`)[`${coin}PrivacyWalletService`]
    let releaseCache: (value: null) => void = () => undefined
    let enteredCache: () => void = () => undefined
    const entered = new Promise<void>((resolve) => { enteredCache = resolve })
    t.mock.method(privacyCacheService, 'load', () => {
      enteredCache()
      return new Promise<null>((resolve) => { releaseCache = resolve })
    })
    const native = t.mock.method(nativeCoreService, 'privacyLightWallet', async () => ({ ok: true }))
    const args = coin === 'zano' ? ['zano', 'test-only-unused-seed'] : ['test-only-unused-seed']
    const first = service.ensureWallet(...args)
    await entered
    const second = service.ensureWallet(...args)
    const results = Promise.allSettled([first, second])
    service.resetNativeReadiness()
    releaseCache(null)
    for (const result of await results) {
      assert.equal(result.status, 'rejected')
      if (result.status === 'rejected') assert.match(result.reason.message, /session changed/)
    }
    assert.equal(native.mock.callCount(), 0)
  })
}

test('Epic warm-up and visible refresh share one scan and deliver its progress to the UI', async (t) => {
  const { epicPrivacyWalletService: service } = jiti('../src/services/privacy/epicPrivacyWalletService.ts')
  service.resetNativeReadiness()
  t.after(() => service.resetNativeReadiness())
  t.mock.method(debug, 'coinDebugLog', () => undefined)
  t.mock.method(debug, 'coinDebugLogError', () => undefined)
  t.mock.method(privacyCacheService, 'load', async () => ({ restoreStartHeight: 100 }))
  t.mock.method(privacyCacheService, 'saveFromSnapshot', async () => undefined)
  let complete: (response: unknown) => void = () => undefined
  let report: (progress: unknown) => void = () => undefined
  let start: () => void = () => undefined
  const entered = new Promise<void>((resolve) => { start = resolve })
  const native = t.mock.method(nativeCoreService, 'privacyLightWallet', async (_params: unknown, onProgress: (progress: unknown) => void) => {
    report = onProgress
    start()
    return new Promise((resolve) => { complete = resolve })
  })
  const first = service.warmWallet('unused-public-test-fixture')
  await entered
  const second = service.warmWallet('unused-public-test-fixture')
  const progress: unknown[] = []
  const visible = service.getSnapshot('unused-public-test-fixture', (value: unknown) => progress.push(value))
  const update = { coin: 'epic', fromHeight: 100, currentHeight: 120, tipHeight: 140, totalBlocks: 40, scannedBlocks: 20, blocksRemaining: 20, percent: 50 }
  report(update)
  complete({ ok: true, code: 'epic-native-wallet', balance: '0', spendable: '0', transactions: [] })
  await Promise.all([first, second, visible])
  assert.equal(native.mock.callCount(), 1)
  assert.deepEqual(progress, [update])
})
