'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { requireBinary } = require('./runtime-platform.cjs')
const root = path.resolve(__dirname, '..')
function buildVault(target = `${process.platform}-${process.arch}`) {
  if (process.platform !== 'linux') throw Error('Build the vault on Linux only')
  if (!['linux-x64', 'win32-x64'].includes(target)) throw Error('A compatible vault toolchain has not been staged for ' + target)
  const windows = target === 'win32-x64', directory = path.join(root, 'native/core/build', target)
  const env = { ...process.env, CMAKE_BUILD_PARALLEL_LEVEL: '1', MAKEFLAGS: '-j1', RAYON_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' }
  const run = args => {
    const result = spawnSync('taskset', ['-c', require('./build-limits.cjs').cpu, 'cmake', ...args], { cwd: root, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw Error('Vault build failed for ' + target)
  }
  run(['-S', 'native/core', '-B', directory, '-DCMAKE_BUILD_TYPE=Release',
    ...(windows ? ['-DCMAKE_SYSTEM_NAME=Windows', '-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++'] : [])])
  run(['--build', directory, '--parallel', '1'])
  const destination = path.join(root, windows ? 'native-core-stage/win32-x64' : 'native-core')
  fs.mkdirSync(destination, { recursive: true })
  const files = windows ? ['altbase_wallet_vault.dll', 'altbase_vault_bridge.exe'] : ['libaltbase_wallet_vault.so', 'altbase_vault_bridge']
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
