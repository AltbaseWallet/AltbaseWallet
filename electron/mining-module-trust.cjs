const MINING_MODULE_ID = 'mining'
const MINING_MODULE_API_VERSION = '1.0.0'
const MINING_MODULE_REPOSITORY = 'AltbaseWallet/module-mining'

const miningModuleManifestAssetName = (version) => `altbase-mining-module-${version}.manifest.json`
const miningModuleArchiveAssetName = (version) => `altbase-mining-module-${version}.tar.gz`

module.exports = {
  MINING_MODULE_ID,
  MINING_MODULE_API_VERSION,
  MINING_MODULE_REPOSITORY,
  miningModuleManifestAssetName,
  miningModuleArchiveAssetName,
}
