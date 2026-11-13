'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function compileJavascriptModule(source, output, target = `${process.platform}-${process.arch}`) {
  if (!['linux-x64', 'win32-x64', 'darwin-arm64', 'darwin-x64'].includes(target)) throw Error('Unsupported module binary target')
  if (process.platform !== 'linux') throw Error('Compile module binaries on Linux only')
  if (target.startsWith('darwin')) throw Error('A Linux-to-macOS compiler and SDK have not been staged')
  const directory = path.join(root, 'local-checks', 'javascript-binary-build', crypto.randomUUID())
  fs.mkdirSync(directory, { recursive: true })
  const wrapper = '(function(exports,require,module,__filename,__dirname){\n' + source + '\n})'
  const delimiter = 'AB' + crypto.randomBytes(6).toString('hex')
  fs.writeFileSync(path.join(directory, 'javascript-program.inc'), 'static const char program[] = R"' + delimiter + '(' + wrapper + ')' + delimiter + '";\n')
  const windows = target === 'win32-x64', compiler = windows ? 'x86_64-w64-mingw32-g++' : 'c++'
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const args = ['-std=c++17', '-O2', '-shared', '-fvisibility=hidden', '-I', directory,
    path.join(root, 'plugin-sdk/javascript-module.cpp'), '-o', output]
  if (windows) args.push('-static-libgcc', '-static-libstdc++', '-static')
  else args.push('-fPIC', '-ldl')
  try {
    const result = spawnSync('taskset', ['-c', require('./build-limits.cjs').cpu, compiler, ...args], { stdio: 'inherit', env: { ...process.env, MAKEFLAGS: '-j1', CMAKE_BUILD_PARALLEL_LEVEL: '1' } })
    if (result.error) throw result.error
    if (result.status !== 0) throw Error('Compiled JavaScript module build failed')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}
module.exports = { compileJavascriptModule }
