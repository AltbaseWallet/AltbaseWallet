const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  MINING_MODULE_REPOSITORY,
  miningModuleArchiveAssetName,
  miningModuleManifestAssetName,
} = require('../electron/mining-module-trust.cjs')

const root = path.resolve(__dirname, '..')
const moduleRoot = path.join(root, 'modules', 'mining')
const outputRoot = path.join(root, 'release', 'mining-module')
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

run(process.execPath, [path.join(root, 'scripts', 'sync-mining-frontend.cjs')])
run(process.execPath, [path.join(root, 'scripts', 'build-mining-module.cjs'), '--require-signature', '--sign-now'])

const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.manifest.json'), 'utf8'))
if (!manifest.signature || manifest.schemaVersion !== 2) throw new Error('Mining module release manifest is not signed')
const descriptor = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'module.json'), 'utf8'))
const requiredPlatforms = ['windows-x64', 'linux-x64', 'macos-x64', 'macos-arm64']
if (descriptor.updates?.repository !== MINING_MODULE_REPOSITORY
  || requiredPlatforms.some((platform) => !descriptor.platforms?.includes(platform))) {
  throw new Error('Mining module release descriptor does not cover the trusted repository and all supported desktop platforms')
}
const archiveName = miningModuleArchiveAssetName(manifest.version)
const manifestName = miningModuleManifestAssetName(manifest.version)
const archivePath = path.join(outputRoot, archiveName)
const manifestPath = path.join(outputRoot, manifestName)
const platformArchiveNames = requiredPlatforms.map((platform) => `altbase-mining-module-${manifest.version}-${platform}.tar.gz`)

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })
fs.copyFileSync(path.join(moduleRoot, 'package.manifest.json'), manifestPath)

const archiveFiles = [...manifest.files.map((file) => file.path), 'package.manifest.json']
run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', archivePath, '-C', moduleRoot, ...archiveFiles])

const archive = fs.statSync(archivePath)
if (!archive.isFile() || archive.size < 1) throw new Error('Mining module release archive was not created')
for (const platformArchiveName of platformArchiveNames) {
  fs.copyFileSync(archivePath, path.join(outputRoot, platformArchiveName))
}
console.log(`Mining module GitHub Release assets created:
  ${manifestPath}
  ${archivePath}
${platformArchiveNames.map((name) => `  ${path.join(outputRoot, name)}`).join('\n')}

Create release tag v${manifest.version} in ${MINING_MODULE_REPOSITORY} and upload these files.`)
