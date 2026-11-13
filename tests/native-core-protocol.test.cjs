'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
function fixture() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), exitCode: null, signalCode: null })
  let kills = 0
  child.kill = () => { kills++; child.signalCode = 'SIGTERM'; return true }
  const exports = {}, context = { module: { exports }, exports, __dirname: path.resolve(__dirname, '../electron'), Buffer, process,
    setTimeout, clearTimeout, setInterval, clearInterval,
    require: name => name === 'node:child_process' ? { spawn: () => child }
      : name === 'node:fs' ? { ...fs, existsSync: () => true } : require(name) }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../electron/native-core-client.cjs'), 'utf8'), context)
  const client = new context.module.exports.NativeCoreClient({ isPackaged: false, getPath: () => '/isolated-fixture' })
  return { client, child, kills: () => kills }
}
function slot(client, id = '1') {
  const outcome = {}
  client.pending.set(id, { resolve: result => { outcome.result = result }, reject: error => { outcome.error = error }, method: 'health' })
  return outcome
}
test('native protocol rejects non-object frames and non-boolean response status without crashing the application', () => {
  for (const frame of ['null', '[]', '{"id":{"toString":null},"ok":true}', '{"id":"1","ok":"false","result":{"accepted":true}}']) {
    const f = fixture(); f.client.start(); const outcome = slot(f.client)
    assert.doesNotThrow(() => f.client.onData(frame + '\n'))
    assert.ok(outcome.error)
    assert.equal(outcome.result, undefined)
    assert.equal(f.kills(), 1)
  }
})
test('native error messages with unexpected types become generic errors', () => {
  const f = fixture(); f.client.start(); const outcome = slot(f.client)
  assert.doesNotThrow(() => f.client.onData('{"id":"1","ok":false,"error":{"message":{"toString":null}}}\n'))
  assert.equal(outcome.error.message, 'native core error'); f.client.stop()
})
test('native protocol bounds unterminated frames but accepts a batch of separately bounded responses', () => {
  const f = fixture(); f.client.start(); f.client.maxFrameBytes = 64; const outcome = slot(f.client)
  f.client.onData('x'.repeat(65)); assert.ok(outcome.error); assert.equal(f.client.buffer, ''); assert.equal(f.kills(), 1)
  const batch = fixture(); batch.client.start(); batch.client.maxFrameBytes = 64
  const first = slot(batch.client), second = slot(batch.client, '2')
  batch.client.onData('{"id":"1","ok":true,"result":{"value":1}}\n{"id":"2","ok":true,"result":{"value":2}}\n')
  assert.equal(first.result.value, 1); assert.equal(second.result.value, 2); assert.equal(batch.kills(), 0)
  batch.client.stop()
})
test('native bridge decodes split UTF-8 correctly and drains stdout before final process close', async () => {
  const f = fixture(), pending = f.client.request('health', {})
  const wire = Buffer.from('{"id":"1","ok":true,"result":{"name":"Привет"}}\n')
  const boundary = wire.indexOf(Buffer.from('П')) + 1
  f.child.emit('exit', 0, null)
  f.child.stdout.write(wire.subarray(0, boundary)); f.child.stdout.write(wire.subarray(boundary))
  f.child.emit('close', 0, null)
  assert.equal((await pending).name, 'Привет')
})
test('native process exit diagnostics never forward stderr content', () => {
  const f = fixture(); f.client.start(); f.child.stderr.write('PRIVATE_TEST_CANARY')
  assert.equal(f.client.exitMessage(1, null), 'native core exited (code 1)')
  f.client.stop()
})
