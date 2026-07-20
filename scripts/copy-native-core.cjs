const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const rawTargetPlatform = process.env.ALTBASE_TARGET_PLATFORM || process.platform
const targetPlatform = rawTargetPlatform === 'macos' ? 'darwin' : rawTargetPlatform
const targetArchitecture = process.env.ALTBASE_TARGET_ARCH || process.arch
if (targetPlatform === 'darwin' && !['x64', 'arm64'].includes(targetArchitecture)) {
  throw new Error(`Unsupported macOS native architecture: ${targetArchitecture}`)
}
const macosBuildFolder = `macos-${targetArchitecture}-release`
const exeName = targetPlatform === 'win32' ? 'altbase_core_bridge.exe' : 'altbase_core_bridge'
const platformCandidates = {
  win32: [
    path.join(root, 'native', 'core', 'build', 'vs2022-x64-release', 'bin', 'Release', exeName),
    path.join(root, 'native', 'core', 'build', 'vs2022-x64-release', 'bin', exeName),
  ],
  darwin: [
    path.join(root, 'native', 'core', 'build', macosBuildFolder, 'bin', exeName),
    path.join(root, 'native', 'core', 'build', macosBuildFolder, 'bin', 'Release', exeName),
  ],
  linux: [
    path.join(root, 'native', 'core', 'build', 'linux-x64-release', 'bin', exeName),
    path.join(root, 'native', 'core', 'build', 'linux-x64-release', 'bin', 'Release', exeName),
  ],
}
const candidates = platformCandidates[targetPlatform] || []

const source = candidates.find((candidate) => fs.existsSync(candidate))
if (!source) {
  console.error(`Native core binary not found. Checked:\n${candidates.join('\n')}`)
  process.exit(1)
}

const targetDir = path.join(root, 'native-core')
fs.rmSync(targetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, path.join(targetDir, exeName))
console.log(`copied native core: ${source} -> ${path.join(targetDir, exeName)}`)

const utxoCoinIds = [
  'bitcoin',
  'bitcoin2',
  'bitcoincashii',
  'firo',
  'btgs',
  'capstash',
  'hypercoin',
  'mydogecoin',
  'pepecoin',
  'kerrigan',
  'scash',
  'litecoinii',
  'neoxa',
  'terracoin',
  'junkcoin',
  'raptoreum',
  'pearl',
]
const nodeCoinIds = [...utxoCoinIds, 'zano', 'epic', 'quai', 'qubic', 'kaspa', 'ckb']
const nativeBuildFolder = {
  win32: 'vs2022-x64-release',
  darwin: macosBuildFolder,
  linux: 'linux-x64-release',
}[targetPlatform]
const builtModuleCandidates = (name) => [
  path.join(root, 'native', 'core', 'build', nativeBuildFolder, 'bin', 'Release', name),
  path.join(root, 'native', 'core', 'build', nativeBuildFolder, 'bin', name),
]
const copyBuiltModule = (name, label) => {
  const modulePath = builtModuleCandidates(name).find((candidate) => fs.existsSync(candidate))
  if (!modulePath) throw new Error(`${label} was not built: ${name}`)
  const target = path.join(targetDir, name)
  fs.copyFileSync(modulePath, target)
  if (targetPlatform !== 'win32') fs.chmodSync(target, 0o755)
  console.log(`copied ${label}: ${modulePath} -> ${target}`)
}
const utxoModuleExtension = targetPlatform === 'win32' ? '.dll' : targetPlatform === 'darwin' ? '.dylib' : '.so'
const copyUtxoWalletModules = () => {
  for (const coinId of utxoCoinIds) {
    copyBuiltModule(`altbase_${coinId}_wallet${utxoModuleExtension}`, `${coinId} wallet module`)
  }
}
const copyCoinNodeModules = () => {
  for (const coinId of nodeCoinIds) {
    copyBuiltModule(`altbase_${coinId}_node${utxoModuleExtension}`, `${coinId} node module`)
  }
}
const sharedLibraryPrefix = targetPlatform === 'win32' ? '' : 'lib'
const sharedLibraryName = (baseName) => `${sharedLibraryPrefix}${baseName}${utxoModuleExtension}`
const copySecpModule = () => {
  const secpBuildRoot = path.join(root, 'native', 'core', 'build', nativeBuildFolder, '_deps', 'secp256k1-build')
  const platformFiles = {
    win32: ['libsecp256k1-6.dll'],
    darwin: ['libsecp256k1.6.dylib', 'libsecp256k1.dylib'],
    linux: ['libsecp256k1.so.6', 'libsecp256k1.so.6.0.1', 'libsecp256k1.so'],
  }[targetPlatform] || []
  const searchDirs = [
    path.join(secpBuildRoot, 'bin', 'Release'),
    path.join(secpBuildRoot, 'bin'),
    path.join(secpBuildRoot, 'lib', 'Release'),
    path.join(secpBuildRoot, 'lib'),
  ]
  let copied = 0
  for (const file of platformFiles) {
    const secpSource = searchDirs.map((dir) => path.join(dir, file)).find((candidate) => fs.existsSync(candidate))
    if (!secpSource) continue
    const target = path.join(targetDir, file)
    fs.copyFileSync(secpSource, target)
    if (targetPlatform !== 'win32') fs.chmodSync(target, 0o755)
    console.log(`copied secp256k1 module: ${secpSource} -> ${target}`)
    copied += 1
  }
  if (copied === 0) throw new Error('secp256k1 shared module was not built')
}
const copyCommonNativeModules = () => {
  copyBuiltModule(sharedLibraryName('altbase_utxo_address'), 'UTXO address core')
  copyBuiltModule(sharedLibraryName('altbase_utxo_derivation'), 'UTXO derivation core')
  copyBuiltModule(sharedLibraryName('altbase_utxo_signer'), 'UTXO signing core')
  copyBuiltModule(sharedLibraryName('altbase_utxo_planner'), 'UTXO planning core')
  copyBuiltModule(sharedLibraryName('altbase_wallet_vault'), 'wallet vault')
  copyBuiltModule(sharedLibraryName('altbase_net_core'), 'network transport')
  copyBuiltModule(sharedLibraryName('altbase_zano_wallet'), 'Zano wallet module')
  copyBuiltModule(sharedLibraryName('altbase_epic_wallet'), 'Epic wallet module')
  copyBuiltModule(sharedLibraryName('altbase_zano_core'), 'Zano protocol core')
  copySecpModule()
  const staleWalletCore = path.join(targetDir, sharedLibraryName('altbase_wallet_core'))
  if (fs.existsSync(staleWalletCore)) fs.rmSync(staleWalletCore)
  const staleUtxoCore = path.join(targetDir, sharedLibraryName('altbase_utxo_core'))
  if (fs.existsSync(staleUtxoCore)) fs.rmSync(staleUtxoCore)
  for (const staleName of ['altbase_utxo_keys', 'altbase_utxo_tx']) {
    const staleModule = path.join(targetDir, sharedLibraryName(staleName))
    if (fs.existsSync(staleModule)) fs.rmSync(staleModule)
  }
}

const bundledLibNames = new Set()
const bundleLinuxSharedLibraries = (binary) => {
  if (targetPlatform !== 'linux' || process.platform !== 'linux') return
  const skipLib = (file) => {
    const name = path.basename(file)
    return name === 'linux-vdso.so.1' ||
      name === 'ld-linux-x86-64.so.2' ||
      name.startsWith('libc.so.') ||
      name.startsWith('libm.so.') ||
      name.startsWith('libpthread.so.') ||
      name.startsWith('libdl.so.') ||
      name.startsWith('librt.so.')
  }
  const ldd = spawnSync('ldd', [binary], { encoding: 'utf8' })
  if (ldd.status !== 0) {
    console.warn(`ldd failed for ${binary}; Linux shared libraries were not bundled: ${ldd.stderr || ldd.stdout}`)
  } else {
    for (const line of ldd.stdout.split(/\r?\n/)) {
      const match = line.match(/=>\s+(\/\S+)/) || line.match(/^\s*(\/\S+)/)
      const lib = match?.[1]
      if (!lib || skipLib(lib) || bundledLibNames.has(path.basename(lib))) continue
      bundledLibNames.add(path.basename(lib))
      const target = path.join(targetDir, path.basename(lib))
      if (path.resolve(lib) !== path.resolve(target)) fs.copyFileSync(lib, target)
      fs.chmodSync(target, 0o755)
      console.log(`bundled native core library: ${lib} -> ${target}`)
    }
  }
}

const bundleAllLinuxSharedLibraries = () => {
  if (targetPlatform !== 'linux' || process.platform !== 'linux') return
  for (let round = 0; round < 12; round += 1) {
    const before = bundledLibNames.size
    const binaries = fs.readdirSync(targetDir)
      .filter((name) => name === exeName || name.includes('.so'))
      .map((name) => path.join(targetDir, name))
      .filter((file) => fs.statSync(file).isFile())
    for (const binary of binaries) bundleLinuxSharedLibraries(binary)
    if (bundledLibNames.size === before) return
  }
  throw new Error('Linux native dependency bundling did not converge')
}

bundleLinuxSharedLibraries(source)

if (targetPlatform === 'win32') {
  for (const moduleName of ['state', 'sender', 'transport']) {
    const moduleFile = `altbase_epic_${moduleName}.dll`
    const moduleSource = path.join(root, 'native', 'epic_core', 'target', 'release', moduleFile)
    if (fs.existsSync(moduleSource)) {
      fs.copyFileSync(moduleSource, path.join(targetDir, moduleFile))
      console.log(`copied Epic ${moduleName} module: ${moduleSource} -> ${path.join(targetDir, moduleFile)}`)
    }
  }
  const staleEpicCore = path.join(targetDir, 'altbase_epic_core.dll')
  if (fs.existsSync(staleEpicCore)) fs.rmSync(staleEpicCore)
  copyUtxoWalletModules()
  copyCoinNodeModules()
  copyCommonNativeModules()
  const obsoletePrivacyDll = path.join(targetDir, 'altbase_privacy_core.dll')
  if (fs.existsSync(obsoletePrivacyDll)) {
    fs.rmSync(obsoletePrivacyDll)
    console.log(`removed obsolete shared privacy module: ${obsoletePrivacyDll}`)
  }
  const vcRuntimeNames = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
  for (const name of vcRuntimeNames) {
    const staleRuntime = path.join(targetDir, name)
    if (fs.existsSync(staleRuntime)) fs.rmSync(staleRuntime)
    const staleUppercaseRuntime = path.join(targetDir, name.toUpperCase())
    if (fs.existsSync(staleUppercaseRuntime)) fs.rmSync(staleUppercaseRuntime)
  }

  const dynamicCrtImporters = fs.readdirSync(targetDir)
    .filter((name) => /\.(?:dll|exe)$/i.test(name))
    .filter((name) => {
      const binaryText = fs.readFileSync(path.join(targetDir, name)).toString('latin1').toLowerCase()
      return vcRuntimeNames.some((runtime) => binaryText.includes(runtime))
    })
  if (dynamicCrtImporters.length > 0) {
    throw new Error(`Native binaries still require the Visual C++ Runtime: ${dynamicCrtImporters.join(', ')}`)
  }
  console.log('verified native core: no Visual C++ Runtime DLL imports')
} else if (targetPlatform === 'darwin') {
  copyUtxoWalletModules()
  copyCoinNodeModules()
  copyCommonNativeModules()
  for (const moduleName of ['state', 'sender', 'transport']) {
    const moduleFile = `libaltbase_epic_${moduleName}.dylib`
    const rustTarget = targetArchitecture === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    const candidates = [
      path.join(root, 'native', 'epic_core', 'target', rustTarget, 'release', moduleFile),
      path.join(root, 'native', 'epic_core', 'target', 'release', moduleFile),
    ]
    const moduleSource = candidates.find((candidate) => fs.existsSync(candidate))
    if (moduleSource) {
      const target = path.join(targetDir, moduleFile)
      fs.copyFileSync(moduleSource, target)
      fs.chmodSync(target, 0o755)
      console.log(`copied Epic ${moduleName} module: ${moduleSource} -> ${target}`)
    }
  }
  const staleEpicCore = path.join(targetDir, 'libaltbase_epic_core.dylib')
  if (fs.existsSync(staleEpicCore)) fs.rmSync(staleEpicCore)
} else {
  copyUtxoWalletModules()
  copyCoinNodeModules()
  copyCommonNativeModules()
  for (const moduleName of ['state', 'sender', 'transport']) {
    const moduleFile = `libaltbase_epic_${moduleName}.so`
    const moduleSource = path.join(root, 'native', 'epic_core', 'target', 'release', moduleFile)
    if (fs.existsSync(moduleSource)) {
    const target = path.join(targetDir, moduleFile)
    fs.copyFileSync(moduleSource, target)
    fs.chmodSync(target, 0o755)
    console.log(`copied Epic ${moduleName} module: ${moduleSource} -> ${target}`)
    bundleLinuxSharedLibraries(moduleSource)
    }
  }
  bundleAllLinuxSharedLibraries()
  const staleEpicCore = path.join(targetDir, 'libaltbase_epic_core.so')
  if (fs.existsSync(staleEpicCore)) fs.rmSync(staleEpicCore)
}
