'use strict'
const crypto = require('node:crypto')
const semver = require('semver')
const { LIMITS, moduleId } = require('./package-format.cjs')
const targets = new Set(['any', 'linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'])
function downloadUrl(value, { allowLocalHttp = false } = {}) {
  if (typeof value !== 'string' || value.length > 4096) throw Error('Invalid module download URL')
  const url = new URL(value)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) throw Error('Module downloads require HTTPS')
  return url.href
}
function normalizeCatalog(input, options = {}) {
  if (!input || input.schemaVersion !== 1 || !['altbase-wallet', 'altbase-fullnode'].includes(input.application) || !Array.isArray(input.modules) || input.modules.length > LIMITS.modules) throw Error('Unsupported module catalog')
  const now = options.now ?? Date.now(), issued = Date.parse(input.issuedAt), expires = Date.parse(input.expiresAt)
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 300000 || expires <= now || expires <= issued || expires - issued > 7 * 86400000) throw Error('Module catalog has expired or has invalid dates')
  const ids = new Set(), coins = new Set()
  const modules = input.modules.map(item => {
    const id = moduleId(item?.id)
    if (ids.has(id) || !semver.valid(item.version) || !Array.isArray(item.coins) || !item.coins.length || item.coins.length > 32) throw Error('Invalid module catalog entry')
    ids.add(id)
    const ownCoins = item.coins.map(moduleId)
    for (const coin of ownCoins) { if (coins.has(coin)) throw Error('Duplicate coin in module catalog'); coins.add(coin) }
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 96) throw Error('Invalid module package name')
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw Error('Invalid module enable flag')
    if (item.minimumWalletVersion !== undefined && !semver.valid(item.minimumWalletVersion)) throw Error('Invalid wallet compatibility version')
    if (!item.packages || typeof item.packages !== 'object' || Array.isArray(item.packages)) throw Error('Missing module packages')
    const packages = {}
    for (const [target, value] of Object.entries(item.packages)) {
      if (!targets.has(target) || !value || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) throw Error('Invalid module package digest or platform')
      if (value.size !== undefined && (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > LIMITS.archive)) throw Error('Invalid module archive size')
      packages[target] = { url: downloadUrl(value.url, options), sha256: value.sha256, ...(value.size === undefined ? {} : { size: value.size }) }
    }
    if (!Object.keys(packages).length) throw Error('Module has no supported package')
    return { id, name: item.name, version: item.version, coins: ownCoins, enabled: item.enabled !== false,
      minimumWalletVersion: item.minimumWalletVersion, packages }
  })
  return { schemaVersion: 1, application: input.application, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(expires).toISOString(), modules }
}
function verifyCatalog(envelope, publicKey, options) {
  if (!envelope || typeof envelope.payload !== 'string' || envelope.payload.length > 2 * LIMITS.manifest || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) || typeof envelope.signature !== 'string') throw Error('Invalid signed module catalog')
  const payload = Buffer.from(envelope.payload, 'base64'), signature = Buffer.from(envelope.signature, 'base64')
  if (payload.length > LIMITS.manifest || payload.toString('base64') !== envelope.payload || signature.length !== 64 || signature.toString('base64') !== envelope.signature) throw Error('Invalid catalog signature encoding')
  const key = crypto.createPublicKey(publicKey)
  if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, payload, key, signature)) throw Error('Module catalog signature verification failed')
  return normalizeCatalog(JSON.parse(payload.toString('utf8')), options)
}
function signCatalog(payload, privateKey, options) {
  const normalized = normalizeCatalog(payload, options), bytes = Buffer.from(JSON.stringify(normalized))
  const key = crypto.createPrivateKey(privateKey)
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Module catalog needs an Ed25519 signing key')
  return { payload: bytes.toString('base64'), signature: crypto.sign(null, bytes, key).toString('base64') }
}
module.exports = { downloadUrl, normalizeCatalog, verifyCatalog, signCatalog }
