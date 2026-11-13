'use strict'
// Read compiled PE version resources only; source files are not inputs.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const ResEdit = require('resedit')
function fileVersions(directory) {
  const result = {}
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'Installer input may not be a symlink')
      assert.ok(!/wallet[ _-]?secret/i.test(entry.name), 'Protected source may not be an installer input')
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      if (!entry.isFile() || !/\.(exe|dll|node)$/i.test(entry.name)) continue
      const bytes = fs.readFileSync(file)
      // resedit rejects COFF debug symbols. They cannot affect .rsrc, so hide
      // their directory in this disposable parsing buffer. Never write it back.
      const pe = bytes.readUInt32LE(0x3c)
      assert.equal(bytes.readUInt32LE(pe), 0x4550, 'Invalid PE input')
      bytes.writeUInt32LE(0, pe + 12)
      bytes.writeUInt32LE(0, pe + 16)
      const executable = ResEdit.NtExecutable.from(bytes, { ignoreCert: true })
      const resources = ResEdit.Resource.VersionInfo.fromEntries(ResEdit.NtExecutableResource.from(executable).entries)
      if (!resources.length) continue
      const versions = new Set(resources.map(({ fixedInfo: v }) =>
        [v.fileVersionMS >>> 16, v.fileVersionMS & 0xffff, v.fileVersionLS >>> 16, v.fileVersionLS & 0xffff].join('.')))
      assert.equal(versions.size, 1, 'PE version resources must agree')
      const languages = [...new Set(resources.flatMap(v => v.getAllLanguagesForStringValues().map(v => v.lang)))].sort((a, b) => a - b)
      result[path.relative(directory, file).split(path.sep).join('/')] = { version: [...versions][0], language: languages.join(',') }
    }
  }
  walk(path.resolve(directory))
  return result
}
module.exports = { fileVersions }
if (require.main === module) console.log(JSON.stringify(fileVersions(path.resolve(process.argv[2]))))
