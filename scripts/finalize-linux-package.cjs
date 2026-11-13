'use strict'
const fs = require('node:fs'), path = require('node:path')
const { requireBinary } = require('./runtime-platform.cjs')

function finalizeLinuxPackage(root = path.resolve(__dirname, '..'), directory = path.join(root, 'artifacts/linux-unpacked')) {
  const launcher = path.join(directory, 'altcoinwallet'), runtime = path.join(directory, 'altcoinwallet-bin')
  if (!fs.lstatSync(launcher).isFile()) throw Error('Linux application must be a regular executable')
  const header = Buffer.alloc(4), fd = fs.openSync(launcher, 'r')
  try { fs.readSync(fd, header, 0, header.length, 0) } finally { fs.closeSync(fd) }
  if (header.equals(Buffer.from([127, 69, 76, 70]))) {
    requireBinary(launcher, 'linux-x64')
    fs.renameSync(launcher, runtime)
  } else {
    if (!fs.lstatSync(runtime).isFile()) throw Error('Linux runtime must be a regular executable')
    requireBinary(runtime, 'linux-x64')
  }
  // A runtime-created system-helper link is machine-specific and never belongs
  // in a portable archive. Retain the original distribution helper separately.
  const helper = path.join(directory, 'chrome-sandbox'), bundled = path.join(directory, 'chrome-sandbox.bundled')
  if (fs.existsSync(helper) || (() => { try { return fs.lstatSync(helper).isSymbolicLink() } catch { return false } })()) {
    const metadata = fs.lstatSync(helper)
    if (metadata.isSymbolicLink()) fs.unlinkSync(helper)
    else {
      if (!metadata.isFile()) throw Error('Invalid bundled Chromium helper')
      fs.renameSync(helper, bundled)
      fs.chmodSync(bundled, 0o755)
    }
  }
  fs.copyFileSync(path.join(root, 'scripts/linux-launcher.sh'), launcher)
  fs.chmodSync(launcher, 0o755)
  fs.copyFileSync(path.join(root, 'build/LINUX-SANDBOX.txt'), path.join(directory, 'LINUX-SANDBOX.txt'))
  return { launcher: 'altcoinwallet', runtime: 'altcoinwallet-bin', automaticNoSandbox: false }
}
if (require.main === module) {
  try { console.log(JSON.stringify(finalizeLinuxPackage())) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { finalizeLinuxPackage }
