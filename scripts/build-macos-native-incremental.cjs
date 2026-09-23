'use strict'

// Rebuilds the source-owned XGR/Nonsense transport dylibs and dispatcher for both macOS
// architectures with the cached cross toolchains. Existing protocol modules
// are linked as dylibs and are not modified.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'native', 'core', 'src')
const version = require(path.join(root, 'package.json')).version.split('-')[0]
const cacheRoot = process.env.ALTBASE_MONERO_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'altbase', 'monero')
const workRoot = path.join(os.homedir(), '.cache', 'altbase-build', 'macos-native-incremental')

const configurations = [
  {
    arch: 'x64',
    cacheTarget: 'macos-x64',
    host: 'x86_64-apple-darwin11',
    clangTarget: 'x86_64-apple-darwin11',
  },
  {
    arch: 'arm64',
    cacheTarget: 'macos-arm64',
    host: 'aarch64-apple-darwin11',
    clangTarget: 'arm64-apple-darwin20',
  },
]

const walletCoins = [
  'bitcoincash', 'digibyte', 'peercoin',
  'bitcoin', 'bitcoin2', 'bitcoincashii', 'firo', 'btgs', 'capstash',
  'hypercoin', 'mydogecoin', 'pepecoin', 'kerrigan', 'scash', 'litecoinii',
  'neoxa', 'terracoin', 'junkcoin', 'raptoreum', 'pearl',
]
const nodeCoins = [
  ...walletCoins, 'nexa', 'zcash', 'zano', 'epic', 'quai', 'xgr', 'qubic', 'kaspa', 'nonsense', 'ckb',
]

const run = (command, args, options = {}) => {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: options.capture ? 64 * 1024 * 1024 : undefined,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}${result.stderr ? `\n${result.stderr}` : ''}`)
  }
  return options.capture ? result.stdout : ''
}

const requireFile = (filename) => {
  if (!fs.existsSync(filename)) throw new Error(`required macOS build input is missing: ${filename}`)
}

const buildArchitecture = (config) => {
  const depends = path.join(
    cacheRoot,
    'source-build',
    config.cacheTarget,
    'source',
    'contrib',
    'depends',
    config.host,
    'native',
  )
  const bin = path.join(depends, 'bin')
  const compiler = path.join(bin, 'clang++')
  const otool = path.join(bin, `${config.host}-otool`)
  const sdk = path.join(depends, 'SDK')
  const buildBin = path.join(process.env.ALTBASE_MACOS_NATIVE_BUILD_ROOT || path.join(root, 'native', 'core', 'build'), `macos-${config.arch}-release`, 'bin')
  const work = path.join(workRoot, config.arch)
  for (const filename of [compiler, otool, sdk, path.join(buildBin, 'libaltbase_net_core.dylib')]) requireFile(filename)
  fs.mkdirSync(work, { recursive: true })

  const common = [
    `--target=${config.clangTarget}`,
    '-std=c++20',
    '-O2',
    '-DNDEBUG',
    '-DALTBASE_RELEASE_BINARY=1',
    '-fPIC',
    '-fvisibility=hidden',
    '-fvisibility-inlines-hidden',
    '-ffunction-sections',
    '-fdata-sections',
    '-stdlib=libc++',
    '-isysroot', sdk,
    '-mmacosx-version-min=12.0',
    `-B${path.join(bin, `${config.host}-`)}`,
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

  const xgrOutput = path.join(work, 'altbase_xgr_node.dylib')
  run(compiler, [
    ...common,
    '-dynamiclib',
    ...xgrObjects,
    path.join(buildBin, 'libaltbase_net_core.dylib'),
    '-Wl,-dead_strip',
    '-Wl,-install_name,@rpath/altbase_xgr_node.dylib',
    '-Wl,-rpath,@loader_path',
    '-Wl,-exported_symbol,_altbase_xgr_node_free',
    '-Wl,-exported_symbol,_altbase_xgr_node_request',
    '-o', xgrOutput,
  ])
  fs.copyFileSync(xgrOutput, path.join(buildBin, 'altbase_xgr_node.dylib'))

  const nonsenseObjects = [
    ['nonsense-coin-node', path.join(source, 'coin_node_module.cpp')],
    ['nonsense-native-http', path.join(source, 'native_http.cpp')],
    ['nonsense-protocol', path.join(source, 'protocol.cpp')],
  ].map(([name, input]) => {
    const output = path.join(work, `${name}.o`)
    compile(input, output, [
      'ALTBASE_NODE_MODULE_COIN="nonsense"',
      'ALTBASE_NODE_MODULE_REQUEST=altbase_nonsense_node_request',
      'ALTBASE_NODE_MODULE_FREE=altbase_nonsense_node_free',
    ])
    return output
  })
  const nonsenseOutput = path.join(work, 'altbase_nonsense_node.dylib')
  run(compiler, [
    ...common,
    '-dynamiclib',
    ...nonsenseObjects,
    path.join(buildBin, 'libaltbase_net_core.dylib'),
    '-Wl,-dead_strip',
    '-Wl,-install_name,@rpath/altbase_nonsense_node.dylib',
    '-Wl,-rpath,@loader_path',
    '-Wl,-exported_symbol,_altbase_nonsense_node_free',
    '-Wl,-exported_symbol,_altbase_nonsense_node_request',
    '-o', nonsenseOutput,
  ])
  fs.copyFileSync(nonsenseOutput, path.join(buildBin, 'altbase_nonsense_node.dylib'))

  for (const coin of ['bitcoincash','digibyte','peercoin','nexa','zcash']) {
    const object=path.join(work,`${coin}-node.o`)
    compile(path.join(source,'coin_node_module.cpp'),object,[`ALTBASE_NODE_MODULE_COIN="${coin}"`,`ALTBASE_NODE_MODULE_REQUEST=altbase_${coin}_node_request`,`ALTBASE_NODE_MODULE_FREE=altbase_${coin}_node_free`])
    run(compiler,[...common,'-dynamiclib',object,...xgrObjects.slice(1),path.join(buildBin,'libaltbase_net_core.dylib'),'-Wl,-dead_strip',`-Wl,-install_name,@rpath/altbase_${coin}_node.dylib`,'-Wl,-rpath,@loader_path',`-Wl,-exported_symbol,_altbase_${coin}_node_free`,`-Wl,-exported_symbol,_altbase_${coin}_node_request`,'-o',path.join(buildBin,`altbase_${coin}_node.dylib`)])
  }
  for (const coin of ['bitcoincash','digibyte','peercoin']) {
    const object=path.join(work,`${coin}-wallet.o`)
    compile(path.join(source,'utxo_wallet_module.cpp'),object,[`ALTBASE_UTXO_MODULE_COIN="${coin}"`,`ALTBASE_UTXO_MODULE_REQUEST=altbase_${coin}_wallet_request`,`ALTBASE_UTXO_MODULE_FREE=altbase_${coin}_wallet_free`])
    run(compiler,[...common,'-dynamiclib',object,xgrObjects[2],...['address','derivation','planner','signer'].map(service=>path.join(buildBin,`libaltbase_utxo_${service}.dylib`)),'-Wl,-dead_strip',`-Wl,-install_name,@rpath/altbase_${coin}_wallet.dylib`,'-Wl,-rpath,@loader_path',`-Wl,-exported_symbol,_altbase_${coin}_wallet_free`,`-Wl,-exported_symbol,_altbase_${coin}_wallet_request`,'-o',path.join(buildBin,`altbase_${coin}_wallet.dylib`)])
  }

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
    ...walletCoins.map((coin) => `altbase_${coin}_wallet.dylib`),
    ...nodeCoins.map((coin) => `altbase_${coin}_node.dylib`),
    'libaltbase_utxo_address.dylib',
    'libaltbase_utxo_derivation.dylib',
    'libaltbase_utxo_planner.dylib',
    'libaltbase_utxo_signer.dylib',
    'libaltbase_wallet_vault.dylib',
    'libaltbase_zano_wallet.dylib',
    'libaltbase_epic_wallet.dylib',
  ]
  const dependencies = bridgeDependencyNames.map((name) => path.join(buildBin, name))
  for (const dylib of dependencies) requireFile(dylib)

  const bridgeOutput = path.join(work, 'altbase_core_bridge')
  run(compiler, [
    ...common,
    ...bridgeObjects,
    ...dependencies,
    '-Wl,-dead_strip',
    '-Wl,-rpath,@executable_path',
    '-o', bridgeOutput,
  ])
  const imports = run(otool, ['-L', bridgeOutput], { capture: true })
  if (!imports.includes('altbase_xgr_node.dylib')) {
    throw new Error(`${config.arch} macOS bridge is not linked to the XGR node module`)
  }
  if (!imports.includes('altbase_nonsense_node.dylib')) {
    throw new Error(`${config.arch} macOS bridge is not linked to the Nonsense node module`)
  }
  fs.copyFileSync(bridgeOutput, path.join(buildBin, 'altbase_core_bridge'))
  fs.chmodSync(path.join(buildBin, 'altbase_core_bridge'), 0o755)
  fs.chmodSync(path.join(buildBin, 'altbase_xgr_node.dylib'), 0o755)
  fs.chmodSync(path.join(buildBin, 'altbase_nonsense_node.dylib'), 0o755)
  process.stdout.write(`macOS ${config.arch} XGR/Nonsense nodes and native bridge passed.\n`)
}

for (const config of configurations) buildArchitecture(config)
