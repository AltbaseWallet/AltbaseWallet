'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const tar = require('tar')
const semver = require('semver')
const { manifest, inside, protectedName } = require('./manifest.cjs')
const LIMITS = Object.freeze({ archive: 64 * 1024 * 1024, expanded: 256 * 1024 * 1024, file: 128 * 1024 * 1024, files: 8192, manifest: 512 * 1024, modules: 128 })
const idPattern = /^[a-z][a-z0-9-]{1,63}$/
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
function moduleId(value) {
  if (typeof value !== 'string' || !idPattern.test(value) || reserved.test(value) || ['constructor', 'prototype'].includes(value) || protectedName(value)) throw Error('Invalid package identity')
  return value
}
function resourcePath(value) {
  if (typeof value !== 'string' || value.length > 512 || value.includes('\\') || protectedName(value)) throw Error('Invalid package resource path')
  const normalized = value.replace(/\/$/, ''), parts = normalized.split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.') || p.endsWith('.') || reserved.test(p) || !/^[A-Za-z0-9_.-]+$/.test(p))) throw Error('Unsafe package resource path')
  return normalized
}
function readJson(filename) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.manifest) throw Error('Invalid package metadata file')
  return JSON.parse(fs.readFileSync(filename, 'utf8'))
}
async function sha256(filename) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}
async function extractPackage(archive, destination, expected) {
  const stat = fs.lstatSync(archive)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > LIMITS.archive) throw Error('Invalid module archive size')
  if (!expected || !/^[a-f0-9]{64}$/.test(expected.sha256 || '') || await sha256(archive) !== expected.sha256) throw Error('Module archive integrity check failed')
  moduleId(expected.id)
  if (!semver.valid(expected.version)) throw Error('Invalid module package version')
  let expanded = 0, declared = 0, count = 0
  const entries = new Map()
  const inspect = entry => {
    const name = resourcePath(entry.path)
    if (!['File', 'Directory'].includes(entry.type) || entries.has(name)) throw Error('Unsupported or duplicate archive entry')
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > LIMITS.file) throw Error('Invalid archive entry size')
    if (entry.type === 'Directory' && entry.size !== 0) throw Error('Invalid archive directory')
    declared += entry.size
    if (++count > LIMITS.files || declared > LIMITS.expanded) throw Error('Module archive exceeds the extraction limit')
    for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) {
      if (entries.get(parent) === 'File') throw Error('Archive file conflicts with a directory')
    }
    if (entry.type === 'File' && [...entries.keys()].some(p => p.startsWith(name + '/'))) throw Error('Archive directory conflicts with a file')
    entries.set(name, entry.type)
    entry.resume()
  }
  const bound = new Transform({ transform(chunk, encoding, next) {
    expanded += chunk.length
    next(expanded > LIMITS.expanded ? Error('Expanded module archive is too large') : null, chunk)
  } })
  const parser = tar.t({ strict: true, maxMetaEntrySize: LIMITS.manifest,
    onReadEntry(entry) { try { inspect(entry) } catch (error) { parser.abort(error) } } })
  await pipeline(fs.createReadStream(archive), zlib.createGunzip(), bound, parser)
  if (!entries.has('bundle.json')) throw Error('Module archive has no bundle manifest')
  if (fs.existsSync(destination)) throw Error('Module extraction directory already exists')
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  try {
    // The private staging archive has already been fully inspected. Never
    // extract links or let the unpacker reinterpret a path outside staging.
    await tar.x({ file: archive, cwd: destination, strict: true, preservePaths: false, noMtime: true,
      filter(name, entry) { return entries.get(resourcePath(name)) === entry.type && ['File', 'Directory'].includes(entry.type) } })
    const bundle = readJson(path.join(destination, 'bundle.json'))
    if (bundle.schemaVersion !== 1 || bundle.id !== expected.id || bundle.version !== expected.version || !Array.isArray(bundle.modules) || !bundle.modules.length || bundle.modules.length > LIMITS.modules) throw Error('Module bundle identity does not match the catalog')
    const modules = [], ids = new Set(), directories = new Set()
    for (const item of bundle.modules) {
      const id = moduleId(item?.id), directory = resourcePath(item?.directory)
      if (ids.has(id) || directories.has(directory)) throw Error('Duplicate module in bundle')
      ids.add(id); directories.add(directory)
      const filename = inside(destination, directory + '/manifest.json'), definition = readJson(filename)
      const descriptor = manifest(definition)
      if (descriptor.id !== id || descriptor.version !== expected.version || definition.runtime?.type === 'legacy') throw Error('Invalid bundled module version or runtime')
      if (!['javascript', 'native'].includes(definition.runtime?.type)) throw Error('Unsupported bundled module runtime')
      const entry = definition.runtime.platforms?.[`${process.platform}-${process.arch}`] || definition.runtime.entry
      if (typeof entry !== 'string') throw Error('Module package does not support this platform')
      inside(path.dirname(filename), resourcePath(entry))
      if (definition.runtime.binaryPlatforms) {
        const binary = definition.runtime.binaryPlatforms[`${process.platform}-${process.arch}`]
        if (typeof binary !== 'string') throw Error('Module package has no compiled binary for this platform')
        inside(path.dirname(filename), resourcePath(binary))
      }
      if (definition.icon) inside(path.dirname(filename), resourcePath(definition.icon))
      modules.push({ id, directory, descriptor })
    }
    if (expected.coins && (expected.coins.length !== ids.size || expected.coins.some(id => !ids.has(id)))) throw Error('Bundle coin identities do not match the catalog')
    return { id: bundle.id, version: bundle.version, modules }
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true })
    throw error
  }
}
module.exports = { LIMITS, moduleId, resourcePath, readJson, sha256, extractPackage }
