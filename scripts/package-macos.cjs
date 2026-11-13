'use strict'
// Cross-compile only on Linux, then package both CPU architectures in one ZIP.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
if (process.platform !== 'linux') throw Error('Build this release on Linux')
const cpu = require('./build-limits.cjs').cpu
const environment = { ...process.env, MAKEFLAGS: '-j1', CMAKE_BUILD_PARALLEL_LEVEL: '1', RAYON_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' }
const electronVersion = require('../node_modules/electron/package.json').version
const cache = process.env.ALTBASE_MACOS_ELECTRON_ROOT || path.join(os.homedir(), '.cache/altbase-build/electron', `release-${electronVersion}`)
function run(program, args, env = environment) {
  const result = spawnSync('taskset', ['-c', cpu, program, ...args], { cwd: root, stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error('macOS build or packaging step failed')
}
for (const [target, distribution] of [['darwin-x64', 'unpacked-darwin-x64'], ['darwin-arm64', 'unpacked-darwin-arm64']]) {
  const output = path.join(root, 'local-checks/macos-package', target)
  if (fs.existsSync(output)) throw Error('Remove the previous temporary architecture package before building: ' + output)
  run(process.execPath, ['scripts/build-plugin-host.cjs', '--target', target])
  run(process.execPath, ['scripts/package-project.cjs', target], { ...environment, ALTBASE_ELECTRON_DIST: path.join(cache, distribution), ALTBASE_PACKAGE_OUTPUT: output })
}
run(process.execPath, ['scripts/package-macos-universal.cjs'])
run('python3', ['scripts/package-macos-zip.py'])
