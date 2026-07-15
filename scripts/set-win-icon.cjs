const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const releaseDir = process.env.ALTBASE_RELEASE_DIR || 'release'
const exePath = path.join(root, releaseDir, 'win-unpacked', 'Altbase Wallet.exe')
const iconPath = path.join(root, 'build', 'icon.ico')
const rceditPath = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe')
const appName = 'Altbase Wallet'
const companyName = 'Altbase'
const copyright = 'Copyright (C) 2026 Altbase. All rights reserved.'
const version = String(pkg.version || '0.1.0')
const maxAttempts = 10

const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

for (const file of [exePath, iconPath, rceditPath]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required file: ${file}`)
    process.exit(1)
  }
}

const rceditArgs = [
  exePath,
  '--set-icon', iconPath,
  '--set-file-version', version,
  '--set-product-version', version,
  '--set-version-string', 'CompanyName', companyName,
  '--set-version-string', 'FileDescription', appName,
  '--set-version-string', 'InternalName', appName,
  '--set-version-string', 'LegalCopyright', copyright,
  '--set-version-string', 'LegalTrademarks', appName,
  '--set-version-string', 'OriginalFilename', 'Altbase Wallet.exe',
  '--set-version-string', 'ProductName', appName,
]

const isWritableExe = () => {
  try {
    fs.chmodSync(exePath, 0o666)
    const fd = fs.openSync(exePath, 'r+')
    fs.closeSync(fd)
    return true
  } catch {
    return false
  }
}

let lastResult = null
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  if (!isWritableExe()) {
    if (attempt < maxAttempts) {
      console.warn(`Executable is still locked; retrying icon update (${attempt}/${maxAttempts})...`)
      sleep(Math.min(750 * attempt, 5_000))
      continue
    }
    break
  }

  lastResult = spawnSync(rceditPath, rceditArgs, {
    encoding: 'utf8',
    windowsHide: true,
  })

  if (lastResult.status === 0) process.exit(0)

  const output = `${lastResult.stdout ?? ''}\n${lastResult.stderr ?? ''}`
  const retryable =
    /Unable to commit changes|access is denied|being used by another process|EPERM|EBUSY/i.test(output)

  if (!retryable || attempt === maxAttempts) break
  console.warn(`rcedit could not update the executable yet; retrying (${attempt}/${maxAttempts})...`)
  sleep(Math.min(750 * attempt, 5_000))
}

if (lastResult?.stdout) process.stdout.write(lastResult.stdout)
if (lastResult?.stderr) process.stderr.write(lastResult.stderr)
console.error(`Failed to update Windows icon/version resources. Close Altbase Wallet from ${releaseDir}\\win-unpacked and run the build again.`)
process.exit(lastResult?.status ?? 1)
