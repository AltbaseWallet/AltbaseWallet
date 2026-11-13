'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const args = [path.join(__dirname, 'build-coin-sdks.mjs')]
const result = spawnSync(process.platform === 'linux' ? 'taskset' : process.execPath,
  process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, process.execPath, ...args] : args,
  { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: { ...process.env,
    MAKEFLAGS: '-j1', RAYON_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' } })
if (result.error) throw result.error
process.exit(result.status ?? 1)
