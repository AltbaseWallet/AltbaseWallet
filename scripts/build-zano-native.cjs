const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const zanoNative = path.join(root, 'native', 'vendor', 'zano_native_lib')
const zanoSource = path.join(zanoNative, 'Zano')
const buildDir = path.join(zanoSource, 'build', 'altbase-vs2022-x64')
const opensslRoot = path.join(zanoNative, '_install_windows', 'openssl', 'x86_64').replaceAll('\\', '/')
const boostRoot = path.join(zanoNative, '_install_windows', 'boost', 'x86_64').replaceAll('\\', '/')

const env = {
  ...process.env,
  GIT_CEILING_DIRECTORIES: process.env.GIT_CEILING_DIRECTORIES || path.resolve(root, '..'),
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  if (result.status !== 0 && !options.allowFailure) process.exit(result.status || 1)
}

run('git', ['-C', zanoNative, 'submodule', 'update', '--init', '--depth', '1', 'Zano'])
run('git', ['-C', zanoSource, 'submodule', 'update', '--init', '--depth', '1', 'contrib/miniupnp', 'contrib/jwt-cpp', 'contrib/bitcoin-secp256k1', 'contrib/tor-connect'])
run('git', ['-C', zanoSource, 'fetch', '--tags', '--force'])
run('git', ['-C', zanoSource, 'fetch', '--unshallow'], { stdio: 'ignore', allowFailure: true })
run('git', ['-C', zanoNative, 'lfs', 'pull', '-I', '_install_windows/openssl/x86_64/**,_install_windows/boost/x86_64/**'])

run('cmake', [
  '-S', zanoSource,
  '-B', buildDir,
  '-G', 'Visual Studio 17 2022',
  '-A', 'x64',
  '-DBUILD_GUI=OFF',
  '-DDISABLE_TOR=ON',
  '-DSTATIC=OFF',
  `-DOPENSSL_ROOT_DIR=${opensslRoot}`,
  `-DBOOST_ROOT=${boostRoot}`,
  `-DBoost_INCLUDE_DIR=${boostRoot}/include`,
  `-DBoost_LIBRARY_DIR_RELEASE=${boostRoot}/lib`,
  '-DBoost_NO_SYSTEM_PATHS=ON',
  '-DBoost_NO_WARN_NEW_VERSIONS=ON',
])

for (const target of ['common', 'crypto', 'currency_core', 'rpc', 'zlibstatic', 'ethash', 'libminiupnpc-static', 'wallet']) {
  run('cmake', ['--build', buildDir, '--config', 'Release', '--target', target, '--', '/m:2'])
}
