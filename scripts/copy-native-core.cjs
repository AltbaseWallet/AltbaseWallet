const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const rawTargetPlatform = process.env.ALTBASE_TARGET_PLATFORM || process.platform
const targetPlatform = rawTargetPlatform === 'macos' ? 'darwin' : rawTargetPlatform
const exeName = targetPlatform === 'win32' ? 'altbase_core_bridge.exe' : 'altbase_core_bridge'
const platformCandidates = {
  win32: [
    path.join(root, 'native', 'core', 'build', 'vs2022-x64-release', 'bin', 'Release', exeName),
    path.join(root, 'native', 'core', 'build', 'vs2022-x64-release', 'bin', exeName),
  ],
  darwin: [
    path.join(root, 'native', 'core', 'build', 'macos-x64-release', 'bin', exeName),
    path.join(root, 'native', 'core', 'build', 'macos-x64-release', 'bin', 'Release', exeName),
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
fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, path.join(targetDir, exeName))
console.log(`copied native core: ${source} -> ${path.join(targetDir, exeName)}`)

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
      fs.copyFileSync(lib, target)
      fs.chmodSync(target, 0o755)
      console.log(`bundled native core library: ${lib} -> ${target}`)
    }
  }
}

bundleLinuxSharedLibraries(source)

if (targetPlatform === 'win32') {
  const epicDll = path.join(root, 'native', 'epic_core', 'target', 'release', 'altbase_epic_core.dll')
  if (fs.existsSync(epicDll)) {
    fs.copyFileSync(epicDll, path.join(targetDir, 'altbase_epic_core.dll'))
    console.log(`copied epic native core: ${epicDll} -> ${path.join(targetDir, 'altbase_epic_core.dll')}`)
  }
} else if (targetPlatform === 'darwin') {
  const epicCandidates = [
    path.join(root, 'native', 'epic_core', 'target', 'x86_64-apple-darwin', 'release', 'libaltbase_epic_core.dylib'),
    path.join(root, 'native', 'epic_core', 'target', 'release', 'libaltbase_epic_core.dylib'),
  ]
  const epicDylib = epicCandidates.find((candidate) => fs.existsSync(candidate))
  if (epicDylib) {
    const target = path.join(targetDir, 'libaltbase_epic_core.dylib')
    fs.copyFileSync(epicDylib, target)
    fs.chmodSync(target, 0o755)
    console.log(`copied epic native core: ${epicDylib} -> ${target}`)
  }
} else {
  const epicSo = path.join(root, 'native', 'epic_core', 'target', 'release', 'libaltbase_epic_core.so')
  if (fs.existsSync(epicSo)) {
    const target = path.join(targetDir, 'libaltbase_epic_core.so')
    fs.copyFileSync(epicSo, target)
    fs.chmodSync(target, 0o755)
    console.log(`copied epic native core: ${epicSo} -> ${target}`)
    bundleLinuxSharedLibraries(epicSo)
  }
}
