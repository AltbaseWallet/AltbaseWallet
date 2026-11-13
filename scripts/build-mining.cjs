'use strict'
const { spawnSync } = require('node:child_process'), path = require('node:path')
const root = path.resolve(__dirname, '..'), moduleRoot = path.join(root, 'modules/mining')
for (const args of [
  [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
  ['scripts/build-runtime.cjs'],
  ['scripts/build-frontend.cjs'],
  ['scripts/build-manifest.cjs'],
]) {
  const linux = process.platform === 'linux'
  const result = spawnSync(linux ? 'taskset' : process.execPath,
    linux ? ['-c', require('./build-limits.cjs').cpu, process.execPath, ...args] : args,
    { cwd: moduleRoot, stdio: 'inherit', env: { ...process.env, UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1',
      MAKEFLAGS: '-j1', CMAKE_BUILD_PARALLEL_LEVEL: '1' } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
