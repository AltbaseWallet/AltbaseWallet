'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const sdkRoot = process.env.ALTBASE_XWIN_SDK
  || path.join(os.homedir(), '.cache', 'altbase-build', 'xwin-sdk')
const crtRoot = path.join(sdkRoot, 'crt')
const windowsSdk = path.join(sdkRoot, 'sdk')
const buildBin = path.join(root, 'native', 'core', 'build', 'vs2022-x64-release', 'bin')
const releaseBin = path.join(buildBin, 'Release')
const work = path.join(os.homedir(), '.cache', 'altbase-build', 'windows-epic-sender')
const targetDir = path.join(root, 'native', 'target-epic-modular-windows')
const legacyRelease = path.join(root, 'native', 'epic_core', 'target', 'release')
const transportManifest = path.join(root, 'native', 'epic_transport', 'Cargo.toml')
const stateManifest = path.join(root, 'native', 'epic_state', 'Cargo.toml')
const senderManifest = path.join(root, 'native', 'epic_sender', 'Cargo.toml')
const target = 'x86_64-pc-windows-msvc'
const wrapperDir = path.join(work, 'toolchains')

const run = (command, args, options = {}) => {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: options.capture ? 64 * 1024 * 1024 : undefined,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}${result.stderr ? `\n${result.stderr}` : ''}`)
  }
  return options.capture ? result.stdout : ''
}

const requireFile = (filename) => {
  if (!fs.existsSync(filename)) throw new Error(`required Windows Epic build input is missing: ${filename}`)
}

fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(wrapperDir, { recursive: true })
for (const [filename, tool] of [
  ['rc.exe', 'llvm-rc-19'],
  ['lib.exe', 'llvm-lib-19'],
]) {
  const wrapper = path.join(wrapperDir, filename)
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${tool} "$@"\n`)
  fs.chmodSync(wrapper, 0o755)
}

for (const filename of [
  transportManifest,
  stateManifest,
  senderManifest,
  path.join(wrapperDir, 'rc.exe'),
  path.join(wrapperDir, 'lib.exe'),
  path.join(crtRoot, 'include', 'vector'),
  path.join(crtRoot, 'lib', 'x86_64', 'libcmt.lib'),
  path.join(windowsSdk, 'include', 'um', 'Windows.h'),
  path.join(windowsSdk, 'lib', 'um', 'x86_64', 'kernel32.Lib'),
  path.join(windowsSdk, 'lib', 'um', 'x86_64', 'winsqlite3.lib'),
  path.join(windowsSdk, 'lib', 'ucrt', 'x86_64', 'libucrt.lib'),
  path.join(releaseBin, 'altbase_epic_transport.dll'),
]) requireFile(filename)

fs.mkdirSync(legacyRelease, { recursive: true })

const installedTargets = run('rustup', ['target', 'list', '--installed'], { capture: true })
if (!installedTargets.split(/\r?\n/).includes(target)) run('rustup', ['target', 'add', target])

const objdump = process.env.ALTBASE_OBJDUMP || 'x86_64-w64-mingw32-objdump'
const dlltool = process.env.ALTBASE_LLVM_DLLTOOL || 'llvm-dlltool-19'
const transportDll = path.join(releaseBin, 'altbase_epic_transport.dll')
const transportReport = run(objdump, ['-p', transportDll], { capture: true })
const transportTable = transportReport.split('[Ordinal/Name Pointer] Table')[1]?.split('The Function Table')[0] || ''
const transportExports = [...transportTable.matchAll(/^\s*\[\s*\d+\].*\s([^\s]+)\s*$/gm)]
  .map((match) => match[1])
  .filter((name) => /^[A-Za-z_][A-Za-z0-9_@?$]*$/.test(name))
  .sort()
const expectedTransportExports = ['altbase_epic_transport_free', 'altbase_epic_transport_request']
if (JSON.stringify(transportExports) !== JSON.stringify(expectedTransportExports)) {
  throw new Error(`Epic transport DLL exports are wrong: ${transportExports.join(', ')}`)
}
const transportDef = path.join(work, 'altbase_epic_transport.def')
const transportLib = path.join(work, 'altbase_epic_transport.lib')
fs.writeFileSync(
  transportDef,
  `LIBRARY altbase_epic_transport.dll\nEXPORTS\n${transportExports.map((name) => `  ${name}`).join('\n')}\n`,
)
run(dlltool, ['-m', 'i386:x86-64', '-d', transportDef, '-l', transportLib])

const includeFlags = [
  `/imsvc${path.join(crtRoot, 'include')}`,
  `/imsvc${path.join(windowsSdk, 'include', 'ucrt')}`,
  `/imsvc${path.join(windowsSdk, 'include', 'shared')}`,
  `/imsvc${path.join(windowsSdk, 'include', 'um')}`,
].join(' ')
const rustFlags = [
  '-C', 'target-feature=+crt-static',
  `-Lnative=${path.join(crtRoot, 'lib', 'x86_64')}`,
  `-Lnative=${path.join(windowsSdk, 'lib', 'ucrt', 'x86_64')}`,
  `-Lnative=${path.join(windowsSdk, 'lib', 'um', 'x86_64')}`,
  process.env.RUSTFLAGS || '',
].filter(Boolean).join(' ')
const cargoEnv = {
  ALTBASE_EPIC_TRANSPORT_LIB_DIR: work,
  AR_x86_64_pc_windows_msvc: 'llvm-lib-19',
  CC_x86_64_pc_windows_msvc: 'clang-cl-19',
  CXX_x86_64_pc_windows_msvc: 'clang-cl-19',
  CFLAGS_x86_64_pc_windows_msvc: includeFlags,
  CXXFLAGS_x86_64_pc_windows_msvc: includeFlags,
  CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER: 'lld-link-19',
  PATH: `${wrapperDir}${path.delimiter}${process.env.PATH}`,
  RUSTFLAGS: rustFlags,
}
const jobs = String(Math.max(1, Number(process.env.ALTBASE_BUILD_JOBS) || Math.min(os.cpus().length, 4)))
run('cargo', [
  'build', '--release', '--locked',
  '--target', target,
  '--manifest-path', senderManifest,
  '--target-dir', targetDir,
  '-j', jobs,
], { env: cargoEnv })

const sender = path.join(targetDir, target, 'release', 'altbase_epic_sender.dll')
requireFile(sender)
const senderReport = run(objdump, ['-p', sender], { capture: true })
const senderTable = senderReport.split('[Ordinal/Name Pointer] Table')[1]?.split('The Function Table')[0] || ''
const senderExports = [...senderTable.matchAll(/^\s*\[\s*\d+\].*\s([^\s]+)\s*$/gm)]
  .map((match) => match[1])
  .filter((name) => /^[A-Za-z_][A-Za-z0-9_@?$]*$/.test(name))
  .sort()
const expectedSenderExports = ['altbase_epic_sender_free', 'altbase_epic_sender_request']
if (JSON.stringify(senderExports) !== JSON.stringify(expectedSenderExports)) {
  throw new Error(`Epic sender DLL exports are wrong: ${senderExports.join(', ')}`)
}
const imports = [...senderReport.matchAll(/DLL Name:\s*([^\r\n]+)/gi)]
  .map((match) => match[1].trim().toLowerCase())
if (imports.some((name) => /^(msvcp|vcruntime|concrt).*\.dll$/.test(name))) {
  throw new Error(`Epic sender DLL imports the Visual C++ runtime: ${imports.join(', ')}`)
}
for (const destination of [
  path.join(releaseBin, 'altbase_epic_sender.dll'),
  path.join(buildBin, 'altbase_epic_sender.dll'),
  path.join(legacyRelease, 'altbase_epic_sender.dll'),
]) {
  fs.copyFileSync(sender, destination)
  process.stdout.write(`staged Epic sender module: ${destination}\n`)
}

const verifyAndStageModule = (component, expectedExports) => {
  const filename = `altbase_epic_${component}.dll`
  const built = path.join(targetDir, target, 'release', filename)
  requireFile(built)
  const report = run(objdump, ['-p', built], { capture: true })
  const table = report.split('[Ordinal/Name Pointer] Table')[1]?.split('The Function Table')[0] || ''
  const exports = [...table.matchAll(/^\s*\[\s*\d+\].*\s([^\s]+)\s*$/gm)]
    .map((match) => match[1])
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_@?$]*$/.test(name))
    .sort()
  if (JSON.stringify(exports) !== JSON.stringify([...expectedExports].sort())) {
    throw new Error(`Epic ${component} DLL exports are wrong: ${exports.join(', ')}`)
  }
  const imports = [...report.matchAll(/DLL Name:\s*([^\r\n]+)/gi)]
    .map((match) => match[1].trim().toLowerCase())
  if (imports.some((name) => /^(msvcp|vcruntime|concrt).*\.dll$/.test(name))) {
    throw new Error(`Epic ${component} DLL imports the Visual C++ runtime: ${imports.join(', ')}`)
  }
  for (const destination of [
    path.join(releaseBin, filename),
    path.join(buildBin, filename),
    path.join(legacyRelease, filename),
  ]) {
    fs.copyFileSync(built, destination)
    process.stdout.write(`staged Epic ${component} module: ${destination}\n`)
  }
}

run('cargo', [
  'build', '--release', '--locked',
  '--target', target,
  '--manifest-path', transportManifest,
  '--target-dir', targetDir,
  '-j', jobs,
], { env: cargoEnv })
verifyAndStageModule('transport', [
  'altbase_epic_transport_free',
  'altbase_epic_transport_request',
])

run('cargo', [
  'build', '--release', '--locked',
  '--target', target,
  '--manifest-path', stateManifest,
  '--target-dir', targetDir,
  '-j', jobs,
], { env: cargoEnv })
verifyAndStageModule('state', [
  'altbase_epic_state_free',
  'altbase_epic_state_request',
])

process.stdout.write('Windows Epic transport, state, and sender rebuild passed.\n')
