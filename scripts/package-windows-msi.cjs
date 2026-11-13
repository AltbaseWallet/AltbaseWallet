'use strict'
// Wrap the already built, branded Windows application. No native source is
// read or compiled by this installer step, and no publication is performed.
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), pkg = require('../package.json')
const appDirectory = path.resolve(process.env.ALTBASE_WINDOWS_APP_DIRECTORY || path.join(root, 'artifacts/win-unpacked'))
require('./runtime-platform.cjs').requireBinary(path.join(appDirectory, pkg.productName + '.exe'), 'win32-x64')
const result = spawnSync('taskset', ['-c', require('./build-limits.cjs').cpu, 'python3',
  'scripts/build-windows-msi.py'], { cwd: root, stdio: 'inherit', env: {
  ...process.env, UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1', MAKEFLAGS: '-j1',
  CMAKE_BUILD_PARALLEL_LEVEL: '1', ALTBASE_WINDOWS_APP_DIRECTORY: appDirectory,
} })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
if (result.status === 0) {
  const zip = spawnSync('taskset', ['-c', require('./build-limits.cjs').cpu, 'python3',
    'scripts/package-windows-zip.py'], { cwd: root, stdio: 'inherit', env: process.env })
  if (zip.error) throw zip.error
  process.exitCode = zip.status ?? 1
}
