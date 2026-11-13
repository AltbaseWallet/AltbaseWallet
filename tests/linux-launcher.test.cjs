'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const { finalizeLinuxPackage } = require('../scripts/finalize-linux-package.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase launcher '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const output = path.join(root, 'application with spaces')
  fs.mkdirSync(output); fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'build'))
  fs.copyFileSync(path.join(__dirname, '../scripts/linux-launcher.sh'), path.join(root, 'scripts/linux-launcher.sh'))
  fs.writeFileSync(path.join(root, 'build/LINUX-SANDBOX.txt'), 'fixture setup instructions')
  const elf = Buffer.alloc(96); elf.set([127, 69, 76, 70, 2, 1]); elf.writeUInt16LE(62, 18)
  fs.writeFileSync(path.join(output, 'altcoinwallet'), elf, { mode: 0o755 })
  fs.writeFileSync(path.join(output, 'chrome-sandbox'), elf, { mode: 0o755 })
  return { root, output, elf }
}

test('Linux finalization is repeatable and a newly built ELF replaces the old runtime', t => {
  const { root, output, elf } = fixture(t)
  finalizeLinuxPackage(root, output)
  assert.ok(fs.readFileSync(path.join(output, 'altcoinwallet-bin')).equals(elf))
  assert.match(fs.readFileSync(path.join(output, 'altcoinwallet'), 'utf8'), /^#!\/bin\/sh/)
  finalizeLinuxPackage(root, output)
  assert.ok(fs.readFileSync(path.join(output, 'altcoinwallet-bin')).equals(elf))
  const updated = Buffer.from(elf); updated[80] = 42
  fs.writeFileSync(path.join(output, 'altcoinwallet'), updated)
  finalizeLinuxPackage(root, output)
  assert.ok(fs.readFileSync(path.join(output, 'altcoinwallet-bin')).equals(updated))
  assert.equal(fs.statSync(path.join(output, 'chrome-sandbox.bundled')).mode & 0o7777, 0o755)
})

for (const mode of ['trusted-helper', 'untrusted-helper', 'node-mode']) {
  test(`Linux launcher ${mode} preserves literal arguments and never inserts no-sandbox`, t => {
    const { root, output } = fixture(t); finalizeLinuxPackage(root, output)
    const helper = path.join(root, 'custom helper'), capture = path.join(root, 'argv'), commands = path.join(root, 'commands')
    fs.mkdirSync(commands); fs.writeFileSync(helper, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    // Simulate filesystem ownership only; no privileged helper is executed.
    fs.writeFileSync(path.join(commands, 'stat'), '#!/bin/sh\nif [ "$4" = "$EXPECTED_HELPER" ] && [ "$HELPER_TRUSTED" = 1 ]; then printf "0:4755"; else printf "1000:755"; fi\n', { mode: 0o755 })
    fs.writeFileSync(path.join(output, 'altcoinwallet-bin'), '#!/bin/sh\nprintf "%s\\0" "$@" > "$CAPTURE_FILE"\n', { mode: 0o755 })
    const args = ['a b', 'literal $(false); *', '', 'line\nbreak']
    const result = spawnSync(path.join(output, 'altcoinwallet'), args, { env: { ...process.env,
      PATH: commands + path.delimiter + process.env.PATH, CHROME_DEVEL_SANDBOX: helper,
      EXPECTED_HELPER: helper, HELPER_TRUSTED: mode === 'trusted-helper' ? '1' : '0',
      ELECTRON_RUN_AS_NODE: mode === 'node-mode' ? '1' : '', CAPTURE_FILE: capture }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const received = fs.readFileSync(capture, 'utf8').split('\0').slice(0, -1)
    assert.deepEqual(received, mode === 'untrusted-helper' ? ['--disable-setuid-sandbox', ...args] : args)
    assert.equal(received.includes('--no-sandbox'), false)
    if (mode === 'trusted-helper') assert.equal(fs.readlinkSync(path.join(output, 'chrome-sandbox')), helper)
    else assert.equal(fs.existsSync(path.join(output, 'chrome-sandbox')), false)
  })
}

test('Linux finalization rejects a symlinked executable without changing its target', t => {
  const { root, output } = fixture(t), outside = path.join(root, 'outside')
  fs.writeFileSync(outside, 'unchanged'); fs.unlinkSync(path.join(output, 'altcoinwallet'))
  fs.symlinkSync(outside, path.join(output, 'altcoinwallet'))
  assert.throws(() => finalizeLinuxPackage(root, output), /regular executable/)
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged')
})
