const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const zanoNative = path.join(root, 'native', 'vendor', 'zano_native_lib')
const zanoSource = path.join(zanoNative, 'Zano')
const buildDir = path.join(zanoSource, 'build', 'altbase-vs2022-x64')
const opensslRoot = path.join(zanoNative, '_install_windows', 'openssl', 'x86_64').replaceAll('\\', '/')
const boostRoot = path.join(zanoNative, '_install_windows', 'boost', 'x86_64').replaceAll('\\', '/')
const pathMapFlags = [
  `/pathmap:${zanoSource}=zano-src`,
  `/pathmap:${zanoSource.replaceAll('\\', '/')}=zano-src`,
  `/pathmap:${zanoNative}=zano-vendor`,
  `/pathmap:${zanoNative.replaceAll('\\', '/')}=zano-vendor`,
  `/pathmap:${root}=.`,
  `/pathmap:${root.replaceAll('\\', '/')}=.`,
].join(' ')
const buildJobs = Math.max(1, Number.parseInt(process.env.ALTBASE_BUILD_JOBS || '7', 10) || 7)
const msbuildParallel = `/m:${buildJobs}`
const releaseCxxFlags = `/DWIN32 /D_WINDOWS /DALTBASE_RELEASE_BINARY=1 /DMOBILE_WALLET_BUILD=1 /experimental:deterministic /Gy /Gw /GF ${pathMapFlags}`
const releaseCFlags = `/DWIN32 /D_WINDOWS /DALTBASE_RELEASE_BINARY=1 /DMOBILE_WALLET_BUILD=1 /experimental:deterministic /Gy /Gw /GF ${pathMapFlags}`

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

const describe = spawnSync('git', ['-C', zanoNative, 'describe', '--tags', '--long'], {
  cwd: root,
  env,
  stdio: 'ignore',
  shell: false,
})
if (describe.status !== 0) {
  run('git', ['-C', zanoNative, 'tag', 'v0.3.1'])
}

run('cmake', [
  '-S', zanoSource,
  '-B', buildDir,
  '-G', 'Visual Studio 17 2022',
  '-A', 'x64',
  '-DBUILD_GUI=OFF',
  '-DDISABLE_TOR=ON',
  '-DMOBILE_WALLET_BUILD=ON',
  '-DALTBASE_NATIVE_HARDENED_RELEASE=ON',
  '-DSTATIC=ON',
  '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
  `-DOPENSSL_ROOT_DIR=${opensslRoot}`,
  `-DBOOST_ROOT=${boostRoot}`,
  `-DBoost_INCLUDE_DIR=${boostRoot}/include`,
  `-DBoost_LIBRARY_DIR_RELEASE=${boostRoot}/lib`,
  '-DBoost_NO_SYSTEM_PATHS=ON',
  '-DBoost_NO_WARN_NEW_VERSIONS=ON',
  `-DCMAKE_CXX_FLAGS=${releaseCxxFlags}`,
  `-DCMAKE_C_FLAGS=${releaseCFlags}`,
])

for (const target of ['common', 'crypto', 'currency_core', 'zlibstatic', 'libminiupnpc-static', 'wallet']) {
  run('cmake', ['--build', buildDir, '--config', 'Release', '--target', target, '--', msbuildParallel])
}
