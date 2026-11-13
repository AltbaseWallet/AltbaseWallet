'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { manifest, inside, protectedName, METHODS } = require('./manifest.cjs')
const { PluginClient } = require('./client.cjs')
const suffix = { win32: '.dll', linux: '.so', darwin: '.dylib' }[process.platform]
const fileHash = file => {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
  const fd = fs.openSync(file, 'r')
  try {
    for (let bytes; (bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, bytes))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}
const readManifest = file => {
  if (fs.statSync(file).size > 512 * 1024) throw Error('Module manifest exceeds the limit')
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { throw Error('Invalid module manifest JSON') }
}

class PluginManager {
  constructor({ bundledRoot, installedRoots, managedRoot, bundledFingerprints, hostPath, dataRoot, nodeExecutable = process.execPath, clientOptions = {} }) {
    Object.assign(this, { bundledRoot, installedRoots, managedRoot, bundledFingerprints, hostPath, dataRoot, nodeExecutable, clientOptions })
    this.modules = new Map(); this.diagnostics = []; this.scan = null; this.activeWrites = 0; this.revision = 0
  }
  clientFor(record, probe = false) {
    const dataDirectory = path.join(this.dataRoot, record.descriptor?.id || 'metadata-probe')
    if (!probe) fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
    const env = { ...process.env }
    delete env.ALTBASE_PLUGIN_DATA_DIR
    if (!probe) env.ALTBASE_PLUGIN_DATA_DIR = dataDirectory
    if (record.type === 'javascript') env.ELECTRON_RUN_AS_NODE = '1'
    const options = record.type === 'native'
      ? { executable: this.hostPath, args: [record.entry], cwd: path.dirname(record.entry) }
      // Starting Electron-as-Node can exceed 20 s in the complete Windows app
      // even when the SDK initializes quickly in isolation. Keep a bounded
      // platform startup budget, separate from each operation's RPC deadline.
      : { executable: this.nodeExecutable, args: [path.join(__dirname, 'js-worker.cjs'), record.entry, record.source], cwd: path.dirname(record.entry), startupTimeout: process.platform === 'win32' ? 60000 : 20000 }
    return new PluginClient({ ...options, env, ...this.clientOptions })
  }
  async inspect(source, bundled) {
    if (protectedName(source)) throw Error('Protected source is not a module')
    const stat = fs.lstatSync(source)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Module must be a regular file')
    const isNative = source.endsWith(suffix)
    const definition = isNative ? null : readManifest(source)
    let type = isNative ? 'native' : definition.runtime?.type
    let entry = source
    if (type === 'legacy' && !bundled) throw Error('Compatibility descriptors belong in the bundled catalog')
    if (!['native', 'javascript', 'legacy'].includes(type)) throw Error('Unsupported module runtime')
    if (!isNative && type !== 'legacy') {
      const target = `${process.platform}-${process.arch}`
      const runtimeEntry = definition.runtime?.platforms?.[target] || definition.runtime?.entry
      if (!runtimeEntry) throw Error(`Module has no runtime for ${target}`)
      entry = inside(path.dirname(source), runtimeEntry)
      if (type === 'native' && !entry.endsWith(suffix)) throw Error('Module binary is for another platform')
      if (type === 'javascript' && !entry.endsWith('.cjs')) throw Error('JavaScript module entry must be .cjs')
    }
    const iconFile = definition?.icon ? inside(path.dirname(source), definition.icon) : null
    const iconMime = iconFile && { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(iconFile)]
    if (iconFile && (!iconMime || fs.statSync(iconFile).size > 8 * 1024 * 1024)) throw Error('Unsupported module icon')
    const platformBinary = definition?.runtime?.binaryPlatforms?.[`${process.platform}-${process.arch}`]
    if (definition?.runtime?.binaryPlatforms && !platformBinary) throw Error('Module has no compiled binary for this platform')
    const binaries = [...new Set([...(definition?.nativeRuntime?.binaries || []), ...(platformBinary ? [platformBinary] : [])])].map(filename => inside(path.dirname(source), filename))
    const fingerprint = fileHash(source) + (entry === source ? '' : fileHash(entry)) + (iconFile ? fileHash(iconFile) : '') + binaries.map(fileHash).join('')
    const previous = [...this.modules.values()].find(r => r.source === source && r.fingerprint === fingerprint)
    if (previous && type !== 'javascript') return previous
    const factory = bundled && (!this.bundledFingerprints || this.bundledFingerprints[path.relative(this.bundledRoot, source).replaceAll(path.sep, '/')] === fingerprint)
    const record = { type, entry, source, fingerprint, client: null, bundled: factory }
    let metadata = definition
    if (type === 'native') {
      const probe = this.clientFor(record, true)
      try { metadata = await probe.start() } finally { probe.close() }
      if (definition && (metadata.id !== definition.id || metadata.version !== definition.version)) throw Error('Embedded and package manifests disagree')
    }
    record.descriptor = manifest(metadata, { legacy: type === 'legacy' })
    if (definition?.icon) {
      const icon = iconFile
      record.icon = { file: icon, mime: iconMime }
      record.descriptor.coin.iconUrl = `altbase-coin://icons/${record.descriptor.id}?v=${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)}`
    }
    return record
  }
  async discover() {
    if (this.scan) return this.scan
    if (this.activeWrites) throw Error('Wait for the current module transaction before refreshing modules')
    this.scan = (async () => {
      const next = new Map(), collisions = new Set(), diagnostics = []
      const previousRevision = this.revision
      for (const root of [this.bundledRoot, ...this.installedRoots]) {
        if (!root || !fs.existsSync(root)) continue
        let items
        try { items = fs.readdirSync(root, { withFileTypes: true }) }
        catch { diagnostics.push({ file: path.basename(root), error: 'Module directory is not readable' }); continue }
        for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
          if (item.isSymbolicLink() || protectedName(item.name)) continue
          const location = path.join(root, item.name)
          const source = item.isDirectory() ? path.join(location, 'manifest.json') : location
          if (item.isDirectory() ? !fs.existsSync(source) : !item.name.endsWith(suffix)) continue
          try {
            const record = await this.inspect(source, root === this.bundledRoot)
            const id = record.descriptor.id
            if (next.has(id) || collisions.has(id)) {
              next.delete(id); collisions.add(id)
              diagnostics.push({ file: item.name, error: `Duplicate module ID: ${id}; remove the duplicate and refresh` })
            } else next.set(id, record)
          } catch (error) {
            // No plugin stderr/response text is retained by PluginClient.
            diagnostics.push({ file: item.name, error: error.message })
          }
        }
      }
      if (this.managedRoot) {
        try {
          for (const source of require('./updater.cjs').managedSources(this.managedRoot)) {
            const record = await this.inspect(source, false), id = record.descriptor.id, previous = next.get(id)
            record.managed = true
            // Updating the application may bring a newer bundled module than
            // the last downloaded catalog. Keep the newer code and its data;
            // the old managed package must not disable the coin as a conflict.
            if (!collisions.has(id) && previous?.bundled && previous.type !== 'legacy'
              && require('semver').lt(record.descriptor.version, previous.descriptor.version)) continue
            if (collisions.has(id) || (previous && (!previous.bundled || previous.type === 'legacy' || !require('semver').gte(record.descriptor.version, previous.descriptor.version)))) {
              next.delete(id); collisions.add(id); diagnostics.push({ file: id, error: 'Managed module conflicts with an installed module' })
            } else next.set(id, record)
          }
        } catch { diagnostics.push({ file: 'managed-modules', error: 'Managed module activation state is unavailable' }) }
      }
      if (previousRevision !== this.revision) throw Error('Wallet session changed while refreshing modules')
      for (const [id, old] of this.modules) if (next.get(id) !== old) old.client?.close()
      this.modules = next; this.diagnostics = diagnostics
      return this.catalog()
    })().finally(() => { this.scan = null })
    return this.scan
  }
  catalog() {
    return { modules: [...this.modules.values()].map(r => r.descriptor), diagnostics: [...this.diagnostics], directory: this.installedRoots[0] || this.bundledRoot }
  }
  icon(id) { return this.modules.get(id)?.icon || null }
  runtimeAsset(id, name) {
    const record = this.modules.get(id)
    if (!record || !/^[a-z0-9_-]+\.wasm$/.test(name)) return null
    try {
      const definition = readManifest(record.source)
      return definition.nativeRuntime?.wasm === name ? inside(path.dirname(record.source), name) : null
    } catch { return null }
  }
  tokenIcon(id, key) {
    if (!this.modules.get(id)?.descriptor.capabilities.includes('assets') || !/^[a-f0-9]{64}$/.test(key || '')) return null
    try {
      const directory = path.join(this.dataRoot, id, 'token-icons'), file = path.join(directory, key + '.png')
      if (fs.lstatSync(directory).isSymbolicLink()) return null
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 || !fs.realpathSync(file).startsWith(fs.realpathSync(this.dataRoot) + path.sep)) return null
      return { file, mime: 'image/png' }
    } catch { return null }
  }
  async request(id, method, params = {}) {
    const revision = this.revision
    if (this.scan) await this.scan
    if (revision !== this.revision) throw Error('Wallet session changed')
    const record = this.modules.get(id)
    if (!record || record.type === 'legacy') throw Error('Dynamic coin module is not installed')
    if (!METHODS.has(method) || !record.descriptor.capabilities.includes(method)) throw Error('Operation is not supported by this coin module')
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('Invalid module request parameters')
    if (method === 'nodeRequest') {
      const route = String(params.path || '').split('?')[0]
      const reads = ['/network', '/address/balance', '/address/utxos', '/address/history', '/address/mempool', '/address/validate', '/fee/estimate', '/tx/raw', '/account/tx-context', '/privacy/scan-info', '/privacy/scan-chunk']
      if (!reads.includes(route) || !['GET', 'POST'].includes(params.method)) throw Error('Only read operations are allowed through the module node transport')
    }
    const write = ['send', 'export', 'derive', 'prepareTransfer', 'importAsset', 'setAssetVisibility'].includes(method)
    if (write) this.activeWrites++
    try {
      if (!record.client || record.client.closed) record.client = this.clientFor(record)
      const client = record.client
      const advertised = await client.start()
      if (revision !== this.revision || client !== record.client) throw Error('Wallet session changed')
      if (advertised.id !== id || advertised.abiVersion !== 1 || advertised.version !== record.descriptor.version) {
        client.close(); throw Error('Module changed; refresh the module catalog')
      }
      const result = await client.request(method, params)
      if (revision !== this.revision) throw Error('Wallet session changed')
      return result
    } finally { if (write) this.activeWrites-- }
  }
  closeSessions() {
    this.revision++
    for (const record of this.modules.values()) { record.client?.close(); record.client = null }
  }
}
module.exports = { PluginManager }
