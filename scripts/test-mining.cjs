'use strict'
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process')
const project = path.resolve(__dirname, '..'), root = path.join(project, 'modules/mining')
const linux = process.platform === 'linux'
function run(args, cwd) {
  const result = spawnSync(linux ? 'taskset' : process.execPath,
    linux ? ['-c', require('./build-limits.cjs').cpu, process.execPath, ...args] : args,
    { cwd, stdio: 'inherit', env: { ...process.env, UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1',
      MAKEFLAGS: '-j1', CMAKE_BUILD_PARALLEL_LEVEL: '1' } })
  if (result.error) throw result.error
  return result.status ?? 1
}
let status = run(['scripts/build-mining.cjs'], project)
if (!status) status = run(['--test', '--test-concurrency=1',
  ...fs.readdirSync(path.join(root, 'dist/tests')).filter(name => name.endsWith('.test.js')).sort().map(name => 'dist/tests/' + name),
  'tests/runtime-update.test.cjs'], root)
process.exitCode = status
