'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { inside, protectedName } = require('./manifest.cjs')
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function exists(file) { try { fs.lstatSync(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
function folderHash(root, { ignoreBridgeLinks = path.basename(root) === '_core' } = {}) {
  const records = []
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), relative = path.relative(root, file)
      // This runtime-only bridge link is regenerated from the Monero module
      // on every native launch. It is not a user edit to the shared package.
      if (ignoreBridgeLinks && relative === entry.name && /^altbase_monero_wallet\.(?:so|dll|dylib)$/.test(entry.name)) continue
      if (protectedName(relative) || entry.isSymbolicLink()) throw Error('Invalid module package resource')
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile()) records.push(relative.replaceAll(path.sep, '/') + ':' + sha(file))
      else throw Error('Unsupported module package resource')
    }
  }
  walk(root)
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex')
}

// The shipped tree is only an installation source. Every live module, including
// defaults and user additions, is loaded from this one writable directory.
function populate(source, directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Module directory must not be a symbolic link')
  const stateFile = path.join(directory, '.bundled-state.json')
  let previous = {}
  try {
    const metadata = fs.lstatSync(stateFile)
    if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.size < 1024 * 1024) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      if (state?.schemaVersion === 1 && state.modules && !Array.isArray(state.modules)) previous = state.modules
    }
  } catch { /* Unrecognized state never authorizes overwriting existing files. */ }
  const next = { ...previous }, fingerprints = {}, staging = path.join(directory, '.stock-staging')
  for (const item of fs.readdirSync(source, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!item.isDirectory() || item.isSymbolicLink() || protectedName(item.name)) continue
    const original = path.join(source, item.name), shared = item.name === '_core'
    const manifestFile = path.join(original, shared ? 'runtime-package.json' : 'manifest.json')
    if (!exists(manifestFile)) continue
    if (!fs.lstatSync(manifestFile).isFile() || fs.lstatSync(manifestFile).isSymbolicLink()) throw Error('Invalid bundled module manifest')
    const definition = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    const runtime = shared || definition.runtime?.type === 'legacy' ? manifestFile : inside(original,
      definition.runtime?.platforms?.[`${process.platform}-${process.arch}`] || definition.runtime?.entry)
    const icon = definition.icon ? inside(original, definition.icon) : null
    const platformBinary = definition.runtime?.binaryPlatforms?.[`${process.platform}-${process.arch}`]
    const binaries = [...new Set([...(definition.nativeRuntime?.binaries || []), ...(platformBinary ? [platformBinary] : [])])].map(filename => inside(original, filename))
    if (!shared) fingerprints[item.name + '/manifest.json'] = sha(manifestFile) + (runtime === manifestFile ? '' : sha(runtime)) + (icon ? sha(icon) : '') + binaries.map(sha).join('')
    const expected = folderHash(original), destination = path.join(directory, item.name), present = exists(destination)
    let pristine = false
    if (present && fs.lstatSync(destination).isDirectory() && !fs.lstatSync(destination).isSymbolicLink()) {
      try { pristine = folderHash(destination) === previous[item.name]?.hash } catch { /* Preserve edited/custom files. */ }
    }
    if ((!present && !previous[item.name]) || (pristine && previous[item.name].hash !== expected)) {
      fs.mkdirSync(staging, { recursive: true, mode: 0o700 })
      const token = crypto.randomUUID(), temporary = path.join(staging, token), backup = path.join(staging, token + '-previous')
      try {
        fs.cpSync(original, temporary, { recursive: true, errorOnExist: true, force: false })
        if (folderHash(temporary, { ignoreBridgeLinks: shared }) !== expected) throw Error('Module changed during installation: ' + item.name)
        if (present) fs.renameSync(destination, backup)
        try { fs.renameSync(temporary, destination) }
        catch (error) { if (exists(backup)) fs.renameSync(backup, destination); throw error }
        next[item.name] = { hash: expected, version: definition.version }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true }); fs.rmSync(backup, { recursive: true, force: true })
      }
    }
    // Missing previously installed defaults stay removed; custom edits stay put.
  }
  const temporaryState = path.join(directory, '.bundled-state-' + crypto.randomUUID() + '.tmp')
  try {
    fs.writeFileSync(temporaryState, JSON.stringify({ schemaVersion: 1, modules: next }), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporaryState, stateFile)
  } finally { fs.rmSync(temporaryState, { force: true }) }
  return { directory, fingerprints }
}
async function withModuleDirectoryLock(directory, operation) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, '.module-setup.lock'), deadline = Date.now() + 30000
  let acquired = false
  while (!acquired) {
    try {
      const fd = fs.openSync(lock, 'wx', 0o600)
      try { fs.writeFileSync(fd, String(process.pid)) } finally { fs.closeSync(fd) }
      acquired = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const pid = Number(fs.readFileSync(lock, 'utf8'))
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) } catch (check) { if (check.code === 'ESRCH') { fs.unlinkSync(lock); continue } }
        } else if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.unlinkSync(lock); continue }
      } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError }
      if (Date.now() >= deadline) throw Error('Another wallet is updating the common module directory. Try again shortly.', { cause: error })
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  try { return await operation() }
  finally { fs.unlinkSync(lock) }
}
async function prepareModuleDirectory(source, directory, afterPopulate) {
  return withModuleDirectoryLock(directory, async () => {
    const prepared = populate(source, directory)
    if (afterPopulate) await afterPopulate()
    return prepared
  })
}
module.exports = { prepareModuleDirectory, withModuleDirectoryLock }
