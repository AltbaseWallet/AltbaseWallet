import { rolldown } from 'rolldown'
import { builtinModules, createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { NETWORKS } = require('../modules/account-common/networks.cjs')
const version = '0.1.6'
const includeDarwin = process.argv.includes('--macos')
const packageOnly = process.argv.includes('--package-only')
const { compileJavascriptModule } = require('./compile-javascript-module.cjs')
const external = new Set([...builtinModules, ...builtinModules.map(x => 'node:' + x)])
const staging = 'local-checks/account-module-build'
await fs.mkdir(staging, { recursive: true })
for (const [network, config] of packageOnly ? [] : Object.entries(NETWORKS)) {
  const directory = path.join('coin-plugins', network)
  await fs.mkdir(directory, { recursive: true })
  const input = path.join(staging, network + '.cjs')
  await fs.writeFile(input, `exports.createPlugin = options => require('../../modules/account-common/runtime.cjs').createAccountPlugin('${network}', options)\n`)
  const bundle = await rolldown({ input, platform: 'node', external: id => external.has(id) })
  const generated = await bundle.generate({ format: 'cjs', sourcemap: false })
  const source = generated.output.find(output => output.type === 'chunk').code
  await bundle.close()
  for (const [target, suffix] of [['linux-x64', '.so'], ['win32-x64', '.dll']]) {
    compileJavascriptModule(source, path.resolve(directory, 'altbase_' + network + suffix), target)
  }
  if (includeDarwin) {
  const darwinLibraries = []
  for (const target of ['darwin-x64', 'darwin-arm64']) {
    const file = path.resolve(staging, network + '-' + target + '.dylib')
    compileJavascriptModule(source, file, target)
    darwinLibraries.push(file)
  }
  const toolchain = require('./macos-toolchain.cjs').macosToolchain('darwin-arm64')
  const lipo = toolchain.lipo
  const merge = require('node:child_process').spawnSync(lipo, ['-create', ...darwinLibraries, '-output', path.resolve(directory, 'altbase_' + network + '.dylib')], { stdio: 'inherit', env: { ...process.env, ...toolchain.environment } })
  if (merge.error) throw merge.error
  if (merge.status !== 0) throw Error('Universal account module merge failed')
  } else await fs.rm(path.resolve(directory, 'altbase_' + network + '.dylib'), { force: true })
  // A small source bootstrap keeps these binary packages usable by released
  // wallet hosts that already support JavaScript plugins. All implementation
  // code lives in the library; this file only registers and invokes it.
  const load = require('../electron/plugins/binary-javascript.cjs').loadBinaryJavascript
  await fs.writeFile(path.join(directory, 'load.cjs'), "const path=require('node:path');const {createRequire}=require('node:module');\n" + load.toString() + "\nconst target=process.platform+'-'+process.arch;const entry=require('./manifest.json').runtime.binaryPlatforms[target];if(!entry)throw Error('Unsupported module platform');module.exports=loadBinaryJavascript(path.join(__dirname,entry));\n")
  await fs.rm(path.join(directory, 'index.cjs'), { force: true })
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, abiVersion: 1, id: network,
    name: config.name, ticker: config.ticker, version, kind: 'account', networkId: network + '-mainnet', decimals: config.decimals,
    capabilities: ['derive', 'validate', 'snapshot', 'nodeRequest', 'assets', 'importAsset', 'setAssetVisibility', 'prepareTransfer', 'send'],
    runtime: { type: 'javascript', entry: 'load.cjs', binaryPlatforms: { 'linux-x64': 'altbase_' + network + '.so', 'win32-x64': 'altbase_' + network + '.dll', ...(includeDarwin ? { 'darwin-x64': 'altbase_' + network + '.dylib', 'darwin-arm64': 'altbase_' + network + '.dylib' } : {}) } }, icon: 'icon.png' }, null, 2) + '\n')
  await fs.copyFile(path.join('modules/account-common/network-icons', network + '.png'), path.join(directory, 'icon.png'))
  await fs.rm(path.join(directory, 'icon.svg'), { force: true })
}
if (includeDarwin) {
  const { spawnSync } = require('node:child_process')
  const toolchain = require('./macos-toolchain.cjs').macosToolchain('darwin-arm64')
  for (const network of Object.keys(NETWORKS)) {
    const library = path.resolve('coin-plugins', network, 'altbase_' + network + '.dylib')
    for (const [command, args] of [[toolchain.codesign, ['sign', '--binary-identifier', 'io.altbase.module.' + network, library]], ['python3', ['scripts/verify-macos-signature.py', library]]]) {
      const result = spawnSync(command, args, { stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) throw Error('Darwin module ad-hoc signature validation failed')
    }
  }
}
// The EVM family is one downloadable package, while SOL and TRX remain separate.
const tar = require('tar'), crypto = require('node:crypto')
const output = 'artifacts/account-modules-' + version
await fs.mkdir(output, { recursive: true })
const catalog = []
for (const [id, coins] of Object.entries({ evm: ['ethereum', 'bsc', 'polygon', 'arbitrum'], sol: ['solana'], trx: ['tron'] })) {
  const root = path.join(staging, id + '-package')
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true })
  for (const coin of coins) await fs.cp(path.join('coin-plugins', coin), path.join(root, coin), { recursive: true })
  await fs.writeFile(path.join(root, 'bundle.json'), JSON.stringify({ schemaVersion: 1, id, version, modules: coins.map(coin => ({ id: coin, directory: coin })) }))
  const archive = path.join(output, id + '-' + version + '.tar.gz')
  await tar.c({ file: archive, cwd: root, gzip: true, portable: true }, ['bundle.json', ...coins])
  const bytes = await fs.readFile(archive)
  catalog.push({ id, version, coins, filename: path.basename(archive), size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
}
await fs.writeFile(path.join(output, 'packages.json'), JSON.stringify(catalog, null, 2) + '\n')
console.log('Built six complete account module programs as Linux/Windows/universal macOS libraries in three module packages.')
