'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), https = require('node:https'), http = require('node:http')
const semver = require('semver')
const { verifyCatalog, downloadUrl } = require('./catalog.cjs')
const { LIMITS, extractPackage, moduleId, resourcePath, readJson } = require('./package-format.cjs')
async function download(url, limit, options = {}) {
  const target = downloadUrl(url, options)
  const deadline = options.deadline || Date.now() + (options.timeoutMs || 60000)
  if (Date.now() >= deadline || (options.redirects || 0) > 4) throw Error('Module download deadline or redirect limit reached')
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, timer
    const request = (target.startsWith('https:') ? https : http).get(target,
      { headers: { 'User-Agent': 'AltbaseWallet/0.1.11', 'Accept-Encoding': 'identity' }, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000 }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume()
          try { resolve(download(new URL(response.headers.location, target).href, limit, { ...options, deadline, redirects: (options.redirects || 0) + 1 })) }
          catch { reject(Error('Invalid module redirect')) }
          return
        }
        if (response.statusCode !== 200 || Number(response.headers['content-length']) > limit) {
          response.destroy(); reject(Error('Module server returned an unavailable or oversized resource')); return
        }
        response.on('data', chunk => {
          size += chunk.length
          if (size > limit) { response.destroy(); reject(Error('Module download exceeds the limit')); return }
          chunks.push(chunk)
        })
        response.on('end', () => resolve(Buffer.concat(chunks)))
        response.on('error', () => reject(Error('Module download interrupted')))
      })
    timer = setTimeout(() => request.destroy(Error('Module download timed out')), Math.max(1, deadline - Date.now()))
    request.on('error', () => reject(Error('Module download failed')))
    request.on('close', () => clearTimeout(timer))
  })
}
function readActive(root) {
  const filename = path.join(root, 'active.json')
  if (!fs.existsSync(filename)) return { schemaVersion: 1, issuedAt: '', packages: {} }
  const state = readJson(filename)
  if (state.schemaVersion !== 1 || !state.packages || Array.isArray(state.packages)) throw Error('Invalid managed module activation state')
  for (const [id, entry] of Object.entries(state.packages)) {
    moduleId(id); resourcePath(entry.directory)
    if (!semver.valid(entry.version) || !Array.isArray(entry.coins) || !Array.isArray(entry.modules)) throw Error('Invalid managed package')
    entry.coins.forEach(moduleId)
    for (const module of entry.modules) { moduleId(module.id); resourcePath(module.directory) }
  }
  return state
}
function managedSources(root) {
  if (!root) return []
  const active = readActive(root), sources = []
  for (const entry of Object.values(active.packages)) for (const module of entry.modules) {
    const filename = path.join(root, entry.directory, module.directory, 'manifest.json')
    const real = fs.realpathSync(filename)
    if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw Error('Managed module escapes its storage')
    sources.push(filename)
  }
  return sources
}
function writeActive(root, value) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const tmp = path.join(root, 'active-' + crypto.randomBytes(10).toString('hex') + '.tmp')
  try { fs.writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, path.join(root, 'active.json')) }
  finally { fs.rmSync(tmp, { force: true }) }
}
class ModuleUpdater {
  constructor({ manager, root, config, walletVersion, fetchBytes = download, allowLocalHttp = false }) {
    Object.assign(this, { manager, root, config, walletVersion, fetchBytes, allowLocalHttp })
    this.running = null; this.status = { configured: Boolean(config?.url && config?.publicKey), changed: false, lastChecked: null, error: null }
  }
  check() {
    if (this.running) return this.running
    this.running = this.perform().catch(() => {
      this.status = { ...this.status, changed: false, error: 'Module update could not be verified or installed. Existing modules were retained.' }
      return this.status
    }).finally(() => { this.running = null })
    return this.running
  }
  async perform() {
    return require('./module-directory.cjs').withModuleDirectoryLock(path.dirname(this.root), () => this.performLocked())
  }
  async performLocked() {
    this.status = { ...this.status, changed: false, lastChecked: new Date().toISOString(), error: null }
    if (!this.status.configured) return this.status
    const options = { allowLocalHttp: this.allowLocalHttp }
    const bytes = await this.fetchBytes(this.config.url, 2 * LIMITS.manifest, options)
    const catalog = verifyCatalog(JSON.parse(bytes.toString('utf8')), this.config.publicKey, options)
    const previous = readActive(this.root)
    if (previous.issuedAt && Date.parse(catalog.issuedAt) < Date.parse(previous.issuedAt)) throw Error('Catalog rollback rejected')
    const created = []
    try {
    const next = structuredClone(previous), replacements = []
    next.issuedAt = catalog.issuedAt
    for (const item of catalog.modules) {
      if (!item.enabled || (item.minimumWalletVersion && semver.gt(item.minimumWalletVersion, this.walletVersion))) continue
      const installed = previous.packages[item.id], live = this.manager.catalog().modules
      if (installed && !semver.gt(item.version, installed.version)) continue
      if (!installed && item.coins.every(id => live.some(m => m.id === id && semver.gte(m.version, item.version)))) continue
      // A catalog entry cannot replace an existing unrelated/manual module or
      // a legacy compatibility engine with arbitrary executable code.
      for (const id of item.coins) {
        const record = this.manager.modules.get(id)
        if (record && (record.type === 'legacy' || (!record.managed && !record.bundled))) throw Error('Module identity belongs to a manual installation')
        if (record && semver.gt(record.descriptor.version, item.version)) throw Error('Coin version rollback rejected')
        for (const [otherId, other] of Object.entries(previous.packages)) if (otherId !== item.id && other.coins.includes(id)) throw Error('Module identity belongs to another package')
      }
      const target = item.packages[`${process.platform}-${process.arch}`] || item.packages.any
      if (!target) continue
      const stageRoot = path.join(this.root, 'staging-' + crypto.randomBytes(10).toString('hex'))
      fs.mkdirSync(stageRoot, { recursive: true, mode: 0o700 })
      try {
        const data = await this.fetchBytes(target.url, LIMITS.archive, options)
        if (target.size !== undefined && data.length !== target.size) throw Error('Module download size mismatch')
        const archive = path.join(stageRoot, 'package.tar.gz'), directory = path.join(stageRoot, 'package')
        fs.writeFileSync(archive, data, { flag: 'wx', mode: 0o600 })
        const bundle = await extractPackage(archive, directory, { ...item, ...target })
        for (const module of bundle.modules) {
          const record = await this.manager.inspect(path.join(directory, module.directory, 'manifest.json'), false)
          // Load the JS factory and its dependencies before activation as well.
          const probe = this.manager.clientFor(record, true)
          try {
            // A fresh, disposable data directory prevents the probe touching a
            // user's scan state. No derive/sign/send operation is invoked.
            probe.options.env.ALTBASE_PLUGIN_DATA_DIR = path.join(stageRoot, 'probe', module.id)
            const metadata = await probe.start()
            if (metadata.id !== module.id || metadata.version !== item.version) throw Error('Module startup identity mismatch')
          } finally { probe.close() }
        }
        const destination = 'package-' + item.id + '-' + item.version + '-' + crypto.randomBytes(6).toString('hex')
        fs.renameSync(directory, path.join(this.root, destination))
        created.push(destination)
        next.packages[item.id] = { version: item.version, directory: destination, coins: item.coins,
          modules: bundle.modules.map(m => ({ id: m.id, directory: m.directory })) }
        replacements.push(item.id)
      } finally { fs.rmSync(stageRoot, { recursive: true, force: true }) }
    }
    if (this.manager.activeWrites || this.manager.scan) { this.status.error = 'Module activation deferred until the current wallet operation finishes.'; return this.status }
    if (replacements.length) {
      writeActive(this.root, next)
      try {
        const loaded = await this.manager.discover()
        for (const id of replacements) for (const coin of next.packages[id].coins) {
          if (!loaded.modules.some(m => m.id === coin && m.version === next.packages[id].version)) throw Error('Module activation failed')
        }
      } catch (error) { writeActive(this.root, previous); await this.manager.discover(); throw error }
      this.status.changed = true
    } else if (next.issuedAt !== previous.issuedAt) writeActive(this.root, next)
    return this.status
    } finally {
      const activated = new Set(Object.values(readActive(this.root).packages).map(item => item.directory))
      for (const directory of created) if (!activated.has(directory)) fs.rmSync(path.join(this.root, directory), { recursive: true, force: true })
    }
  }
}
module.exports = { ModuleUpdater, download, managedSources, readActive, writeActive }
