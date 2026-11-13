'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const tar = require('tar')
const { sha256, resourcePath, extractPackage } = require('../electron/plugins/package-format.cjs')
async function fixture(t, alter = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-package-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const payload = path.join(root, 'payload'), coin = path.join(payload, 'coin')
  fs.mkdirSync(coin, { recursive: true })
  fs.writeFileSync(path.join(payload, 'bundle.json'), JSON.stringify({ schemaVersion: 1, id: 'fixture-bundle', version: '1.0.0', modules: [{ id: 'fixture-coin', directory: 'coin' }] }))
  fs.writeFileSync(path.join(coin, 'manifest.json'), JSON.stringify({ schemaVersion: 1, abiVersion: 1, id: 'fixture-coin', name: 'Fixture', ticker: 'FIX', kind: 'account', networkId: 'fixture-chain', decimals: 18, version: '1.0.0', capabilities: ['derive', 'validate', 'snapshot', 'nodeRequest'], runtime: { type: 'javascript', entry: 'index.cjs' } }))
  fs.writeFileSync(path.join(coin, 'index.cjs'), 'exports.createPlugin = async () => ({request: async () => null})\n')
  await alter({ root, payload, coin })
  const archive = path.join(root, 'package.tar.gz')
  await tar.c({ file: archive, cwd: payload, gzip: true }, ['bundle.json', 'coin'])
  return { root, payload, archive, destination: path.join(root, 'installed'), expected: { id: 'fixture-bundle', version: '1.0.0', sha256: await sha256(archive), coins: ['fixture-coin'] } }
}
test('verified module bundle extracts with matching identity and exact coin set', async t => {
  const f = await fixture(t), result = await extractPackage(f.archive, f.destination, f.expected)
  assert.equal(result.modules[0].descriptor.id, 'fixture-coin')
  assert.equal(fs.existsSync(path.join(f.destination, 'coin/index.cjs')), true)
  await assert.rejects(extractPackage(f.archive, f.destination, f.expected), /already exists/)
})
test('tampered bytes and mismatched package identities never activate a destination', async t => {
  const f = await fixture(t)
  await assert.rejects(extractPackage(f.archive, f.destination, { ...f.expected, sha256: '0'.repeat(64) }), /integrity/)
  await assert.rejects(extractPackage(f.archive, f.destination, { ...f.expected, version: '2.0.0' }), /identity/)
  await assert.rejects(extractPackage(f.archive, f.destination, { ...f.expected, coins: ['another-coin'] }), /identities/)
  assert.equal(fs.existsSync(f.destination), false)
})
test('links inside an archive are rejected without touching their targets', async t => {
  const f = await fixture(t, ({ root, coin }) => {
    fs.writeFileSync(path.join(root, 'outside'), 'unchanged')
    fs.symlinkSync(path.join(root, 'outside'), path.join(coin, 'link'))
  })
  await assert.rejects(extractPackage(f.archive, f.destination, f.expected), /archive|entry/i)
  assert.equal(fs.readFileSync(path.join(f.root, 'outside'), 'utf8'), 'unchanged')
  assert.equal(fs.existsSync(f.destination), false)
})
test('compiled JavaScript packages reject absent platform binaries and validate their resource paths', async t => {
  for (const binaryPlatforms of [{ other: 'module.so' }, { [`${process.platform}-${process.arch}`]: '../../outside.so' }, { [`${process.platform}-${process.arch}`]: 'missing.so' }]) {
    const f = await fixture(t, ({ coin }) => {
      const file = path.join(coin, 'manifest.json'), definition = JSON.parse(fs.readFileSync(file))
      definition.runtime.binaryPlatforms = binaryPlatforms
      fs.writeFileSync(file, JSON.stringify(definition))
    })
    await assert.rejects(extractPackage(f.archive, f.destination, f.expected))
    assert.equal(fs.existsSync(f.destination), false)
  }
})
test('resource paths reject traversal, absolute, Windows aliases and hidden resources', () => {
  for (const p of ['../outside', '/outside', 'C:/outside', 'coin/../outside', 'coin\\outside', 'coin/NUL.dll', 'coin/.env', 'coin/trailing.', 'coin/secret/../../outside']) assert.throws(() => resourcePath(p))
  assert.equal(resourcePath('coin/bin/runtime-linux.so'), 'coin/bin/runtime-linux.so')
})
