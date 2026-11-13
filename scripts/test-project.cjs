'use strict'
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
const tasks = [
  ['scripts/build-vault.cjs'],
  ['scripts/build-plugin-host.cjs'],
  ['scripts/build-plugin-fixtures.cjs'],
  ['--test', '--test-concurrency=1', ...fs.readdirSync(path.join(root, 'tests')).filter(p => p.endsWith('.test.cjs')).sort().map(p => 'tests/' + p)],
]
for (const args of tasks) {
  const command = process.platform === 'linux' ? 'taskset' : process.execPath
  const argv = process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, process.execPath, ...args] : args
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', env: { ...process.env, UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1', MAKEFLAGS: '-j1' } })
  if (result.error) throw result.error
  if (result.status) process.exit(result.status)
}
