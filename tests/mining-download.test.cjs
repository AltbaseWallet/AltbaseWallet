'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { MiningModuleManager, hostPlatform } = require('../electron/mining-module-manager.cjs')
const fixture = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-mining-download-'))
  const manager = Object.create(MiningModuleManager.prototype), original = globalThis.fetch
  t.after(() => { globalThis.fetch = original; fs.rmSync(directory, { recursive: true, force: true }) })
  return { manager, destination: path.join(directory, 'artifact.zip') }
}
const artifact = { url: 'https://publisher.example/fixture.zip', size: 4 }
test('a miner download stalled before headers aborts once and releases the operation', async t => {
  const { manager, destination } = fixture(t); let calls = 0
  globalThis.fetch = async (_url, options) => {
    calls++
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  }
  await assert.rejects(manager.downloadMinerArtifact(artifact, destination, { idleTimeoutMs: 15, timeoutMs: 100 }), /stalled/)
  assert.equal(calls, 1); assert.equal(fs.existsSync(destination), false)
})
test('a truncated publisher download is never activated and a valid response can complete afterwards', async t => {
  const { manager, destination } = fixture(t)
  globalThis.fetch = async () => new Response('abc', { headers: { 'content-length': '4' } })
  await assert.rejects(manager.downloadMinerArtifact(artifact, destination), /declared size/)
  assert.equal(fs.existsSync(destination), false)
  globalThis.fetch = async () => new Response('abcd', { headers: { 'content-length': '4' } })
  const downloaded = await manager.downloadMinerArtifact(artifact, destination)
  assert.equal(downloaded.size, 4); assert.equal(fs.readFileSync(destination, 'utf8'), 'abcd')
})
test('a stalled miner response body aborts; completed progress resets the idle deadline', async t => {
  const { manager, destination } = fixture(t)
  globalThis.fetch = async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
  } }))
  await assert.rejects(manager.downloadMinerArtifact(artifact, destination, { idleTimeoutMs: 15, timeoutMs: 200 }), /stalled/)
  let progress = 0
  globalThis.fetch = async () => new Response(new ReadableStream({ async start(controller) {
    for (let i = 0; i < 4; i++) { await new Promise(resolve => setTimeout(resolve, 5)); controller.enqueue(Buffer.from('a')) }
    controller.close()
  } }), { headers: { 'content-length': '4' } })
  await manager.downloadMinerArtifact(artifact, destination, { idleTimeoutMs: 25, timeoutMs: 200, onProgress: () => { progress++ } })
  assert.ok(progress >= 4)
})
test('mining module updates reserve the slot before discovery and release it on discovery failure', async () => {
  const manager = Object.create(MiningModuleManager.prototype); manager.moduleDownload = null
  let reject, calls = 0
  manager.checkModuleUpdates = () => { calls++; return new Promise((_resolve, no) => { reject = no }) }
  const first = manager.installModuleUpdate('0.1.99'), rejected = assert.rejects(first, /fixture unavailable/)
  const done = manager.moduleDownload.done
  await assert.rejects(manager.installModuleUpdate('0.1.99'), /already downloading/)
  assert.equal(calls, 1); reject(Error('fixture unavailable')); await rejected; await done
  assert.equal(manager.moduleDownload, null)
})
test('miner installs reserve before runtime initialization and release on startup failure', async () => {
  const manager = Object.create(MiningModuleManager.prototype); manager.downloads = new Map()
  let reject, calls = 0
  manager.runtime = () => { calls++; return new Promise((_resolve, no) => { reject = no }) }
  const miner = { id: 'fixture' }, release = { artifacts: [{ platform: hostPlatform() }] }
  const first = manager.installResolvedMiner(miner, release), rejected = assert.rejects(first, /fixture unavailable/)
  const done = manager.downloads.get(miner.id).done
  await assert.rejects(manager.installResolvedMiner(miner, release), /already downloading/)
  assert.equal(calls, 1); reject(Error('fixture unavailable')); await rejected; await done
  assert.equal(manager.downloads.size, 0)
})
