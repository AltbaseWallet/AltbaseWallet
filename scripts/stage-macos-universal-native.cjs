'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const targetDir = path.join(root, 'native-core')
const moneroCache = process.env.ALTBASE_MONERO_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'altbase', 'monero')

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}${result.stderr ? `\n${result.stderr}` : ''}`)
  }
  return result.stdout || ''
}

const usableTool = (candidate) => {
  if (!candidate) return false
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

const commandPath = (name) => {
  const result = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

const lipoCandidates = [
  process.env.ALTBASE_LIPO,
  commandPath('llvm-lipo'),
  commandPath('lipo'),
  path.join(
    moneroCache,
    'source-build',
    'macos-x64',
    'source',
    'contrib',
    'depends',
    'x86_64-apple-darwin11',
    'native',
    'bin',
    'x86_64-apple-darwin11-lipo',
  ),
  path.join(
    moneroCache,
    'source-build',
    'macos-arm64',
    'source',
    'contrib',
    'depends',
    'aarch64-apple-darwin11',
    'native',
    'bin',
    'aarch64-apple-darwin11-lipo',
  ),
]
const lipo = lipoCandidates.find(usableTool)
if (!lipo) throw new Error('A working lipo or llvm-lipo is required to stage universal macOS modules')

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-native-universal-'))
const stageArchitecture = (architecture) => {
  run(process.execPath, [
    path.join(root, 'scripts', 'copy-native-core.cjs'),
    '--target=darwin',
    `--arch=${architecture}`,
  ], { env: { ...process.env, ...(process.env.ALTBASE_MACOS_NATIVE_BUILD_ROOT ? { ALTBASE_MACOS_NATIVE_BUILD_DIR: path.join(process.env.ALTBASE_MACOS_NATIVE_BUILD_ROOT, `macos-${architecture}-release`) } : {}) } })
  const destination = path.join(temporaryRoot, architecture)
  fs.cpSync(targetDir, destination, { recursive: true })
  return destination
}

try {
  const x64Dir = stageArchitecture('x64')
  const arm64Dir = stageArchitecture('arm64')
  const universalDir = path.join(temporaryRoot, 'universal')
  fs.mkdirSync(universalDir)

  const x64Files = fs.readdirSync(x64Dir).sort()
  const arm64Files = fs.readdirSync(arm64Dir).sort()
  if (JSON.stringify(x64Files) !== JSON.stringify(arm64Files)) {
    throw new Error('macOS x64 and arm64 native module sets differ')
  }

  for (const name of x64Files) {
    const x64File = path.join(x64Dir, name)
    const arm64File = path.join(arm64Dir, name)
    const output = path.join(universalDir, name)
    const x64Info = spawnSync(lipo, [x64File, '-info'], { stdio: 'ignore' })
    const arm64Info = spawnSync(lipo, [arm64File, '-info'], { stdio: 'ignore' })
    if (x64Info.status === 0 && arm64Info.status === 0) {
      run(lipo, ['-create', x64File, arm64File, '-output', output])
      run(lipo, [output, '-verify_arch', 'x86_64', 'arm64'])
      fs.chmodSync(output, 0o755)
      continue
    }
    if (!fs.readFileSync(x64File).equals(fs.readFileSync(arm64File))) {
      throw new Error(`Non-Mach-O native resource differs between macOS architectures: ${name}`)
    }
    fs.copyFileSync(x64File, output)
  }

  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.cpSync(universalDir, targetDir, { recursive: true })
  console.log(`staged universal macOS native core: ${x64Files.length} files`)
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
