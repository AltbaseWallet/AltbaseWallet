const MINING_MODULE_ID = 'mining'
const MINING_MODULE_API_VERSION = '1.0.0'
const MINING_MODULE_KEY_ID = 'altbase-mining-406c067310831fba'
const MINING_MODULE_REPOSITORY = 'AltbaseWallet/module-mining'
const MINING_MODULE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAonw/LS57OPiiUn5AtD6/PgpJfhAhQK2wgM+HBYJmwpc=
-----END PUBLIC KEY-----
`

const miningModuleManifestAssetName = (version) => `altbase-mining-module-${version}.manifest.json`
const miningModuleArchiveAssetName = (version) => `altbase-mining-module-${version}.tar.gz`

module.exports = {
  MINING_MODULE_ID,
  MINING_MODULE_API_VERSION,
  MINING_MODULE_KEY_ID,
  MINING_MODULE_PUBLIC_KEY,
  MINING_MODULE_REPOSITORY,
  miningModuleManifestAssetName,
  miningModuleArchiveAssetName,
}
