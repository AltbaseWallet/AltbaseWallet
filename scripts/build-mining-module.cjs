const { createHash, createPrivateKey, createPublicKey, sign, verify } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  MINING_MODULE_KEY_ID,
  MINING_MODULE_PUBLIC_KEY,
} = require('../electron/mining-module-trust.cjs')

const root = path.resolve(__dirname, '..')
const moduleRoot = path.join(root, 'modules', 'mining')
const requireSignature = process.argv.includes('--require-signature')
const signNow = process.argv.includes('--sign-now')
const defaultSigningKey = path.resolve(root, '..', 'Altbase_signing_keys', 'altbase-mining-module-ed25519-private.pem')
const signingKeyPath = process.env.ALTBASE_MINING_SIGNING_KEY || defaultSigningKey
const manifestPath = path.join(moduleRoot, 'package.manifest.json')
const tsc = require.resolve('typescript/bin/tsc', { paths: [root] })
const result = spawnSync(process.execPath, [tsc, '-p', path.join(moduleRoot, 'tsconfig.json')], { cwd: root, stdio: 'inherit', shell: false })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

const canonicalize = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}

const included = [
  'module.json',
  'package.json',
  ...fs.readdirSync(path.join(moduleRoot, 'catalog'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(moduleRoot, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/')),
  ...fs.readdirSync(path.join(moduleRoot, 'docs'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(moduleRoot, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/')),
  ...fs.readdirSync(path.join(moduleRoot, 'dist', 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(moduleRoot, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/')),
  ...fs.readdirSync(path.join(moduleRoot, 'dist', 'frontend'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(moduleRoot, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/')),
].sort()

const files = included.map((relativePath) => {
  const absolute = path.join(moduleRoot, ...relativePath.split('/'))
  const data = fs.readFileSync(absolute)
  return { path: relativePath, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
})
const moduleManifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'module.json'), 'utf8'))
const newPayload = {
  schemaVersion: 2,
  id: moduleManifest.id,
  version: moduleManifest.version,
  releaseEpoch: moduleManifest.releaseEpoch,
  generatedAt: new Date().toISOString(),
  walletApi: moduleManifest.walletApi,
  files,
}

const reusableSignedManifest = () => {
  if (!fs.existsSync(manifestPath)) return null
  const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const { signature: existingSignature, ...existingPayload } = existing
  const rebuiltPayload = { ...newPayload, generatedAt: existingPayload.generatedAt }
  if (canonicalize(existingPayload) !== canonicalize(rebuiltPayload)) return null
  if (existingSignature?.algorithm !== 'ed25519' || existingSignature?.keyId !== MINING_MODULE_KEY_ID) return null
  const signatureBytes = Buffer.from(String(existingSignature.value || ''), 'base64')
  if (signatureBytes.length !== 64
    || !verify(null, Buffer.from(canonicalize(existingPayload), 'utf8'), createPublicKey(MINING_MODULE_PUBLIC_KEY), signatureBytes)) {
    return null
  }
  return existing
}

let signature = null
if (fs.existsSync(signingKeyPath)) {
  const privateKey = createPrivateKey(fs.readFileSync(signingKeyPath))
  const derivedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString().replaceAll('\r\n', '\n')
  if (derivedPublicKey !== MINING_MODULE_PUBLIC_KEY) throw new Error('Mining module signing key does not match the public key embedded in Altbase Wallet')
  const payload = newPayload
  signature = {
    algorithm: 'ed25519',
    keyId: MINING_MODULE_KEY_ID,
    value: sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKey).toString('base64'),
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...payload, signature }, null, 2)}\n`, 'utf8')
} else if (signNow) {
  throw new Error('Altbase Mining module private signing key is required to create a new release manifest')
} else if (requireSignature) {
  const existing = reusableSignedManifest()
  if (!existing) {
    throw new Error('Mining module files changed and the private signing key is required to sign them')
  }
  signature = existing.signature
} else {
  const existing = reusableSignedManifest()
  if (existing) {
    signature = existing.signature
  } else {
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...newPayload, signature: null }, null, 2)}\n`, 'utf8')
  }
}
console.log(`Mining package manifest written with ${files.length} files (${signature ? MINING_MODULE_KEY_ID : 'unsigned development build'}).`)
