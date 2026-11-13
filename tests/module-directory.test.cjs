'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { prepareModuleDirectory } = require('../electron/plugins/module-directory.cjs')
const { PluginManager } = require('../electron/plugins/manager.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-one-modules-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'shipped'), directory = path.join(root, 'modules')
  fs.mkdirSync(source)
  fs.cpSync(path.join(__dirname, '../coin-plugins/bitcoin'), path.join(source, 'bitcoin'), { recursive: true })
  fs.cpSync(path.join(__dirname, '../examples/javascript-fixture'), path.join(source, 'javascript'), { recursive: true })
  return { root, source, directory }
}

test('defaults and a dropped native library load from the exact same openable directory', async t => {
  const { root, source, directory } = fixture(t), prepared = await prepareModuleDirectory(source, directory)
  const target = `${process.platform}-${process.arch}`, extension = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so'
  const manager = new PluginManager({ bundledRoot: directory, installedRoots: [], bundledFingerprints: prepared.fingerprints,
    dataRoot: path.join(root, 'data'), hostPath: path.join(__dirname, '../native-plugin-host/bin', target, 'altbase_plugin_host' + (process.platform === 'win32' ? '.exe' : '')) })
  t.after(() => manager.closeSessions())
  assert.equal((await manager.discover()).modules.length, 2)
  assert.equal(manager.catalog().directory, directory)
  assert.ok([...manager.modules.values()].every(record => record.source.startsWith(directory + path.sep)))
  fs.copyFileSync(path.join(__dirname, '../local-checks/fixtures', target, 'fixture-native' + extension), path.join(directory, 'user-added' + extension))
  assert.equal((await manager.discover()).modules.length, 3)
  assert.equal(manager.modules.get('fixture-native').bundled, false, 'An added module must retain manual ownership')
  assert.equal(manager.modules.get('fixture-javascript').bundled, true)
  assert.equal(await manager.request('fixture-native', 'validate', { address: 'ALTBASE_FIXTURE_ADDRESS' }), true)
})

test('stock updates preserve custom modifications, intentional removals and module data', async t => {
  const { root, source, directory } = fixture(t)
  await prepareModuleDirectory(source, directory)
  const data = path.join(root, 'scan.fixture'); fs.writeFileSync(data, 'retained public scan result')
  const metadata = path.join(source, 'javascript/manifest.json'), value = JSON.parse(fs.readFileSync(metadata))
  value.version = '1.1.0'; fs.writeFileSync(metadata, JSON.stringify(value))
  await prepareModuleDirectory(source, directory)
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'javascript/manifest.json'))).version, '1.1.0')
  fs.appendFileSync(path.join(directory, 'javascript/index.cjs'), '\n// user modification\n')
  fs.rmSync(path.join(directory, 'bitcoin'), { recursive: true })
  value.version = '1.2.0'; fs.writeFileSync(metadata, JSON.stringify(value))
  await prepareModuleDirectory(source, directory)
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'javascript/manifest.json'))).version, '1.1.0')
  assert.match(fs.readFileSync(path.join(directory, 'javascript/index.cjs'), 'utf8'), /user modification/)
  assert.equal(fs.existsSync(path.join(directory, 'bitcoin')), false)
  assert.equal(fs.readFileSync(data, 'utf8'), 'retained public scan result')
})

test('module initialization waits for another writer instead of exposing duplicate module roots', async t => {
  const { source, directory } = fixture(t); fs.mkdirSync(directory)
  const lock = path.join(directory, '.module-setup.lock'); fs.writeFileSync(lock, String(process.pid))
  const timer = setTimeout(() => fs.unlinkSync(lock), 100); t.after(() => clearTimeout(timer))
  await prepareModuleDirectory(source, directory)
  assert.equal(fs.existsSync(path.join(directory, 'bitcoin/manifest.json')), true)
  assert.equal(fs.existsSync(lock), false)
})

test('an unrecognized or symlinked stock marker cannot authorize overwriting custom code', async t => {
  const { root, source, directory } = fixture(t); fs.mkdirSync(directory)
  fs.cpSync(path.join(source, 'javascript'), path.join(directory, 'javascript'), { recursive: true })
  fs.appendFileSync(path.join(directory, 'javascript/index.cjs'), '\n// retained custom module\n')
  const canary = path.join(root, 'external-canary'); fs.writeFileSync(canary, 'unchanged')
  fs.symlinkSync(canary, path.join(directory, '.bundled-state.json'))
  await prepareModuleDirectory(source, directory)
  assert.equal(fs.readFileSync(canary, 'utf8'), 'unchanged')
  assert.match(fs.readFileSync(path.join(directory, 'javascript/index.cjs'), 'utf8'), /retained custom module/)
})
