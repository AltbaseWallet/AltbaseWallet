'use strict'
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..'), windows = process.argv.includes('--windows')
const targetWindows = windows || process.platform === 'win32'
const target = windows ? 'win32-x64' : `${process.platform}-${process.arch}`
const out = path.join(root, 'local-checks', 'fixtures', target)
fs.mkdirSync(out, { recursive: true })
const compiler = windows && process.platform !== 'win32' ? 'x86_64-w64-mingw32-g++' : (process.env.CXX || 'c++')
const suffix = targetWindows ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so'
for (const [file, extra] of [
  ['fixture-native', []],
  ['fixture-native-updated', ['-DFIXTURE_VERSION="1.1.0"']],
  ['fixture-bad-abi', ['-DFIXTURE_ABI=99']],
]) {
  const args = ['-std=c++17', '-O2', process.platform === 'darwin' && !windows ? '-dynamiclib' : '-shared', ...extra, 'examples/native-fixture/plugin.cpp', '-o', path.join(out, file + suffix)]
  if (!targetWindows) args.push('-fPIC')
  else args.push('-static-libgcc', '-static-libstdc++', '-static')
  const command = process.platform === 'linux' ? 'taskset' : compiler
  const argv = process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, compiler, ...args] : args
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status) process.exit(result.status)
}
console.log(`Local fixture modules built: ${target}`)
