'use strict'
const assert = require('node:assert/strict')

// Only package-management IPC against the caller's new, isolated profile.
// Never download a miner, create a job or start a mining process.
module.exports = async evaluate => {
  const call = async method => {
    const response = await evaluate(`window.altbaseWallet.mining.request(${JSON.stringify({ method })})`)
    assert.equal(response.ok, true, `Mining ${method}: ${response.error || ''}`)
    return response.result
  }
  const before = await call('status')
  assert.equal(before.signatureRequired, false)
  assert.deepEqual(before.runningJobs, [])
  const installed = await call('install')
  assert.equal(installed.installed, true)
  const manifest = await call('manifest'), verified = await call('verify')
  assert.equal(Object.hasOwn(manifest, 'signature'), false)
  assert.equal(verified.ok, true); assert.equal(verified.signatureRequired, false)
  assert.deepEqual((await call('status')).runningJobs, [])
  return { unsignedPackageInstalled: true, integrityVerified: true, signatureRequired: false,
    version: manifest.version, files: manifest.files.length, minerDownloads: 0, miningStarts: 0 }
}
