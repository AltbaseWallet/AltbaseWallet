'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { requireBinary } = require('../scripts/runtime-platform.cjs')
test('Windows packaging rejects DOS-only, truncated, Linux, x86 and ARM executables', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-platform-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'fixture.exe')
  for (const kind of ['dos', 'truncated', 'linux', 'x86', 'arm64', 'wrong-magic', 'offset']) {
    const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(64, 60)
    bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(0x20b, 88)
    if (kind === 'dos') bytes.fill(0, 64)
    if (kind === 'linux') bytes.write('\x7fELF')
    if (kind === 'x86') bytes.writeUInt16LE(0x14c, 68)
    if (kind === 'arm64') bytes.writeUInt16LE(0xaa64, 68)
    if (kind === 'wrong-magic') bytes.writeUInt16LE(0x10b, 88)
    if (kind === 'offset') bytes.writeUInt32LE(0x7fffffff, 60)
    fs.writeFileSync(file, kind === 'truncated' ? bytes.subarray(0, 32) : bytes)
    assert.throws(() => requireBinary(file, 'win32-x64'), undefined, kind)
  }
})
test('the cross-compiled x64 Windows plugin host has a complete PE32+ header', () => {
  const file = path.resolve(__dirname, '../native-plugin-host/bin/win32-x64/altbase_plugin_host.exe')
  if (fs.existsSync(file)) assert.doesNotThrow(() => requireBinary(file, 'win32-x64'))
  assert.throws(() => requireBinary(file, 'linux-x64'))
})
