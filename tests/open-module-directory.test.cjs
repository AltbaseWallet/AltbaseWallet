'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events')
const { openModuleDirectory } = require('../electron/open-module-directory.cjs')
test('Linux folder opening passes the literal common directory to xdg-open without a shell', async () => {
  const directory = '/tmp/fixture modules/$(literal); folder', child = new EventEmitter()
  await openModuleDirectory(directory, {}, { platform: 'linux', spawn: (file, args, options) => {
    assert.equal(file, 'xdg-open'); assert.deepEqual(args, [directory]); assert.equal(options.shell, false)
    process.nextTick(() => child.emit('exit', 0)); return child
  } })
})
test('missing file manager and rejected folder opening return bounded errors', async () => {
  for (const kind of ['error', 'exit']) await assert.rejects(openModuleDirectory('/tmp/fixture', {}, { platform: 'linux', spawn: () => {
    const child = new EventEmitter(); process.nextTick(() => child.emit(kind, kind === 'exit' ? 1 : Error('fixture'))); return child
  } }), /Could not/)
})
test('a stalled file-manager launch is terminated and rejects instead of dropping the IPC reply', async () => {
  let killed = false
  await assert.rejects(openModuleDirectory('/tmp/fixture', {}, { platform: 'linux', timeoutMs: 10, spawn: () => {
    const child = new EventEmitter(); child.kill = () => { killed = true }; return child
  } }), /timed out/)
  assert.equal(killed, true)
})
test('Windows uses the native folder opener and retains the directory unchanged', async () => {
  let opened
  await openModuleDirectory('C:\\fixture modules', { openPath: async directory => { opened = directory; return '' } }, { platform: 'win32' })
  assert.equal(opened, 'C:\\fixture modules')
  await assert.rejects(openModuleDirectory('C:\\fixture', { openPath: async () => 'fixture error' }, { platform: 'win32' }), /Could not open/)
})
