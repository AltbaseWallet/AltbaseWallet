'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const asar = require('@electron/asar')
const ResEdit = require('resedit')
const { requireBinary } = require('./runtime-platform.cjs')
const root = path.resolve(__dirname, '..'), appRoot = process.env.ALTBASE_QA_WINDOWS_DIRECTORY || path.join(root, 'artifacts/win-unpacked')
const records = []
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    assert.ok(!entry.isSymbolicLink(), 'Packaged runtime must not escape by symlink')
    assert.ok(!/wallet[ _-]?secret/i.test(entry.name), 'Protected source must not be packaged')
    if (entry.isDirectory()) walk(file)
    else if (/\.(exe|dll|node)$/i.test(entry.name)) {
      requireBinary(file, 'win32-x64')
      records.push({ path: path.relative(appRoot, file), sha256: digest(file) })
    }
  }
}
walk(appRoot)
const pkg = require('../package.json')
const exe = ResEdit.NtExecutable.from(fs.readFileSync(path.join(appRoot, `${pkg.productName}.exe`)))
const resources = ResEdit.NtExecutableResource.from(exe)
const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
assert.ok(versions.length, 'Windows executable version information is required')
for (const version of versions) {
  const languages = version.getAllLanguagesForStringValues()
  assert.ok(languages.length)
  for (const language of languages) {
    const strings = version.getStringValues(language)
    assert.equal(strings.ProductName, pkg.productName)
    assert.equal(strings.FileDescription, pkg.description)
    assert.equal(strings.FileVersion, `${pkg.version}.0`)
    assert.equal(strings.ProductVersion, `${pkg.version}.0`)
    assert.equal(strings.OriginalFilename, `${pkg.productName}.exe`)
  }
}
const iconBytes = icon => Buffer.from(icon.isRaw() ? icon.bin : icon.generate())
const expectedIcons = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, pkg.build.win.icon)))
  .icons.map(item => iconBytes(item.data))
const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
assert.ok(iconGroups.length)
for (const group of iconGroups) {
  assert.deepEqual(group.getIconItemsFromEntries(resources.entries).map(iconBytes), expectedIcons)
}
const files = asar.listPackage(path.join(appRoot, 'resources/app.asar'))
assert.ok(files.includes('/node_modules/secp256k1/prebuilds/win32-x64/secp256k1.node'))
assert.ok(!files.some(file => /^\/node_modules\/secp256k1\/(build\/|prebuilds\/(linux|darwin))/.test(file)))
assert.ok(!files.some(file => /wallet[ _-]?secret/i.test(file)))
const source = require('../docs/windows-runtime-source.json')
let matchedResources = 0
const staged = require('../local-checks/coin-binaries/win32-x64.json')
const vaultBuild = require('../local-checks/vault-builds/win32-x64.json')
for (const entry of source.selectedRuntimeFiles) {
  const runtime = entry.path.match(/^coin-runtimes-stage\/win32-x64\/(.+)$/)?.[1]
  const installed = staged.receipts.find(item => runtime ? item.path.replaceAll('\\', '/') === runtime : path.basename(item.path) === path.basename(entry.path))
  const relative = installed ? 'resources/coin-plugins/' + installed.path : entry.path
  if (!relative.startsWith('resources/')) continue
  const file = path.join(appRoot, relative)
  const sourceBuilt = vaultBuild.binaries.find(binary => binary.name === path.basename(entry.path))
  if (sourceBuilt) assert.equal(vaultBuild.builtFromProjectSource, true)
  assert.equal(fs.statSync(file).size, sourceBuilt?.size ?? entry.size)
  assert.equal(digest(file), sourceBuilt?.sha256 ?? entry.sha256)
  matchedResources++
}
const coreHash = ['Altbase Wallet.exe', 'resources/app.asar', 'resources/native-plugin-host/bin/win32-x64/altbase_plugin_host.exe']
  .map(file => ({ file, sha256: digest(path.join(appRoot, file)) }))
const result = { at: new Date().toISOString(), passed: true, platform: 'win32-x64',
  verifiedPeBinaries: records.length, matchedReleasedRuntimeResources: matchedResources,
  windowsSecpPrebuildPresent: true, linuxAddonExcluded: true, protectedSourceNames: 0, coreHash, binaries: records }
result.executableBranding = { productName: pkg.productName, version: pkg.version, iconGroups: iconGroups.length }
fs.writeFileSync(path.join(root, 'local-checks/windows-package-check.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ ...result, binaries: undefined }))
