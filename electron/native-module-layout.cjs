'use strict'
const fs = require('node:fs'), path = require('node:path')
function nativeModuleLayout(directory) {
  const root = fs.realpathSync(directory), shared = path.join(root, '_core')
  const metadata = JSON.parse(fs.readFileSync(path.join(shared, 'runtime-package.json'), 'utf8'))
  const executable = 'altbase_core_bridge' + (process.platform === 'win32' ? '.exe' : '')
  if (metadata.schemaVersion !== 1 || metadata.target !== `${process.platform}-${process.arch}`
    || metadata.bridge !== executable || !Array.isArray(metadata.libraryDirectories)) throw Error('Native module installation does not match this platform')
  const folders = [shared, ...metadata.libraryDirectories.map(id => {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(id) || /wallet[ _-]?secret/i.test(id)) throw Error('Invalid native module directory')
    return path.join(root, id)
  })]
  for (const folder of folders) {
    if (fs.lstatSync(folder).isSymbolicLink() || !fs.statSync(folder).isDirectory() || !fs.realpathSync(folder).startsWith(root + path.sep)) throw Error('Native module directory escapes the common installation')
  }
  const exe = path.join(shared, executable)
  if (!fs.statSync(exe).isFile() || fs.lstatSync(exe).isSymbolicLink()) throw Error('Native module bridge is missing')
  // The released bridge opens Monero explicitly beside its executable. Link
  // that ABI dependency to the real module file, rather than retaining a
  // second private executable copy. Windows uses a same-volume hard link.
  for (const entry of metadata.adjacentLibraries || []) {
    const suffix = { linux: '.so', win32: '.dll', darwin: '.dylib' }[process.platform]
    if (entry.module !== 'monero' || entry.file !== 'altbase_monero_wallet' + suffix) throw Error('Unsupported adjacent native dependency')
    const source = path.join(root, entry.module, entry.file), link = path.join(shared, entry.file)
    const stat = fs.lstatSync(source)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Monero module binary is unavailable')
    let matches = false
    try {
      const installed = fs.statSync(link)
      matches = process.platform === 'win32' ? installed.dev === stat.dev && installed.ino === stat.ino : fs.realpathSync(link) === fs.realpathSync(source)
    } catch { /* First installation or broken old link. */ }
    if (!matches) {
      const temporary = link + '.' + process.pid + '.tmp'
      try {
        if (process.platform === 'win32') fs.linkSync(source, temporary)
        else fs.symlinkSync(path.relative(shared, source), temporary)
        fs.renameSync(temporary, link)
      } finally { fs.rmSync(temporary, { force: true }) }
    }
  }
  return { executable: exe, directories: folders }
}
module.exports = { nativeModuleLayout }
