'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const tasks = [
  ['scripts/build-vault.cjs'],
  ['scripts/build-mining.cjs'],
  ['scripts/build-plugin-host.cjs'],
  ['scripts/build-coin-sdks.mjs'],
  ['scripts/build-account-modules.mjs'],
  ['scripts/stage-coin-binaries.cjs'],
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/vite/bin/vite.js', 'build'],
]
for (const args of tasks) {
  const command = process.platform === 'linux' ? 'taskset' : process.execPath
  const argv = process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, process.execPath, ...args] : args
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', env: { ...process.env,
    CMAKE_BUILD_PARALLEL_LEVEL: '1', MAKEFLAGS: '-j1', RAYON_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' } })
  if (result.error) throw result.error
  if (result.status) process.exit(result.status)
}
