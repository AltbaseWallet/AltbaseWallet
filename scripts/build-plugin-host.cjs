'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const windows = process.argv.includes('--windows')
const targetArgument = process.argv.indexOf('--target')
const target = targetArgument >= 0 ? process.argv[targetArgument + 1] : windows ? 'win32-x64' : `${process.platform}-${process.arch}`
if (!['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'].includes(target)) throw Error('Unsupported plugin host target')
const darwin = target.startsWith('darwin-'), toolchain = darwin ? require('./macos-toolchain.cjs').macosToolchain(target) : null
const directory = path.join(root, 'native-plugin-host', 'bin', target)
fs.mkdirSync(directory, { recursive: true })
const output = path.join(directory, target === 'win32-x64' ? 'altbase_plugin_host.exe' : 'altbase_plugin_host')
const compiler = target === 'win32-x64' && process.platform !== 'win32' ? 'x86_64-w64-mingw32-g++' : toolchain?.compiler || (process.env.CXX || 'c++')
const flags = ['-std=c++17', '-O2', '-Wall', '-Wextra', path.join(root, 'native-plugin-host/main.cpp'), '-o', output]
if (target === 'win32-x64') flags.push('-municode', '-static-libgcc', '-static-libstdc++', '-static')
else if (darwin) flags.push(...toolchain.flags)
else if (process.platform === 'linux') flags.push('-ldl')
const command = process.platform === 'linux' ? 'taskset' : compiler
const args = process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, compiler, ...flags] : flags
const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...toolchain?.environment, CMAKE_BUILD_PARALLEL_LEVEL: '1', MAKEFLAGS: '-j1' } })
if (result.error) throw result.error
if (result.status) process.exit(result.status)
console.log(`Plugin host built: ${target}`)
