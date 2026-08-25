const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'modules', 'monero', 'native', 'cleanroom')
const CACHE_ROOT = process.env.ALTBASE_MONERO_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'altbase', 'monero')
const BUILD_ROOT = path.join(CACHE_ROOT, 'compact-wallet-build')
const VERSION = '0.1.7'
const PRODUCTION_FILES = [
  'CMakeLists.txt',
  'altbase_monero_wallet.cpp',
  'altbase_monero_wallet.def',
  'altbase_monero_wallet.map',
  'altbase_monero_wallet.rc',
  'mingw-x64.cmake',
  'monero_clean_binary.cpp',
  'monero_clean_binary.hpp',
  'monero_clean_crypto.cpp',
  'monero_clean_crypto.hpp',
  'monero_clean_json.cpp',
  'monero_clean_json.hpp',
  'monero_clean_proofs.cpp',
  'monero_clean_proofs.hpp',
  'monero_clean_scan.cpp',
  'monero_clean_scan.hpp',
  'monero_clean_transaction.cpp',
  'monero_clean_transaction.hpp',
]

const TARGETS = {
  'linux-x64': { library: 'altbase_monero_wallet.so' },
  'windows-x64': { library: 'altbase_monero_wallet.dll' },
  'macos-x64': { library: 'altbase_monero_wallet.dylib', host: 'x86_64-apple-darwin11', clangTarget: 'x86_64-apple-darwin11', deploymentTarget: '10.8' },
  'macos-arm64': { library: 'altbase_monero_wallet.dylib', host: 'aarch64-apple-darwin11', clangTarget: 'arm64-apple-darwin20', deploymentTarget: '11.0' },
}

const requestedTarget = process.argv.find((value) => value.startsWith('--target='))?.slice('--target='.length)
const defaultTarget = process.platform === 'win32'
  ? 'windows-x64'
  : process.platform === 'darwin'
    ? process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
    : 'linux-x64'
const target = requestedTarget || defaultTarget

const run = (command, args, options = {}) => {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}

const capture = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `${command} exited with status ${result.status}`)
  return result.stdout.trim()
}

const sha256File = (filename) => {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filename))
  return hash.digest('hex')
}

const sourceSha256 = () => {
  const hash = createHash('sha256')
  for (const relative of PRODUCTION_FILES) {
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(SOURCE, relative)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const verifyTwoExports = (names, label) => {
  const expected = ['altbase_monero_wallet_free', 'altbase_monero_wallet_request']
  const actual = [...new Set(names.filter((name) => expected.includes(name)))].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not expose the two-function wallet ABI`)
  }
}

const verifyWindows = (library) => {
  const report = capture('x86_64-w64-mingw32-objdump', ['-p', library])
  const exportTable = report.split('[Ordinal/Name Pointer] Table')[1]?.split('The Function Table')[0] || ''
  const exports = [...exportTable.matchAll(/^\s*\[\s*\d+\].*\s([^\s]+)\s*$/gm)].map((match) => match[1])
  verifyTwoExports(exports, 'Windows module')
  const imports = [...report.matchAll(/^\s*DLL Name:\s*(.+)$/gm)].map((match) => match[1].trim().toLowerCase())
  const unexpectedRuntime = imports.filter((name) => /^(libgcc|libstdc\+\+|libwinpthread)-/.test(name))
  if (unexpectedRuntime.length) throw new Error(`Windows module has unexpected runtime imports: ${unexpectedRuntime.join(', ')}`)
}

const verifyUnix = (library, macos) => {
  const tool = macos ? findMacTool('nm') || 'nm' : 'nm'
  const report = capture(tool, macos ? ['-gU', library] : ['-D', '--defined-only', library])
  const names = report.split('\n').map((line) => (
    line.trim().split(/\s+/).pop()?.replace(/^_/, '').split('@')[0] || ''
  ))
  verifyTwoExports(names, macos ? 'macOS module' : 'Linux module')
}

const findDependsRoot = (buildTarget) => {
  const config = TARGETS[buildTarget]
  const candidates = [
    path.join(CACHE_ROOT, 'source-build', buildTarget, 'source', 'contrib', 'depends', config.host),
    path.join(CACHE_ROOT, 'depends', config.host),
  ]
  const root = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'native', 'bin', 'clang++')))
  if (!root) throw new Error(`macOS cross compiler is missing for ${buildTarget}; expected an installed SDK under ${CACHE_ROOT}`)
  return root
}

const findMacTool = (name) => {
  for (const buildTarget of ['macos-x64', 'macos-arm64']) {
    try {
      const root = findDependsRoot(buildTarget)
      const exact = path.join(root, 'native', 'bin', `${TARGETS[buildTarget].host}-${name}`)
      if (fs.existsSync(exact)) return exact
      const plain = path.join(root, 'native', 'bin', name)
      if (fs.existsSync(plain)) return plain
    } catch {
      // Try the other installed architecture.
    }
  }
  return null
}

const configureArguments = (buildTarget, buildDir) => {
  const args = ['-S', SOURCE, '-B', buildDir, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']
  if (buildTarget === 'windows-x64') {
    args.push(`-DCMAKE_TOOLCHAIN_FILE=${path.join(SOURCE, 'mingw-x64.cmake')}`)
  } else if (buildTarget.startsWith('macos-')) {
    const config = TARGETS[buildTarget]
    const depends = findDependsRoot(buildTarget)
    const bin = path.join(depends, 'native', 'bin')
    args.push(
      '-DCMAKE_SYSTEM_NAME=Darwin',
      `-DCMAKE_SYSTEM_PROCESSOR=${buildTarget === 'macos-arm64' ? 'arm64' : 'x86_64'}`,
      `-DCMAKE_C_COMPILER=${path.join(bin, 'clang')}`,
      `-DCMAKE_CXX_COMPILER=${path.join(bin, 'clang++')}`,
      `-DCMAKE_C_COMPILER_TARGET=${config.clangTarget}`,
      `-DCMAKE_CXX_COMPILER_TARGET=${config.clangTarget}`,
      `-DCMAKE_OSX_SYSROOT=${path.join(depends, 'native', 'SDK')}`,
      `-DCMAKE_OSX_DEPLOYMENT_TARGET=${config.deploymentTarget}`,
      `-DCMAKE_OSX_ARCHITECTURES=${buildTarget === 'macos-arm64' ? 'arm64' : 'x86_64'}`,
      `-DCMAKE_CXX_FLAGS=-stdlib=libc++ -B${path.join(bin, `${config.host}-`)}`,
      `-DCMAKE_C_FLAGS=-B${path.join(bin, `${config.host}-`)}`,
    )
  }
  return args
}

const findWorkingTool = (names) => {
  for (const name of names) {
    if (!name) continue
    const result = spawnSync(name, ['--version'], { stdio: 'ignore' })
    if (!result.error) return name
  }
  return null
}

const buildWindowsMsvc = () => {
  const clangCl = findWorkingTool([
    process.env.ALTBASE_CLANG_CL,
    'clang-cl-19',
    'clang-cl',
  ])
  const linker = findWorkingTool([
    process.env.ALTBASE_LLD_LINK,
    'lld-link-19',
    'lld-link',
  ])
  const resourceCompiler = findWorkingTool([
    process.env.ALTBASE_LLVM_RC,
    'llvm-rc-19',
    'llvm-rc',
  ])
  const dllTool = findWorkingTool([
    process.env.ALTBASE_LLVM_DLLTOOL,
    'llvm-dlltool-19',
    'llvm-dlltool',
  ])
  if (!clangCl || !linker || !resourceCompiler || !dllTool) {
    throw new Error('Windows wallet build requires clang-cl, lld-link, llvm-rc, and llvm-dlltool; the MinGW runtime is intentionally not used')
  }

  const sdkRoot = process.env.ALTBASE_XWIN_SDK
    || path.join(os.homedir(), '.cache', 'altbase-build', 'xwin-sdk')
  const crtRoot = path.join(sdkRoot, 'crt')
  const windowsSdk = path.join(sdkRoot, 'sdk')
  const requiredInputs = [
    path.join(crtRoot, 'include', 'vector'),
    path.join(crtRoot, 'lib', 'x86_64', 'libcmt.lib'),
    path.join(windowsSdk, 'include', 'um', 'Windows.h'),
    path.join(windowsSdk, 'lib', 'um', 'x86_64', 'kernel32.Lib'),
    path.join(windowsSdk, 'lib', 'ucrt', 'x86_64', 'libucrt.lib'),
  ]
  for (const input of requiredInputs) {
    if (!fs.existsSync(input)) throw new Error(`MSVC/UCRT cross-build input is missing: ${input}`)
  }

  const buildDir = path.join(BUILD_ROOT, 'windows-x64-msvc')
  fs.mkdirSync(buildDir, { recursive: true })
  const includeArguments = [
    `/imsvc${path.join(crtRoot, 'include')}`,
    `/imsvc${path.join(windowsSdk, 'include', 'ucrt')}`,
    `/imsvc${path.join(windowsSdk, 'include', 'shared')}`,
    `/imsvc${path.join(windowsSdk, 'include', 'um')}`,
  ]
  const compileArguments = [
    '--target=x86_64-pc-windows-msvc',
    '/nologo',
    '/std:c++17',
    '/O1',
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
    ...includeArguments,
  ]
  const units = [
    'altbase_monero_wallet',
    'monero_clean_binary',
    'monero_clean_crypto',
    'monero_clean_json',
    'monero_clean_proofs',
    'monero_clean_scan',
    'monero_clean_transaction',
  ]
  const objects = []
  for (const unit of units) {
    const object = path.join(buildDir, `${unit}.obj`)
    run(clangCl, [
      ...compileArguments,
      '/c',
      path.join(SOURCE, `${unit}.cpp`),
      `/Fo${object}`,
    ])
    objects.push(object)
  }

  const resource = path.join(buildDir, 'altbase_monero_wallet.res')
  run(resourceCompiler, [
    `/I${path.join(windowsSdk, 'include', 'shared')}`,
    `/I${path.join(windowsSdk, 'include', 'um')}`,
    `/I${path.join(windowsSdk, 'include', 'ucrt')}`,
    `/Fo${resource}`,
    path.join(SOURCE, 'altbase_monero_wallet.rc'),
  ])

  const networkDefinition = path.join(buildDir, 'altbase_net_core.def')
  const networkImportLibrary = path.join(buildDir, 'altbase_net_core.lib')
  fs.writeFileSync(networkDefinition, [
    'LIBRARY altbase_net_core.dll',
    'EXPORTS',
    '  altbase_net_request',
    '  altbase_net_free',
    '',
  ].join('\n'))
  run(dllTool, [
    '-m',
    'i386:x86-64',
    '-d',
    networkDefinition,
    '-l',
    networkImportLibrary,
  ])

  const library = path.join(buildDir, TARGETS['windows-x64'].library)
  const importLibrary = path.join(buildDir, 'altbase_monero_wallet.lib')
  const pdb = path.join(buildDir, 'altbase_monero_wallet.pdb')
  run(linker, [
    '/dll',
    `/out:${library}`,
    `/implib:${importLibrary}`,
    `/pdb:${pdb}`,
    '/pdbaltpath:altbase_monero_wallet.pdb',
    `/def:${path.join(SOURCE, 'altbase_monero_wallet.def')}`,
    ...objects,
    resource,
    networkImportLibrary,
    `/libpath:${path.join(crtRoot, 'lib', 'x86_64')}`,
    `/libpath:${path.join(windowsSdk, 'lib', 'ucrt', 'x86_64')}`,
    `/libpath:${path.join(windowsSdk, 'lib', 'um', 'x86_64')}`,
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
    '/subsystem:windows,6.01',
    '/machine:x64',
    'bcrypt.lib',
    'kernel32.lib',
  ])

  const binaryText = fs.readFileSync(library).toString('latin1')
  const forbiddenRuntimeMarkers = ['Mingw-w64 runtime failure', 'gcc.gnu.', 'libstdc++', 'libwinpthread']
  const marker = forbiddenRuntimeMarkers.find((value) => binaryText.includes(value))
  if (marker) throw new Error(`Windows wallet module contains a forbidden MinGW runtime marker: ${marker}`)
  verifyWindows(library)
  return library
}

const buildOne = (buildTarget) => {
  const config = TARGETS[buildTarget]
  if (!config) throw new Error(`Unsupported Monero wallet target: ${buildTarget}`)
  if (buildTarget === 'windows-x64') return buildWindowsMsvc()
  const buildDir = path.join(BUILD_ROOT, buildTarget)
  fs.mkdirSync(buildDir, { recursive: true })
  run('cmake', configureArguments(buildTarget, buildDir))
  run('cmake', ['--build', buildDir, '--parallel'])
  if (!buildTarget.startsWith('macos-')) {
    run('ctest', ['--test-dir', buildDir, '--output-on-failure'])
  }
  const library = path.join(buildDir, config.library)
  if (!fs.existsSync(library)) throw new Error(`Compiled wallet module is missing: ${library}`)
  if (buildTarget === 'linux-x64') run('strip', ['--strip-unneeded', library])
  verifyUnix(library, buildTarget.startsWith('macos-'))
  return library
}

const copyArtifact = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
  const previous = `${destination}.old-${process.pid}-${Date.now()}`
  try {
    fs.copyFileSync(source, temporary)
    if (!destination.endsWith('.dll')) fs.chmodSync(temporary, 0o755)
    if (process.platform === 'win32' && fs.existsSync(destination)) {
      fs.renameSync(destination, previous)
      try {
        fs.renameSync(temporary, destination)
      } catch (error) {
        fs.renameSync(previous, destination)
        throw error
      }
    } else {
      fs.renameSync(temporary, destination)
    }
  } finally {
    fs.rmSync(temporary, { force: true })
    fs.rmSync(previous, { force: true })
  }
  console.log(`staged Monero wallet module: ${destination}`)
}

const destinations = (buildTarget, library) => {
  if (buildTarget === 'windows-x64') return [
    path.join(ROOT, 'native', 'core', 'build', 'vs2022-x64-release', 'bin', 'Release', library),
    path.join(ROOT, 'native', 'core', 'build', 'vs2022-x64-release', 'bin', library),
    path.join(ROOT, 'release', 'win-unpacked', 'resources', 'native-core', library),
  ]
  if (buildTarget === 'linux-x64') {
    const defaultBuildRoot = path.join(ROOT, 'native', 'core', 'build', 'linux-x64-release')
    const selectedBuildRoot = process.env.ALTBASE_LINUX_NATIVE_BUILD_DIR
      ? path.resolve(process.env.ALTBASE_LINUX_NATIVE_BUILD_DIR)
      : defaultBuildRoot
    return [...new Set([
      path.join(selectedBuildRoot, 'bin', library),
      path.join(defaultBuildRoot, 'bin', library),
      path.join(ROOT, 'release', 'linux-unpacked', 'resources', 'native-core', library),
    ])]
  }
  if (buildTarget === 'macos-x64') return [
    path.join(ROOT, 'native', 'core', 'build', 'macos-x64-release', 'bin', library),
  ]
  if (buildTarget === 'macos-arm64') return [
    path.join(ROOT, 'native', 'core', 'build', 'macos-arm64-release', 'bin', library),
  ]
  return [
    path.join(ROOT, 'release', 'mac-universal', 'Altbase Wallet.app', 'Contents', 'Resources', 'native-core', library),
  ]
}

const stage = (artifact, buildTarget) => {
  const library = TARGETS[buildTarget]?.library || 'altbase_monero_wallet.dylib'
  for (const destination of destinations(buildTarget, library)) copyArtifact(artifact, destination)
  const manifest = {
    schemaVersion: 4,
    component: 'altbase-monero-wallet',
    version: VERSION,
    target: buildTarget,
    library,
    daemonUrl: 'https://api.altbase.io:18090',
    provenance: {
      kind: 'altbase-compact-source',
      toolchain: buildTarget === 'windows-x64' ? 'clang-cl-msvc-static' : 'cmake-native',
      sourceSha256: sourceSha256(),
      binarySha256: sha256File(artifact),
    },
    walletOperations: ['derive-identity', 'scan', 'balance', 'history', 'send'],
    localState: { encryption: 'aes-256-gcm', schema: 3, resumeOverlapBlocks: 20 },
    excluded: ['node', 'wallet-rpc', 'command-line-tools', 'mining', 'hardware-wallets', 'multisig'],
  }
  fs.writeFileSync(path.join(ROOT, 'modules', 'monero', 'native', 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`source ${manifest.provenance.sourceSha256}; binary ${manifest.provenance.binarySha256}`)
}

if (target === 'macos-universal') {
  const x64 = buildOne('macos-x64')
  const arm64 = buildOne('macos-arm64')
  copyArtifact(x64, destinations('macos-x64', TARGETS['macos-x64'].library)[0])
  copyArtifact(arm64, destinations('macos-arm64', TARGETS['macos-arm64'].library)[0])
  const lipo = findMacTool('lipo') || capture('sh', ['-lc', 'command -v llvm-lipo || command -v lipo'])
  if (!lipo) throw new Error('macOS universal build requires lipo')
  const universal = path.join(BUILD_ROOT, 'macos-universal', 'altbase_monero_wallet.dylib')
  fs.mkdirSync(path.dirname(universal), { recursive: true })
  run(lipo, ['-create', x64, arm64, '-output', universal])
  verifyUnix(universal, true)
  stage(universal, target)
} else {
  stage(buildOne(target), target)
}
