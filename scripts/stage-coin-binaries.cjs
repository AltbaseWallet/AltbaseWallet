'use strict'
// Stage executable module code for one OS. Coin engines remain byte-for-byte;
// the wallet vault and its bridge are built from this project's native source.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { requireBinary } = require('./runtime-platform.cjs')
const root = path.resolve(__dirname, '..')
function stageCoinBinaries(target = `${process.platform}-${process.arch}`) {
  const staged = path.join(root, 'native-core-stage', target)
  const core = fs.existsSync(staged) ? staged : path.join(root, 'native-core')
  const suffix = target.startsWith('win32') ? '.dll' : target.startsWith('darwin') ? '.dylib' : '.so'
  const exe = target.startsWith('win32') ? '.exe' : ''
  const bridge = 'altbase_core_bridge' + exe
  const vaultBridge = 'altbase_vault_bridge' + exe
  requireBinary(path.join(core, vaultBridge), target)
  requireBinary(path.join(core, bridge), target)
  const output = path.join(root, 'local-checks', 'coin-binaries', target)
  fs.rmSync(output, { recursive: true, force: true }); fs.mkdirSync(output, { recursive: true })
  const definitions = new Map(), receipts = []
  const copy = (source, destination) => {
    if (/wallet[ _-]?secret/i.test(source + destination)) throw Error('Protected source is not a module resource')
    if (fs.lstatSync(source).isSymbolicLink()) throw Error('Staged module resources must be regular files')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination); fs.chmodSync(destination, fs.statSync(source).mode & 0o777)
    receipts.push({ path: path.relative(output, destination), size: fs.statSync(destination).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') })
  }
  for (const item of fs.readdirSync(path.join(root, 'coin-plugins'), { withFileTypes: true })) {
    if (!item.isDirectory() || item.isSymbolicLink() || /wallet[ _-]?secret/i.test(item.name)) continue
    const source = path.join(root, 'coin-plugins', item.name), file = path.join(source, 'manifest.json')
    if (!fs.existsSync(file)) continue
    const definition = JSON.parse(fs.readFileSync(file))
    const directory = path.join(output, item.name); fs.mkdirSync(directory)
    for (const resource of fs.readdirSync(source, { withFileTypes: true })) {
      if (!resource.isFile()) throw Error('Unexpected coin package resource')
      // Only the selected OS binary is part of an application installation.
      if (/\.(so|dll|dylib)$/.test(resource.name) && !resource.name.endsWith(suffix)) continue
      copy(path.join(source, resource.name), path.join(directory, resource.name))
    }
    definition.nativeRuntime = { target, binaries: [] }
    if (definition.runtime.binaryPlatforms || definition.runtime.type === 'node-addon') {
      const binary = definition.runtime.binaryPlatforms?.[target] || definition.runtime.platforms?.[target]
      if (!binary) throw Error(`Missing account module binary for ${target}`)
      requireBinary(path.join(directory, binary), target)
      definition.nativeRuntime.binaries.push(binary)
    }
    definitions.set(item.name, definition)
  }
  const shared = path.join(output, '_core'); fs.mkdirSync(shared)
  const vaultReceiptFile = path.join(root, 'local-checks/vault-builds', target + '.json')
  const vaultReceipt = JSON.parse(fs.readFileSync(vaultReceiptFile, 'utf8'))
  if (vaultReceipt.target !== target || vaultReceipt.builtFromProjectSource !== true) throw Error('Rebuild the wallet vault from project source')
  for (const binary of vaultReceipt.binaries) {
    const file = path.join(core, binary.name)
    if (path.basename(binary.name) !== binary.name || fs.statSync(file).size !== binary.size
      || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== binary.sha256) throw Error('Wallet vault build receipt does not match its binary')
  }
  copy(vaultReceiptFile, path.join(shared, 'vault-build.json'))
  const libraryDirectories = []
  for (const filename of fs.readdirSync(core)) {
    if (!fs.statSync(path.join(core, filename)).isFile()) continue
    if (!filename.endsWith(suffix) && !/\.so\.\d+(?:\.\d+)*$/.test(filename) && filename !== bridge && filename !== vaultBridge) continue
    const id = filename.match(/^altbase_([a-z0-9]+)_(?:wallet|node)\./)?.[1]
      || filename.match(/^(?:lib)?altbase_(epic|zano)_(?:sender|state|transport|wallet|core)\./)?.[1]
    const owner = id && definitions.has(id) ? id : null
    requireBinary(path.join(core, filename), target)
    copy(path.join(core, filename), path.join(owner ? path.join(output, owner) : shared, filename))
    if (owner) {
      definitions.get(owner).nativeRuntime.binaries.push(filename)
      if (!libraryDirectories.includes(owner)) libraryDirectories.push(owner)
    }
  }
  for (const id of ['zcash', 'nexa', 'xelis', 'mwc']) {
    copy(path.join(root, 'electron/coin-sdks', id + '.cjs'), path.join(output, id, 'runtime.cjs'))
    definitions.get(id).nativeRuntime.sdkEntry = 'runtime.cjs'
  }
  for (const id of ['xelis', 'mwc']) {
    const source = path.join(root, 'coin-runtimes-stage', target, id)
    for (const file of fs.readdirSync(source)) {
      copy(path.join(source, file), path.join(output, id, file))
      if (file.endsWith('.exe') || ['xelis_wallet', 'mwc-wallet'].includes(file)) {
        requireBinary(path.join(source, file), target)
        definitions.get(id).nativeRuntime.binaries.push(file)
      }
    }
  }
  for (const [id, version] of [['kaspa', 'v2.0.1'], ['nonsense', 'v0.1.7']]) {
    const filename = id + '_bg.wasm'
    copy(path.join(root, 'vendor', id + '-wasm-' + version, filename), path.join(output, id, filename))
    definitions.get(id).nativeRuntime.wasm = filename
  }
  for (const [id, definition] of definitions) {
    if (!definition.nativeRuntime.binaries.length) throw Error(`No executable binary was staged for ${id}`)
    fs.writeFileSync(path.join(output, id, 'manifest.json'), JSON.stringify(definition, null, 2) + '\n')
  }
  fs.writeFileSync(path.join(shared, 'runtime-package.json'), JSON.stringify({ schemaVersion: 1, version: require('../package.json').version, target,
    bridge, libraryDirectories: libraryDirectories.sort(), adjacentLibraries: [{ module: 'monero', file: 'altbase_monero_wallet' + suffix }] }, null, 2) + '\n')
  const result = { target, directory: output, coinModules: definitions.size, receipts }
  fs.writeFileSync(path.join(root, 'local-checks', 'coin-binaries', target + '.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ target, directory: output, coinModules: definitions.size, binaryResources: receipts.length }))
  return result
}
if (require.main === module) stageCoinBinaries(process.argv[2])
module.exports = { stageCoinBinaries }
