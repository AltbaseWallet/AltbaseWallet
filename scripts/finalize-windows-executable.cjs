'use strict'
// Brand the unsigned, locally packaged PE on Linux without a Windows compiler.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const ResEdit = require('resedit')
const { requireBinary } = require('./runtime-platform.cjs')
const digest = data => crypto.createHash('sha256').update(Buffer.from(data)).digest('hex')
const untouchedResources = entries => entries.filter(entry => ![3, 14, 16].includes(entry.type))
  .map(({ type, id, lang, bin }) => ({ type, id, lang, sha256: digest(bin) }))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const untouchedSections = exe => exe.getAllSections().filter(section => section.info.name !== '.rsrc')
  .map(section => ({ name: section.info.name, sha256: digest(section.data || new ArrayBuffer(0)) }))

function finalizeWindowsExecutable(root, directory = path.join(root, 'artifacts/win-unpacked')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const file = path.join(directory, `${pkg.productName}.exe`)
  requireBinary(file, 'win32-x64')
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.version.split('.').some(part => Number(part) > 65535)) {
    throw Error('Windows version must have three PE-compatible integers')
  }
  // Refuse a signed input rather than silently invalidating its certificate.
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file))
  const res = ResEdit.NtExecutableResource.from(exe)
  const resourcesBefore = untouchedResources(res.entries), sectionsBefore = untouchedSections(exe)
  const extraBefore = digest(exe.getExtraData() || new ArrayBuffer(0))
  const icons = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, pkg.build.win.icon)))
    .icons.map(item => item.data)
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries)
  assert.ok(icons.length && groups.length && versions.length, 'Windows executable branding resources are required')
  for (const group of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icons)
  for (const version of versions) {
    const languages = version.getAllLanguagesForStringValues()
    if (!languages.length) languages.push({ lang: 1033, codepage: 1200 })
    for (const language of languages) {
      version.setFileVersion(`${pkg.version}.0`, language.lang)
      version.setProductVersion(`${pkg.version}.0`, language.lang)
      version.setStringValues(language, {
        CompanyName: typeof pkg.author === 'string' ? pkg.author : pkg.author.name,
        FileDescription: pkg.description || pkg.productName,
        ProductName: pkg.productName,
        InternalName: `${pkg.productName}.exe`,
        OriginalFilename: `${pkg.productName}.exe`,
        LegalCopyright: `Copyright ${new Date().getUTCFullYear()} ${typeof pkg.author === 'string' ? pkg.author : pkg.author.name}`,
      })
    }
    version.outputToResourceEntries(res.entries)
  }
  res.outputResource(exe)
  const output = Buffer.from(exe.generate())
  const checked = ResEdit.NtExecutable.from(output)
  assert.deepEqual(untouchedResources(ResEdit.NtExecutableResource.from(checked).entries), resourcesBefore,
    'Branding must preserve ASAR integrity and unrelated resources')
  assert.deepEqual(untouchedSections(checked), sectionsBefore, 'Branding must preserve executable code and data')
  assert.equal(digest(checked.getExtraData() || new ArrayBuffer(0)), extraBefore, 'Branding must preserve the overlay')
  const temporary = `${file}.branding-${process.pid}`
  try {
    fs.writeFileSync(temporary, output, { flag: 'wx', mode: fs.statSync(file).mode & 0o777 })
    requireBinary(temporary, 'win32-x64')
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
  return { productName: pkg.productName, version: pkg.version, iconGroups: groups.length,
    preservedResources: resourcesBefore.length, preservedSections: sectionsBefore.length,
    sha256: digest(output) }
}
module.exports = { finalizeWindowsExecutable }
if (require.main === module) console.log(JSON.stringify(finalizeWindowsExecutable(path.resolve(__dirname, '..'))))
