'use strict'
// Package only explicitly staged architectures. Never publish from this script.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
// The source build generates a hash manifest; verify it before packaging.
const miningIntegrity = spawnSync(process.execPath, ['scripts/verify-bundled-mining.cjs'], { cwd: root, stdio: 'inherit' })
if (miningIntegrity.error) throw miningIntegrity.error
if (miningIntegrity.status !== 0) throw Error('Rebuild the mining module and its hash manifest before packaging')
const target = process.argv[2] || `${process.platform}-${process.arch}`
const targets = { 'linux-x64': ['linux', 'x64'], 'win32-x64': ['win', 'x64'], 'darwin-arm64': ['mac', 'arm64'], 'darwin-x64': ['mac', 'x64'] }
if (!targets[target]) throw Error('Use linux-x64, win32-x64, darwin-arm64 or darwin-x64')
const [platform, arch] = targets[target]
const executable = target.startsWith('win32') ? '.exe' : ''
const requireBinary = file => require('./runtime-platform.cjs').requireBinary(file, target)
const stagedCore = path.join(root, 'native-core-stage', target)
const core = fs.existsSync(stagedCore) ? stagedCore : path.join(root, 'native-core')
require('./build-vault.cjs').buildVault(target)
const moduleStage = require('./stage-coin-binaries.cjs').stageCoinBinaries(target).directory
const host = `native-plugin-host/bin/${target}/altbase_plugin_host${executable}`
requireBinary(path.join(root, host))
requireBinary(path.join(core, `altbase_core_bridge${executable}`))
for (const name of fs.readdirSync(core)) {
  if (/\.(dll|exe|so|dylib)$/.test(name)) requireBinary(path.join(core, name))
}
if (platform === 'win') requireBinary(path.join(root, 'node_modules/secp256k1/prebuilds/win32-x64/secp256k1.node'))
const runtimes = JSON.parse(fs.readFileSync(path.join(root, 'coin-runtimes-stage/manifest.json'), 'utf8'))
for (const coin of ['xelis', 'mwc']) {
  const entry = runtimes.find(row => row.coin === coin && row.platform === target)
  if (!entry || !entry.path.startsWith(target + '/') || entry.path.includes('..')) throw Error(`Missing staged ${target} runtime manifest for ${coin}`)
  const file = path.join(root, 'coin-runtimes-stage', entry.path)
  requireBinary(file)
  if (fs.statSync(file).size !== entry.size || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256) throw Error(`Runtime checksum mismatch for ${coin}`)
}
if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw Error('Run npm run build first')
const config = {
  ...require('../package.json').build,
  ...(process.env.ALTBASE_PACKAGE_OUTPUT ? { directories: { ...require('../package.json').build.directories, output: path.resolve(process.env.ALTBASE_PACKAGE_OUTPUT) } } : {}),
  // A Linux build/Release addon takes precedence over prebuilds in node-gyp-build.
  // Never ship it into a cross-compiled Windows application.
  files: [...require('../package.json').build.files, '!electron/coin-sdks/**/*', ...(platform === 'win' ? ['!node_modules/secp256k1/build/**/*', '!node_modules/secp256k1/prebuilds/linux-*/**/*', '!node_modules/secp256k1/prebuilds/darwin-*/**/*'] : [])],
  extraResources: require('../package.json').build.extraResources.filter(resource => !['native-core', 'coin-runtimes-stage'].includes(resource.from)).map(resource => resource.from === 'coin-plugins'
    ? { ...resource, from: moduleStage }
    : resource.from === 'native-plugin-host/bin' ? { ...resource, filter: [`${target}/**/*`] } : resource),
}
if (process.env.ALTBASE_ELECTRON_DIST) {
  const distribution = path.resolve(process.env.ALTBASE_ELECTRON_DIST)
  requireBinary(path.join(distribution, `electron${executable}`))
  const version = fs.readFileSync(path.join(distribution, 'version'), 'utf8').trim()
  if (version !== require('../node_modules/electron/package.json').version) throw Error('Staged Electron version differs from the locked dependency')
  config.electronDist = distribution
} else if (target === `${process.platform}-${process.arch}`) config.electronDist = path.join(root, 'node_modules/electron/dist')
const configFile = path.join(root, `local-checks/package-config-${target}.json`)
fs.mkdirSync(path.dirname(configFile), { recursive: true }); fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
if (process.argv.includes('--check')) { console.log(`Packaging preflight passed: ${target}`); process.exit(0) }
const args = ['node_modules/electron-builder/cli.js', `--${platform}`, 'dir', `--${arch}`, '--publish', 'never', '--config', configFile]
const command = process.platform === 'linux' ? 'taskset' : process.execPath
const argv = process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, process.execPath, ...args] : args
const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', env: { ...process.env,
  MAKEFLAGS: '-j1', CMAKE_BUILD_PARALLEL_LEVEL: '1', RAYON_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' } })
if (result.error) throw result.error
if (result.status === 0 && platform === 'linux') {
  console.log(JSON.stringify(require('./finalize-linux-package.cjs').finalizeLinuxPackage(root, process.env.ALTBASE_PACKAGE_OUTPUT ? path.join(path.resolve(process.env.ALTBASE_PACKAGE_OUTPUT), 'linux-unpacked') : undefined)))
}
if (result.status === 0 && platform === 'win') {
  console.log(JSON.stringify(require('./finalize-windows-executable.cjs').finalizeWindowsExecutable(root, process.env.ALTBASE_PACKAGE_OUTPUT ? path.join(path.resolve(process.env.ALTBASE_PACKAGE_OUTPUT), 'win-unpacked') : undefined)))
  if (process.argv.includes('--msi')) {
    const appDirectory = path.join(path.resolve(process.env.ALTBASE_PACKAGE_OUTPUT || path.join(root, 'artifacts')), 'win-unpacked')
    const installer = spawnSync(command, process.platform === 'linux'
      ? ['-c', require('./build-limits.cjs').cpu, process.execPath, 'scripts/package-windows-msi.cjs']
      : ['scripts/package-windows-msi.cjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, ALTBASE_WINDOWS_APP_DIRECTORY: appDirectory } })
    if (installer.error) throw installer.error
    process.exit(installer.status ?? 1)
  }
}
process.exit(result.status ?? 1)
