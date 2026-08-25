'use strict'

// Rebuilds the source-owned XGR transport module and native dispatcher while
// preserving the already verified heavy Zano/Epic protocol libraries.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'native', 'core', 'src')
const version = require(path.join(root, 'package.json')).version.split('-')[0]
const buildRoot = process.env.ALTBASE_LINUX_NATIVE_BUILD_DIR
  ? path.resolve(process.env.ALTBASE_LINUX_NATIVE_BUILD_DIR)
  : path.join(root, 'native', 'core', 'build', 'linux-x64-release')
const buildBin = path.join(buildRoot, 'bin')
const work = path.join(os.homedir(), '.cache', 'altbase-build', 'linux-native-incremental')
const compiler = process.env.CXX || 'c++'

const walletCoins = [
  'bitcoin', 'bitcoin2', 'bitcoincashii', 'firo', 'btgs', 'capstash',
  'hypercoin', 'mydogecoin', 'pepecoin', 'kerrigan', 'scash', 'litecoinii',
  'neoxa', 'terracoin', 'junkcoin', 'raptoreum', 'pearl',
]
const nodeCoins = [
  ...walletCoins, 'zano', 'epic', 'quai', 'xgr', 'qubic', 'kaspa', 'ckb',
]

const run = (command, args, options = {}) => {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    input: options.input,
    encoding: options.capture || options.input ? 'utf8' : undefined,
    stdio: options.capture || options.input ? 'pipe' : 'inherit',
    maxBuffer: options.capture || options.input ? 64 * 1024 * 1024 : undefined,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}${result.stderr ? `\n${result.stderr}` : ''}`)
  }
  return options.capture || options.input ? result.stdout : ''
}

const requireFile = (filename) => {
  if (!fs.existsSync(filename)) throw new Error(`required Linux build input is missing: ${filename}`)
}

requireFile(path.join(buildBin, 'libaltbase_net_core.so'))
fs.mkdirSync(work, { recursive: true })

const common = [
  '-std=c++20',
  '-O2',
  '-DNDEBUG',
  '-DALTBASE_RELEASE_BINARY=1',
  '-fPIC',
  '-fvisibility=hidden',
  '-fvisibility-inlines-hidden',
  '-ffunction-sections',
  '-fdata-sections',
  `-I${source}`,
]
const compile = (input, output, definitions = []) => run(compiler, [
  ...common,
  ...definitions.map((definition) => `-D${definition}`),
  '-c', input,
  '-o', output,
])

const xgrObjects = [
  ['xgr-coin-node', path.join(source, 'coin_node_module.cpp')],
  ['xgr-native-http', path.join(source, 'native_http.cpp')],
  ['xgr-protocol', path.join(source, 'protocol.cpp')],
].map(([name, input]) => {
  const output = path.join(work, `${name}.o`)
  compile(input, output, [
    'ALTBASE_NODE_MODULE_COIN="xgr"',
    'ALTBASE_NODE_MODULE_REQUEST=altbase_xgr_node_request',
    'ALTBASE_NODE_MODULE_FREE=altbase_xgr_node_free',
  ])
  return output
})

const xgrOutput = path.join(work, 'altbase_xgr_node.so')
run(compiler, [
  '-shared',
  ...xgrObjects,
  path.join(buildBin, 'libaltbase_net_core.so'),
  '-Wl,--gc-sections',
  '-Wl,-z,relro,-z,now',
  '-Wl,-soname,altbase_xgr_node.so',
  '-Wl,-rpath,$ORIGIN',
  '-o', xgrOutput,
])

const xgrExportNames = run('nm', ['-D', '--defined-only', xgrOutput], { capture: true })
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/).pop())
  .filter((name) => name?.startsWith('altbase_xgr_node_'))
  .sort()
if (JSON.stringify(xgrExportNames) !== JSON.stringify(['altbase_xgr_node_free', 'altbase_xgr_node_request'])) {
  throw new Error(`XGR Linux module exports are wrong: ${xgrExportNames.join(', ')}`)
}
fs.copyFileSync(xgrOutput, path.join(buildBin, 'altbase_xgr_node.so'))
fs.chmodSync(path.join(buildBin, 'altbase_xgr_node.so'), 0o755)

const bridgeObjects = [
  ['bridge-main', path.join(source, 'main.cpp')],
  ['bridge-protocol', path.join(source, 'protocol.cpp')],
].map(([name, input]) => {
  const output = path.join(work, `${name}.o`)
  compile(input, output, [
    'ALTBASE_SEPARATE_PRIVACY_MODULES=1',
    `ALTBASE_CORE_VERSION="${version}"`,
  ])
  return output
})

const bridgeDependencyNames = [
  ...walletCoins.map((coin) => `altbase_${coin}_wallet.so`),
  ...nodeCoins.map((coin) => `altbase_${coin}_node.so`),
  'libaltbase_utxo_address.so',
  'libaltbase_utxo_derivation.so',
  'libaltbase_utxo_planner.so',
  'libaltbase_utxo_signer.so',
  'libaltbase_wallet_vault.so',
  'libaltbase_zano_wallet.so',
  'libaltbase_epic_wallet.so',
]
const dependencies = bridgeDependencyNames.map((name) => path.join(buildBin, name))
for (const library of dependencies) requireFile(library)

const bridgeOutput = path.join(work, 'altbase_core_bridge')
run(compiler, [
  ...bridgeObjects,
  '-Wl,--no-as-needed',
  ...dependencies,
  '-Wl,--as-needed',
  '-Wl,--gc-sections',
  '-Wl,-z,relro,-z,now',
  '-Wl,-rpath,$ORIGIN',
  '-ldl',
  '-pthread',
  '-o', bridgeOutput,
])
fs.copyFileSync(bridgeOutput, path.join(buildBin, 'altbase_core_bridge'))
fs.chmodSync(path.join(buildBin, 'altbase_core_bridge'), 0o755)

const linked = run('readelf', ['-d', bridgeOutput], { capture: true })
if (!linked.includes('altbase_xgr_node.so')) throw new Error('Linux native bridge is not linked to the XGR node module')
const smoke = run(path.join(buildBin, 'altbase_core_bridge'), ['--altbase-wallet-bridge'], {
  input: '{"id":"modules","method":"listWalletModules","params":{}}\n',
})
if (!smoke.includes('"account":"quai,xgr,qubic"') || !smoke.includes('zano,epic,quai,xgr,qubic')) {
  throw new Error(`Linux native bridge did not register XGR: ${smoke.trim()}`)
}
process.stdout.write('Linux native incremental rebuild passed.\n')
