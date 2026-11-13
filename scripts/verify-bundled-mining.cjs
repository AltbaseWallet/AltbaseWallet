'use strict'
const path = require('node:path')
const { MiningModuleManager } = require('../electron/mining-module-manager.cjs')

async function verifyBundledMining(root = path.resolve(__dirname, '..')) {
  const app = { isPackaged: false, getAppPath: () => root,
    getPath: () => path.join(root, 'local-checks/mining-package-verification') }
  const manager = new MiningModuleManager(app, {}, () => {})
  const manifest = await manager.verifyPackage(path.join(root, 'modules/mining'), null, true)
  return { id: manifest.id, version: manifest.version, files: manifest.files.length, integrityVerified: true, signatureRequired: false }
}

if (require.main === module) verifyBundledMining()
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(`Bundled mining verification failed: ${error.message}`); process.exitCode = 1 })

module.exports = { verifyBundledMining }
