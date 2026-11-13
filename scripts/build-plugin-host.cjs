'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const windows = process.argv.includes('--windows')
const targetWindows = windows || process.platform === 'win32'
const target = windows ? 'win32-x64' : `${process.platform}-${process.arch}`
const directory = path.join(root, 'native-plugin-host', 'bin', target)
fs.mkdirSync(directory, { recursive: true })
const output = path.join(directory, windows || process.platform === 'win32' ? 'altbase_plugin_host.exe' : 'altbase_plugin_host')
const compiler = windows && process.platform !== 'win32' ? 'x86_64-w64-mingw32-g++' : (process.env.CXX || 'c++')
const flags = ['-std=c++17', '-O2', '-Wall', '-Wextra', path.join(root, 'native-plugin-host/main.cpp'), '-o', output]
if (targetWindows) flags.push('-municode', '-static-libgcc', '-static-libstdc++', '-static')
else if (process.platform === 'linux') flags.push('-ldl')
const command = process.platform === 'linux' ? 'taskset' : compiler
const args = process.platform === 'linux' ? ['-c', require('./build-limits.cjs').cpu, compiler, ...flags] : flags
const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, CMAKE_BUILD_PARALLEL_LEVEL: '1', MAKEFLAGS: '-j1' } })
if (result.error) throw result.error
if (result.status) process.exit(result.status)
console.log(`Plugin host built: ${target}`)
