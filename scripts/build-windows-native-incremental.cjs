'use strict'

// Rebuilds the source-owned XGR transport DLL, the Epic wallet dispatcher and
// the official modular bridge on Linux with clang-cl. Existing unrelated coin
// DLLs keep the exact upstream ABI; Monero remains on its own compact ABI.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'native', 'core', 'src')
const packageVersion = require(path.join(root, 'package.json')).version.split('-')[0]
const buildBin = path.join(root, 'native', 'core', 'build', 'vs2022-x64-release', 'bin')
const releaseBin = path.join(buildBin, 'Release')
const work = path.join(os.homedir(), '.cache', 'altbase-build', 'windows-native-incremental')
const sdkRoot = process.env.ALTBASE_XWIN_SDK
  || path.join(os.homedir(), '.cache', 'altbase-build', 'xwin-sdk')
const crtRoot = path.join(sdkRoot, 'crt')
const windowsSdk = path.join(sdkRoot, 'sdk')

const tools = {
  compiler: process.env.ALTBASE_CLANG_CL || 'clang-cl-19',
  linker: process.env.ALTBASE_LLD_LINK || 'lld-link-19',
  resource: process.env.ALTBASE_LLVM_RC || 'llvm-rc-19',
  dlltool: process.env.ALTBASE_LLVM_DLLTOOL || 'llvm-dlltool-19',
  objdump: process.env.ALTBASE_OBJDUMP || 'x86_64-w64-mingw32-objdump',
}

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
    env: { ...process.env, ...options.env },
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
    maxBuffer: options.capture ? 64 * 1024 * 1024 : undefined,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}${result.stderr ? `\n${result.stderr}` : ''}`)
  }
  return options.capture ? result.stdout : ''
}

const requireFile = (filename) => {
  if (!fs.existsSync(filename)) throw new Error(`required Windows build input is missing: ${filename}`)
}

for (const filename of [
  path.join(crtRoot, 'include', 'vector'),
  path.join(crtRoot, 'lib', 'x86_64', 'libcmt.lib'),
  path.join(windowsSdk, 'include', 'um', 'Windows.h'),
  path.join(windowsSdk, 'lib', 'um', 'x86_64', 'kernel32.Lib'),
  path.join(windowsSdk, 'lib', 'ucrt', 'x86_64', 'libucrt.lib'),
  path.join(releaseBin, 'altbase_net_core.dll'),
]) requireFile(filename)

fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(releaseBin, { recursive: true })

const includeArgs = [
  `/imsvc${path.join(crtRoot, 'include')}`,
  `/imsvc${path.join(windowsSdk, 'include', 'ucrt')}`,
  `/imsvc${path.join(windowsSdk, 'include', 'shared')}`,
  `/imsvc${path.join(windowsSdk, 'include', 'um')}`,
  `/I${source}`,
]
const compileArgs = [
  '--target=x86_64-pc-windows-msvc',
  '/nologo',
  '/std:c++20',
  '/O2',
  '/MT',
  '/EHsc',
  '/GR-',
  '/DNDEBUG',
  '/DWIN32',
  '/D_WINDOWS',
  '/DWIN64',
  '/D_WIN64',
  '/D_CRT_SECURE_NO_WARNINGS',
  '/guard:cf',
  '/Brepro',
  '/Gy',
  '/Gw',
  '/Zc:inline',
  '/Zc:__cplusplus',
  '/permissive-',
  '/clang:-flto=thin',
  ...includeArgs,
]
// clang-cl/lld-link cross builds that combine /guard:cf with the xwin static
// CRT currently produce a dispatcher that Windows rejects during CRT startup
// with FAST_FAIL_GUARD_ICALL_CHECK_FAILURE (10), before main(). Keep the other
// PE mitigations and CFG on DLLs, but omit CFG for this tiny dispatcher until
// the cross-toolchain can emit a Windows-valid startup GFIDS table.
const bridgeCompileArgs = compileArgs.filter((argument) => argument !== '/guard:cf')
const libraryPaths = [
  `/libpath:${path.join(crtRoot, 'lib', 'x86_64')}`,
  `/libpath:${path.join(windowsSdk, 'lib', 'ucrt', 'x86_64')}`,
  `/libpath:${path.join(windowsSdk, 'lib', 'um', 'x86_64')}`,
]
const hardenedLinkArgs = [
  '/release',
  '/dynamicbase',
  '/nxcompat',
  '/highentropyva',
  '/guard:cf',
  '/cetcompat',
  '/Brepro',
  '/opt:ref',
  '/opt:icf',
  '/opt:lldlto=2',
  '/machine:x64',
]

const exportsFor = (dll) => {
  const report = run(tools.objdump, ['-p', dll], { capture: true })
  const table = report.split('[Ordinal/Name Pointer] Table')[1]?.split('The Function Table')[0] || ''
  return [...table.matchAll(/^\s*\[\s*\d+\].*\s([^\s]+)\s*$/gm)]
    .map((match) => match[1])
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_@?$]*$/.test(name))
}

const importLibraryFor = (dll) => {
  const basename = path.basename(dll)
  const stem = basename.replace(/\.dll$/i, '')
  const names = exportsFor(dll)
  if (names.length === 0) throw new Error(`Windows DLL exposes no importable functions: ${basename}`)
  const definition = path.join(work, `${stem}.def`)
  const library = path.join(work, `${stem}.lib`)
  fs.writeFileSync(definition, `LIBRARY ${basename}\nEXPORTS\n${names.map((name) => `  ${name}`).join('\n')}\n`)
  run(tools.dlltool, ['-m', 'i386:x86-64', '-d', definition, '-l', library])
  return library
}

const compile = (input, output, definitions = [], args = compileArgs) => {
  run(tools.compiler, [
    ...args,
    ...definitions.map((definition) => `/D${definition}`),
    '/c',
    input,
    `/Fo${output}`,
  ])
}

const renderVersionResource = (filename, internalName, description) => {
  const [major, minor, patch] = packageVersion.split('.')
  let resource = fs.readFileSync(path.join(source, 'native_module_version.rc.in'), 'utf8')
  const replacements = {
    '@PROJECT_VERSION_MAJOR@': major,
    '@PROJECT_VERSION_MINOR@': minor,
    '@PROJECT_VERSION_PATCH@': patch,
    '@PROJECT_VERSION@': packageVersion,
    '@MODULE_FILENAME@': filename,
    '@MODULE_INTERNAL_NAME@': internalName,
    '@MODULE_DESCRIPTION@': description,
  }
  for (const [needle, value] of Object.entries(replacements)) resource = resource.split(needle).join(value)
  const rc = path.join(work, `${internalName}.rc`)
  const res = path.join(work, `${internalName}.res`)
  fs.writeFileSync(rc, resource)
  run(tools.resource, [
    `/I${path.join(windowsSdk, 'include', 'shared')}`,
    `/I${path.join(windowsSdk, 'include', 'um')}`,
    `/I${path.join(windowsSdk, 'include', 'ucrt')}`,
    `/Fo${res}`,
    rc,
  ])
  return res
}

const xgrObjects = [
  ['xgr-coin-node', path.join(source, 'coin_node_module.cpp')],
  ['xgr-native-http', path.join(source, 'native_http.cpp')],
  ['xgr-protocol', path.join(source, 'protocol.cpp')],
].map(([name, input]) => {
  const output = path.join(work, `${name}.obj`)
  compile(input, output, [
    'ALTBASE_NODE_MODULE_COIN="xgr"',
    'ALTBASE_NODE_MODULE_REQUEST=altbase_xgr_node_request',
    'ALTBASE_NODE_MODULE_FREE=altbase_xgr_node_free',
    'ALTBASE_RELEASE_BINARY=1',
  ])
  return output
})

const netImport = importLibraryFor(path.join(releaseBin, 'altbase_net_core.dll'))
const xgrResource = renderVersionResource('altbase_xgr_node.dll', 'XGRNode', 'Altbase XGR Node Module')
const xgrDll = path.join(work, 'altbase_xgr_node.dll')
run(tools.linker, [
  '/dll',
  `/out:${xgrDll}`,
  ...xgrObjects,
  xgrResource,
  netImport,
  ...libraryPaths,
  ...hardenedLinkArgs,
  '/subsystem:windows,6.01',
  'kernel32.lib',
])

const xgrExports = exportsFor(xgrDll).sort()
const expectedXgrExports = ['altbase_xgr_node_free', 'altbase_xgr_node_request']
if (JSON.stringify(xgrExports) !== JSON.stringify(expectedXgrExports)) {
  throw new Error(`XGR DLL exports are wrong: ${xgrExports.join(', ')}`)
}
for (const destination of [path.join(releaseBin, 'altbase_xgr_node.dll'), path.join(buildBin, 'altbase_xgr_node.dll')]) {
  fs.copyFileSync(xgrDll, destination)
  process.stdout.write(`staged XGR node module: ${destination}\n`)
}

// The Epic Rust state/sender DLLs are rebuilt independently, but MAX routing
// enters through this small C++ wallet DLL first. Rebuild it here as well so a
// source change cannot be silently paired with a stale dispatcher on Windows.
const epicStateDll = path.join(releaseBin, 'altbase_epic_state.dll')
const epicSenderDll = path.join(releaseBin, 'altbase_epic_sender.dll')
requireFile(epicStateDll)
requireFile(epicSenderDll)
const epicStateImport = importLibraryFor(epicStateDll)
const epicSenderImport = importLibraryFor(epicSenderDll)
const epicObjects = [
  ['epic-coin-wallet-module', path.join(source, 'coin_wallet_module.cpp')],
  ['epic-wallet-secret', path.join(source, 'wallet_secret.cpp')],
  ['epic-protocol', path.join(source, 'protocol.cpp')],
  ['epic-light-wallet', path.join(source, 'epic_light_wallet_impl.cpp')],
  ['epic-wallet-state-archive', path.join(source, 'epic_wallet_state_archive.cpp')],
].map(([name, input]) => {
  const output = path.join(work, `${name}.obj`)
  compile(input, output, [
    'ALTBASE_EPIC_WALLET_EXPORTS',
    'ALTBASE_EPIC_WALLET_ONLY=1',
    'ALTBASE_RELEASE_BINARY=1',
    'MOBILE_WALLET_BUILD=1',
    'NOMINMAX',
  ])
  return output
})
const epicResource = renderVersionResource(
  'altbase_epic_wallet.dll',
  'AltbaseEpicWallet',
  'Altbase Epic Wallet Module',
)
const epicWalletDll = path.join(work, 'altbase_epic_wallet.dll')
run(tools.linker, [
  '/dll',
  `/out:${epicWalletDll}`,
  ...epicObjects,
  epicResource,
  epicStateImport,
  epicSenderImport,
  ...libraryPaths,
  ...hardenedLinkArgs,
  '/subsystem:windows,6.01',
  'bcrypt.lib',
  'kernel32.lib',
  'shell32.lib',
])
const epicWalletExports = exportsFor(epicWalletDll).sort()
const expectedEpicWalletExports = ['altbase_epic_wallet_free', 'altbase_epic_wallet_request']
if (JSON.stringify(epicWalletExports) !== JSON.stringify(expectedEpicWalletExports)) {
  throw new Error(`Epic wallet DLL exports are wrong: ${epicWalletExports.join(', ')}`)
}
for (const destination of [path.join(releaseBin, 'altbase_epic_wallet.dll'), path.join(buildBin, 'altbase_epic_wallet.dll')]) {
  fs.copyFileSync(epicWalletDll, destination)
  process.stdout.write(`staged Epic wallet module: ${destination}\n`)
}

const bridgeObjects = [
  ['bridge-main', path.join(source, 'main.cpp')],
  ['bridge-protocol', path.join(source, 'protocol.cpp')],
].map(([name, input]) => {
  const output = path.join(work, `${name}.obj`)
  compile(input, output, [
    'ALTBASE_SEPARATE_PRIVACY_MODULES=1',
    `ALTBASE_CORE_VERSION="${packageVersion}"`,
    'ALTBASE_RELEASE_BINARY=1',
  ], bridgeCompileArgs)
  return output
})

const bridgeResource = path.join(work, 'altbase_core_bridge.res')
run(tools.resource, [
  `/I${source}`,
  `/I${path.join(windowsSdk, 'include', 'shared')}`,
  `/I${path.join(windowsSdk, 'include', 'um')}`,
  `/I${path.join(windowsSdk, 'include', 'ucrt')}`,
  `/Fo${bridgeResource}`,
  path.join(source, 'bridge_version.rc'),
])

const bridgeDependencyNames = [
  ...walletCoins.map((coin) => `altbase_${coin}_wallet.dll`),
  ...nodeCoins.map((coin) => `altbase_${coin}_node.dll`),
  'altbase_utxo_address.dll',
  'altbase_utxo_derivation.dll',
  'altbase_utxo_planner.dll',
  'altbase_utxo_signer.dll',
  'altbase_wallet_vault.dll',
  'altbase_zano_wallet.dll',
  'altbase_epic_wallet.dll',
]
const bridgeImportLibraries = bridgeDependencyNames.map((name) => {
  const dll = path.join(releaseBin, name)
  requireFile(dll)
  return importLibraryFor(dll)
})

const bridge = path.join(work, 'altbase_core_bridge.exe')
run(tools.linker, [
  `/out:${bridge}`,
  ...bridgeObjects,
  bridgeResource,
  ...bridgeImportLibraries,
  ...libraryPaths,
  ...hardenedLinkArgs.filter((argument) => argument !== '/guard:cf'),
  '/manifest:no',
  '/subsystem:console,6.01',
  'kernel32.lib',
  'user32.lib',
])

for (const destination of [path.join(releaseBin, 'altbase_core_bridge.exe'), path.join(buildBin, 'altbase_core_bridge.exe')]) {
  fs.copyFileSync(bridge, destination)
  process.stdout.write(`staged native core bridge: ${destination}\n`)
}

const bridgeImports = [...run(tools.objdump, ['-p', bridge], { capture: true })
  .matchAll(/DLL Name:\s*([^\r\n]+)/gi)]
  .map((match) => match[1].trim().toLowerCase())
  .sort()
const expectedBridgeImports = [...bridgeDependencyNames, 'kernel32.dll', 'user32.dll']
  .map((name) => name.toLowerCase())
  .sort()
if (JSON.stringify(bridgeImports) !== JSON.stringify(expectedBridgeImports)) {
  throw new Error(`rebuilt native bridge imports differ from the upstream modular ABI: ${bridgeImports.join(', ')}`)
}
const bridgePeReport = run(tools.objdump, ['-p', bridge], { capture: true })
if (/^\s*GUARD_CF\s*$/m.test(bridgePeReport)) {
  throw new Error('cross-built native bridge unexpectedly advertises invalid Guard CF metadata')
}
process.stdout.write('Windows native incremental rebuild passed.\n')
