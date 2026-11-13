'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { requireBinary } = require('./runtime-platform.cjs')
const root = path.resolve(__dirname, '..')
function buildVault(target = `${process.platform}-${process.arch}`) {
  if (process.platform !== 'linux') throw Error('Build the vault on Linux only')
  if (!['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'].includes(target)) throw Error('Unsupported vault target ' + target)
  const windows = target === 'win32-x64', directory = path.join(root, 'native/core/build', target)
  const darwin = target.startsWith('darwin-'), toolchain = darwin ? require('./macos-toolchain.cjs').macosToolchain(target) : null
  if (darwin && !fs.existsSync(path.join(toolchain.openssl, 'lib/libcrypto.a'))) throw Error('Build the pinned Darwin OpenSSL dependency first: scripts/build-macos-openssl.py')
  const env = { ...process.env, ...toolchain?.environment, CMAKE_BUILD_PARALLEL_LEVEL: '1', MAKEFLAGS: '-j1', RAYON_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' }
  const run = args => {
    // Compiler diagnostics may quote owner-maintained source. Do not print or
    // save that diagnostic stream; the compiler alone processes the source.
    const result = spawnSync('taskset', ['-c', require('./build-limits.cjs').cpu, 'cmake', ...args], { cwd: root, env, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 })
    if (result.error) throw result.error
    if (result.status !== 0) {
      const text = String(result.stderr || '')
      const categories = [...new Set([...text.matchAll(/(?:fatal )?error: (unknown type name|use of undeclared identifier|no member named|no matching function|invalid operands|cannot initialize|undefined symbol|unsupported option|[^\n]*file not found)/g)].map(m => m[1].includes('file not found') ? 'required header not found' : m[1]))]
      console.error(JSON.stringify({ target, phase: args[0] === '--build' ? 'compile-link' : 'configure', diagnosticCategories: categories, protectedDiagnosticsSuppressed: true }))
      // Only diagnostics emitted at explicitly public wrapper source paths are
      // printable. Owner implementation diagnostics and source lines stay hidden.
      for (const line of text.split('\n')) if (/[/\\](?:protocol|wallet_vault|wallet_vault_module|vault_bridge)\.cpp:\d+:\d+: (?:fatal )?error:/.test(line)) console.error(line)
      for (const line of text.split('\n')) if (/^(?:g?make(?:\[\d+\])?: .*No rule to make target|ld: (?:library|framework|file|unknown|unsupported)|clang(?:\+\+)?: error:)/.test(line)) console.error(line)
      throw Error('Vault build failed for ' + target)
    }
  }
  if (darwin) fs.rmSync(path.join(directory, 'CMakeCache.txt'), { force: true })
  run(['-S', 'native/core', '-B', directory, '-DCMAKE_BUILD_TYPE=Release',
    ...(windows ? ['-DCMAKE_SYSTEM_NAME=Windows', '-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++'] : []),
    ...(darwin ? ['-DCMAKE_SYSTEM_NAME=Darwin', '-DCMAKE_CXX_COMPILER=' + toolchain.compiler,
      '-DCMAKE_OSX_SYSROOT=' + toolchain.sdk, '-DCMAKE_OSX_ARCHITECTURES=' + toolchain.arch,
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0', '-DOPENSSL_ROOT_DIR=' + toolchain.openssl,
      '-DOPENSSL_USE_STATIC_LIBS=TRUE', '-DOPENSSL_CRYPTO_LIBRARY=' + path.join(toolchain.openssl, 'lib/libcrypto.a'),
      '-DOPENSSL_INCLUDE_DIR=' + path.join(toolchain.openssl, 'include'),
      '-DZLIB_LIBRARY=' + path.join(toolchain.sdk, 'usr/lib/libz.tbd'),
      '-DZLIB_INCLUDE_DIR=' + path.join(toolchain.sdk, 'usr/include')] : [])])
  run(['--build', directory, '--parallel', '1'])
  const destination = path.join(root, windows || darwin ? 'native-core-stage/' + target : 'native-core')
  fs.mkdirSync(destination, { recursive: true })
  const files = windows ? ['altbase_wallet_vault.dll', 'altbase_vault_bridge.exe'] : ['libaltbase_wallet_vault' + (darwin ? '.dylib' : '.so'), 'altbase_vault_bridge']
  const binaries = []
  for (const name of files) {
    const source = path.join(directory, 'bin', name), final = path.join(destination, name)
    requireBinary(source, target)
    const temporary = final + '.' + crypto.randomUUID() + '.tmp'
    try { fs.copyFileSync(source, temporary); fs.chmodSync(temporary, 0o755); fs.renameSync(temporary, final) }
    finally { fs.rmSync(temporary, { force: true }) }
    binaries.push({ name, size: fs.statSync(final).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex') })
  }
  const receipt = { schemaVersion: 1, target, source: 'native/core/src/wallet_secret.cpp', builtFromProjectSource: true, binaries }
  const metadata = path.join(root, 'local-checks/vault-builds', target + '.json')
  fs.mkdirSync(path.dirname(metadata), { recursive: true }); fs.writeFileSync(metadata, JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ target, vaultBuiltFromProjectSource: true }))
  return receipt
}
if (require.main === module) buildVault(process.argv[2])
module.exports = { buildVault }
