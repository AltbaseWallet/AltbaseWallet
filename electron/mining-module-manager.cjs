const { createHash, createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { pathToFileURL } = require('node:url')
const {
  MINING_MODULE_API_VERSION,
  MINING_MODULE_ID: MODULE_ID,
  MINING_MODULE_KEY_ID,
  MINING_MODULE_PUBLIC_KEY,
  MINING_MODULE_REPOSITORY,
  miningModuleArchiveAssetName,
  miningModuleManifestAssetName,
} = require('./mining-module-trust.cjs')

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MANIFEST_HASH = /^[a-f0-9]{64}$/
const MAX_LOG_BYTES = 128 * 1024
const TARGET_LOG_BYTES = 96 * 1024
const MAX_LOG_LINES = 150
const MAX_NATIVE_LOG_BYTES = 128 * 1024
const MAX_STREAM_REMAINDER = 256 * 1024
const METRIC_LINE_DEDUPLICATION_MS = 2_000
const LOG_LINE_DEDUPLICATION_MS = 2_500
const MINER_STARTUP_TIMEOUT_MS = 20_000
const MINER_STARTUP_FAILURE_LIMIT = 2
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
const UPSTREAM_UPDATE_CACHE_MS = 15 * 60_000
const MODULE_UPDATE_CACHE_MS = 15 * 60_000
const MAX_UPSTREAM_ARTIFACT_BYTES = 2_000_000_000
const MAX_MODULE_MANIFEST_BYTES = 2 * 1024 * 1024
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/
const CUSTOM_POOL_MODES = new Set(['pps', 'pplns', 'prop', 'solo', 'other'])
const CUSTOM_POOL_PROTOCOLS = new Set(['stratum+tcp:', 'stratum+ssl:', 'wss:'])
const MAX_CUSTOM_POOLS = 256
const GIBIBYTE = 1024 ** 3
const MINIMUM_FREE_MEMORY_BY_ALGORITHM = new Map([
  ['randomscash', 2.5 * GIBIBYTE],
  ['rx/0', 2.5 * GIBIBYTE],
])

const RATE_PREFIX_MULTIPLIERS = new Map([
  ['', 1],
  ['k', 1_000],
  ['m', 1_000_000],
  ['g', 1_000_000_000],
  ['t', 1_000_000_000_000],
  ['p', 1_000_000_000_000_000],
  ['e', 1_000_000_000_000_000_000],
])

const RATE_UNIT_ALIASES = new Map([
  ['h', 'h/s'],
  ['hash', 'h/s'],
  ['hashes', 'h/s'],
  ['sol', 'sol/s'],
  ['sols', 'sol/s'],
  ['solution', 'sol/s'],
  ['solutions', 'sol/s'],
  ['it', 'it/s'],
  ['iter', 'it/s'],
  ['iters', 'it/s'],
  ['iteration', 'it/s'],
  ['iterations', 'it/s'],
  ['graph', 'graph/s'],
  ['graphs', 'graph/s'],
  ['cycle', 'cycle/s'],
  ['cycles', 'cycle/s'],
  ['proof', 'proof/s'],
  ['proofs', 'proof/s'],
  ['nonce', 'nonce/s'],
  ['nonces', 'nonce/s'],
  ['key', 'key/s'],
  ['keys', 'key/s'],
  ['share', 'share/s'],
  ['shares', 'share/s'],
])

const SHORT_RATE_UNIT_ALIASES = new Map([
  ['s/s', 'sol/s'],
  ['g/s', 'graph/s'],
  ['gps', 'graph/s'],
  ['i/s', 'it/s'],
  ['ips', 'it/s'],
  ['c/s', 'cycle/s'],
  ['cps', 'cycle/s'],
  ['p/s', 'proof/s'],
  ['pps', 'proof/s'],
  ['n/s', 'nonce/s'],
  ['nps', 'nonce/s'],
])

const RATE_UNIT_PATTERN = String.raw`([kMGTPE]?\s*(?:(?:H|hash(?:es)?|Sol(?:s)?|solution(?:s)?|it|iter(?:ation)?s?|graph(?:s)?|cycle(?:s)?|proof(?:s)?|nonce(?:s)?|key(?:s)?|share(?:s)?|S|G|I|C|P|N)\/s|(?:GPS|IPS|CPS|PPS|NPS))|[A-Za-z][A-Za-z0-9._-]{0,23}\/s)`

const parseRateUnit = (input) => {
  const unit = String(input || '').replace(/\s+/g, '').toLowerCase()
  if (!unit) return null

  const shortMatch = unit.match(/^([kmgtpe]?)(s\/s|g\/s|gps|i\/s|ips|c\/s|cps|p\/s|pps|n\/s|nps)$/)
  if (shortMatch) {
    return {
      multiplier: RATE_PREFIX_MULTIPLIERS.get(shortMatch[1]),
      unit: SHORT_RATE_UNIT_ALIASES.get(shortMatch[2]),
    }
  }

  const unprefixedLongMatch = unit.match(/^([a-z]+)\/s$/)
  if (unprefixedLongMatch && RATE_UNIT_ALIASES.has(unprefixedLongMatch[1])) {
    return { multiplier: 1, unit: RATE_UNIT_ALIASES.get(unprefixedLongMatch[1]) }
  }

  const longMatch = unit.match(/^([kmgtpe])([a-z]+)\/s$/)
  if (longMatch && RATE_UNIT_ALIASES.has(longMatch[2])) {
    return {
      multiplier: RATE_PREFIX_MULTIPLIERS.get(longMatch[1]),
      unit: RATE_UNIT_ALIASES.get(longMatch[2]),
    }
  }

  // Preserve future miner-specific rates instead of mislabelling them as hashes.
  if (/^[a-z][a-z0-9._-]{0,23}\/s$/.test(unit)) return { multiplier: 1, unit }
  return null
}

const parseMetricNumber = (value) => {
  const parsed = Number(String(value || '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const parseMiningMetricLine = (input) => {
  const line = String(input || '').replace(ANSI_ESCAPE_PATTERN, '')
  const result = {}
  const totalRate = line.match(new RegExp(`\\bTotal:\\s*([\\d.,]+)\\s*${RATE_UNIT_PATTERN}\\b`, 'i'))
  const xmrigRate = line.match(/\bspeed\s+10s\/60s\/15m\s+(\S+)\s+(\S+)\s+(\S+)\s+([kMGTPE]?H\/s)\b/i)
  const genericRate = line.match(new RegExp(`\\b(?:current\\s+)?(?:hashrate|hash\\s*rate|total\\s+speed|speed)\\s*[:=]?\\s*([\\d.,]+)\\s*${RATE_UNIT_PATTERN}\\b`, 'i'))
  const qliRate = line.match(/\b([\d.,]+)\s+avg\s+it\/s\b/i)
    || line.match(/\[[A-Z0-9._-]+\]\s*([\d.,]+)\s+it\/s\b/i)
  const rateMatch = totalRate || genericRate
  if (qliRate) {
    const value = parseMetricNumber(qliRate[1])
    if (value !== null) {
      result.hashrateHps = value
      result.hashrateUnit = 'it/s'
    }
  } else if (rateMatch) {
    const value = parseMetricNumber(rateMatch[1])
    const rate = parseRateUnit(rateMatch[2])
    if (value !== null && rate) {
      result.hashrateHps = value * rate.multiplier
      result.hashrateUnit = rate.unit
    }
  } else if (xmrigRate) {
    const value = [xmrigRate[1], xmrigRate[2], xmrigRate[3]].map(parseMetricNumber).find((entry) => entry !== null)
    const rate = parseRateUnit(xmrigRate[4])
    if (value !== undefined && value !== null && rate) {
      result.hashrateHps = value * rate.multiplier
      result.hashrateUnit = rate.unit
    }
  }

  const xmrigShares = line.match(/\b(?:accepted|rejected)\s+\((\d+)\/(\d+)\)/i)
  const srbShares = line.match(/\b(?:CPU|GPU\d*):.*\[\s*(\d+)\|\s*(\d+)\|/i)
  const genericShares = line.match(/\bshares?\s*[:=]\s*(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?/i)
  const shares = xmrigShares || srbShares || genericShares
  if (shares) {
    result.acceptedShares = Number(shares[1])
    result.rejectedShares = Number(shares[2])
    if (shares[3] !== undefined) result.staleShares = Number(shares[3])
  } else {
    if (/\bshare\s+accepted\b/i.test(line) || /\bsolution\s+accepted\b/i.test(line)) result.acceptedDelta = 1
    if (/\bshare\s+rejected\b/i.test(line) || /\bsolution\s+rejected\b/i.test(line)) result.rejectedDelta = 1
  }

  const power = line.match(/\b(?:power|pwr)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*W\b/i)
  const temperature = line.match(/\b(?:temperature|temp)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:C|°C)\b/i)
  if (power) result.powerWatts = parseMetricNumber(power[1])
  if (temperature) result.temperatureCelsius = parseMetricNumber(temperature[1])
  return result
}

const classifyMiningStartupLine = (input) => {
  const line = String(input || '').replace(ANSI_ESCAPE_PATTERN, '').trim()
  if (!line) return null
  if (/\b(?:not enough free pages to allocate|failed to allocate (?:rx )?(?:dataset|memory)|not enough (?:free )?memory)\b/i.test(line)) {
    return { state: 'resource-failed', line }
  }
  if (/\b(?:new job from|new job received|job received|connected to (?:the )?(?:pool|server)|use pool .+TLSv|authorization successful|authorized successfully|login succeeded|mining started)\b/i.test(line)) {
    return { state: 'ready', line }
  }
  if (/\b(?:read error|connection (?:error|failed|refused|timed out)|connect error|failed to connect|unable to connect|could not connect|no active pools|login failed|unauthorized|authorization failed|invalid (?:user|wallet|address)|pool disconnected)\b/i.test(line)) {
    return { state: 'failed', line }
  }
  return null
}

const normalizeVersion = (value) => {
  const normalized = String(value || '').trim().replace(/^v(?=\d)/i, '')
  if (!SEMVER_PATTERN.test(normalized)) throw new Error(`Unsupported upstream version: ${value}`)
  return normalized
}

const canonicalize = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}

const compareVersions = (left, right) => {
  const parse = (value) => {
    const [core, suffix = ''] = normalizeVersion(value).split(/-(.*)/s)
    return { core: core.split('.').map(Number), suffix }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  }
  if (a.suffix === b.suffix) return 0
  if (!a.suffix) return 1
  if (!b.suffix) return -1
  return a.suffix.localeCompare(b.suffix, 'en', { numeric: true })
}

const moduleReleaseEpoch = (manifest) => {
  const value = manifest?.releaseEpoch ?? 1
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Mining module release epoch is invalid')
  return value
}

const compareModuleReleases = (left, right) => {
  const leftEpoch = moduleReleaseEpoch(left)
  const rightEpoch = moduleReleaseEpoch(right)
  if (leftEpoch !== rightEpoch) return leftEpoch > rightEpoch ? 1 : -1
  return compareVersions(left.version, right.version)
}

const renderAssetName = (template, version) => template
  .replaceAll('{version}', version)
  .replaceAll('{version-dashes}', version.replaceAll('.', '-'))

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Altbase-Wallet',
  'X-GitHub-Api-Version': '2026-03-10',
}

const githubJson = async (apiPath) => {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: githubHeaders,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`)
  if (new URL(response.url).hostname !== 'api.github.com') throw new Error('GitHub API request left api.github.com')
  return response.json()
}

const trustedGitHubReleaseAsset = (release, expectedName, maximumSize = MAX_UPSTREAM_ARTIFACT_BYTES) => {
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((entry) => entry.name === expectedName && entry.state === 'uploaded')
    : null
  if (!asset) throw new Error(`GitHub release does not contain ${expectedName}`)
  const digest = String(asset.digest || '')
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`${expectedName} has no GitHub SHA-256 digest`)
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maximumSize) {
    throw new Error(`${expectedName} has an invalid size`)
  }
  const url = new URL(String(asset.browser_download_url || ''))
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.includes('/releases/download/')) {
    throw new Error(`${expectedName} has an invalid GitHub download URL`)
  }
  return {
    name: expectedName,
    url: url.href,
    size: asset.size,
    sha256: digest.slice('sha256:'.length),
  }
}

const fetchVerifiedGithubJsonAsset = async (artifact) => {
  const response = await fetch(artifact.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`GitHub release asset returned HTTP ${response.status}`)
  const finalUrl = new URL(response.url)
  if (finalUrl.protocol !== 'https:' || (finalUrl.hostname !== 'github.com' && !finalUrl.hostname.endsWith('.githubusercontent.com'))) {
    throw new Error('GitHub release asset redirect left GitHub infrastructure')
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && Number(declaredLength) !== artifact.size) throw new Error('GitHub release manifest size changed during download')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== artifact.size) throw new Error('GitHub release manifest download is incomplete')
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('GitHub release manifest SHA-256 mismatch')
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('GitHub release manifest is not valid JSON')
  }
}

const discoverGitHubReleaseUpdate = async (miner, platform) => {
  const assetSpec = miner.updates.assets[platform]
  if (!assetSpec) throw new Error(`No upstream ${platform} asset is configured`)
  const release = await githubJson(`/repos/${miner.updates.repository}/releases/latest`)
  if (release.draft || release.prerelease) throw new Error('GitHub latest release is not stable')
  const version = normalizeVersion(release.tag_name)
  const assetName = renderAssetName(assetSpec.nameTemplate, version)
  const asset = trustedGitHubReleaseAsset(release, assetName)
  return {
    version,
    publishedAt: String(release.published_at || release.created_at || ''),
    sourceUrl: String(release.html_url || miner.sourceUrl),
    trust: 'github-release-digest',
    artifact: {
      platform,
      url: asset.url,
      sha256: asset.sha256,
      size: asset.size,
      archive: assetSpec.archive,
    },
  }
}

const assetTemplatePattern = (template) => {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('\\{version\\}', '(?<version>\\d+\\.\\d+\\.\\d+(?:[-+][A-Za-z0-9.-]+)?)')
  return new RegExp(`https://dl\\.qubic\\.li/downloads/${escaped}`, 'i')
}

const discoverGitHubReadmeUpdate = async (miner, platform) => {
  const assetSpec = miner.updates.assets[platform]
  if (!assetSpec) throw new Error(`No upstream ${platform} asset is configured`)
  const content = await githubJson(`/repos/${miner.updates.repository}/contents/${miner.updates.readmePath}`)
  if (content.type !== 'file' || content.encoding !== 'base64' || typeof content.content !== 'string' || typeof content.sha !== 'string') {
    throw new Error('GitHub README response is invalid')
  }
  const readme = Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8')
  if (readme.length > 2 * 1024 * 1024) throw new Error('GitHub README is too large')
  const match = readme.match(assetTemplatePattern(assetSpec.nameTemplate))
  if (!match?.groups?.version) throw new Error('GitHub README does not contain the configured platform download')
  const version = normalizeVersion(match.groups.version)
  const url = new URL(match[0])
  if (url.protocol !== 'https:' || url.hostname !== 'dl.qubic.li' || path.posix.basename(url.pathname) !== renderAssetName(assetSpec.nameTemplate, version)) {
    throw new Error('Publisher download URL in GitHub README is invalid')
  }
  return {
    version,
    publishedAt: '',
    sourceUrl: String(content.html_url || miner.sourceUrl),
    upstreamContentSha: content.sha,
    trust: 'github-readme-publisher-https',
    artifact: {
      platform,
      url: url.href,
      sha256: null,
      size: null,
      archive: assetSpec.archive,
    },
  }
}

const resolveHostPlatform = (platform, architecture) => {
  if (platform === 'win32' && architecture === 'x64') return 'windows-x64'
  if (platform === 'linux' && architecture === 'x64') return 'linux-x64'
  if (platform === 'darwin' && architecture === 'x64') return 'macos-x64'
  if (platform === 'darwin' && architecture === 'arm64') return 'macos-arm64'
  throw new Error(`Mining module does not support ${platform}-${architecture}`)
}

const hostPlatform = () => resolveHostPlatform(process.platform, process.arch)

const safeId = (value, label = 'identifier') => {
  const normalized = String(value || '').toLowerCase()
  if (!ID_PATTERN.test(normalized)) throw new Error(`Invalid ${label}`)
  return normalized
}

const safeRelative = (value, label = 'path') => {
  const normalized = String(value || '').replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error(`Invalid ${label}`)
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid ${label}`)
  return normalized
}

const cleanCustomPoolText = (value, label, maximumLength, { optional = false } = {}) => {
  const normalized = String(value ?? '').trim()
  if (!normalized && optional) return undefined
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (!normalized || normalized.length > maximumLength || hasControlCharacter) {
    throw new Error(`Invalid ${label}`)
  }
  return normalized
}

const normalizeCustomPool = (input, catalog, existingId = null) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Custom pool must be an object')
  const coinId = safeId(input.coinId, 'custom pool coin')
  const coin = catalog.coins.find((entry) => entry.id === coinId)
  if (!coin) throw new Error('Custom pool coin is not in the Mining catalog')
  const algorithm = cleanCustomPoolText(input.algorithm, 'custom pool algorithm', 64)
  if (!coin.algorithms.includes(algorithm)) throw new Error('Custom pool algorithm is not supported by this coin')
  const displayName = cleanCustomPoolText(input.displayName, 'custom pool name', 80)
  const mode = String(input.mode || 'other').toLowerCase()
  if (!CUSTOM_POOL_MODES.has(mode)) throw new Error('Invalid custom pool payout mode')
  const region = cleanCustomPoolText(input.region || 'custom', 'custom pool region', 32)
  const minimumPayout = cleanCustomPoolText(input.minimumPayout, 'custom pool minimum payout', 80, { optional: true })
  const usernameTemplate = cleanCustomPoolText(input.usernameTemplate || '{wallet}.{worker}', 'custom pool username template', 320)
  if (!usernameTemplate.includes('{wallet}')) throw new Error('Custom pool username template must include {wallet}')
  for (const match of usernameTemplate.matchAll(/\{([^}]+)\}/g)) {
    if (match[1] !== 'wallet' && match[1] !== 'worker') throw new Error(`Unsupported custom pool placeholder: {${match[1]}}`)
  }
  if (/[{}]/.test(usernameTemplate.replaceAll('{wallet}', '').replaceAll('{worker}', ''))) {
    throw new Error('Custom pool username template is malformed')
  }

  const endpointUrl = cleanCustomPoolText(input.endpointUrl || input.endpoints?.[0]?.url, 'custom pool endpoint', 512)
  let endpoint
  try {
    endpoint = new URL(endpointUrl)
  } catch {
    throw new Error('Custom pool endpoint is not a valid URL')
  }
  if (!CUSTOM_POOL_PROTOCOLS.has(endpoint.protocol)) throw new Error('Custom pool endpoint must use stratum+tcp, stratum+ssl or wss')
  if (!endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Custom pool endpoint must contain only a host, port and optional WSS path')
  }
  if (endpoint.protocol !== 'wss:' && !endpoint.port) throw new Error('Custom Stratum pool endpoint requires a port')
  if (endpoint.protocol !== 'wss:' && endpoint.pathname !== '' && endpoint.pathname !== '/') {
    throw new Error('Custom Stratum pool endpoint cannot contain a path')
  }

  let id = existingId
  if (input.id !== undefined && input.id !== null && input.id !== '') {
    id = safeId(input.id, 'custom pool identifier')
    if (!id.startsWith('custom-')) throw new Error('Custom pool identifier must start with custom-')
  }
  if (!id) id = `custom-${coinId}-${randomUUID().replaceAll('-', '').slice(0, 12)}`

  return {
    id,
    coinId,
    algorithm,
    displayName,
    mode,
    region,
    feePercent: null,
    ...(minimumPayout ? { minimumPayout } : {}),
    usernameTemplate,
    endpoints: [{
      url: endpoint.href,
      tls: endpoint.protocol === 'stratum+ssl:' || endpoint.protocol === 'wss:',
    }],
    custom: true,
  }
}

const POOL_DIRECTORY_SECTION_MAP = new Map([
  ['bitcoin', { coinId: 'bitcoin', algorithm: 'sha256d' }],
  ['bitcoinii', { coinId: 'bitcoin2', algorithm: 'sha256d' }],
  ['bitcoincash2', { coinId: 'bitcoincashii', algorithm: 'sha256d' }],
  ['btgscoin', { coinId: 'btgs', algorithm: 'sha256d' }],
  ['capstash', { coinId: 'capstash', algorithm: 'whirlpoolx' }],
  ['nervos', { coinId: 'ckb', algorithm: 'eaglesong' }],
  ['epiccash-randomx', { coinId: 'epic', algorithm: 'rx/0' }],
  ['epiccash-progpow', { coinId: 'epic', algorithm: 'progpow' }],
  ['epiccash-cuckoo', { coinId: 'epic', algorithm: 'cuckatoo31' }],
  ['firo', { coinId: 'firo', algorithm: 'firopow' }],
  ['hypercoin', { coinId: 'hypercoin', algorithm: 'sha256d' }],
  ['junkcoin', { coinId: 'junkcoin', algorithm: 'scrypt' }],
  ['kaspa', { coinId: 'kaspa', algorithm: 'kheavyhash' }],
  ['kerrigan-x11', { coinId: 'kerrigan', algorithm: 'x11' }],
  ['kerrigan-kawpow', { coinId: 'kerrigan', algorithm: 'kawpow' }],
  ['kerrigan-equihash', { coinId: 'kerrigan', algorithm: 'equihash-200-9' }],
  ['kerrigan-equihash192', { coinId: 'kerrigan', algorithm: 'equihash-192-7' }],
  ['litecoin2', { coinId: 'litecoinii', algorithm: 'scrypt' }],
  ['mydogecoin', { coinId: 'mydogecoin', algorithm: 'scrypt' }],
  ['neoxa', { coinId: 'neoxa', algorithm: 'kawpow' }],
  ['pearl', { coinId: 'pearl', algorithm: 'pearlhash' }],
  ['pepecoin', { coinId: 'pepecoin', algorithm: 'scrypt' }],
  ['quai', { coinId: 'quai', algorithm: 'kawpow' }],
  ['qubic', { coinId: 'qubic', algorithm: 'qubic-upow' }],
  ['raptoreum', { coinId: 'raptoreum', algorithm: 'gr' }],
  ['satoshicash', { coinId: 'scash', algorithm: 'randomscash' }],
  ['terracoin', { coinId: 'terracoin', algorithm: 'sha256d' }],
  ['zano', { coinId: 'zano', algorithm: 'progpowz' }],
])

const parsePoolDirectory = (markdown, catalog) => {
  const coinIds = new Set(catalog.coins.map((coin) => coin.id))
  const entries = []
  const seen = new Set()
  const sections = String(markdown || '').split(/^### /m).slice(1)
  for (const section of sections) {
    const heading = section.split(/\r?\n/, 1)[0]
    const slug = heading.match(/`([^`]+)`/)?.[1] || (heading.startsWith('Quai / official project list') ? 'quai' : null)
    const mapped = slug ? POOL_DIRECTORY_SECTION_MAP.get(slug) : null
    if (!mapped || !coinIds.has(mapped.coinId)) continue
    const body = section.slice(heading.length).split(/^## /m, 1)[0]
    const hosts = new Set()
    for (const match of body.matchAll(/https?:\/\/(?:www\.)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[/:?#][^\s)\]]*)?/g)) {
      hosts.add(match[1].toLowerCase())
    }
    for (const match of body.matchAll(/\b((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g)) {
      const host = match[1].toLowerCase().replace(/^www\./, '')
      if (!host.endsWith('.md') && !host.endsWith('.json')) hosts.add(host)
    }
    for (const host of hosts) {
      const key = `${mapped.coinId}:${mapped.algorithm}:${host}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        id: `directory-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`,
        coinId: mapped.coinId,
        algorithm: mapped.algorithm,
        displayName: host,
        host,
        source: 'research-directory',
      })
    }
  }
  return entries.sort((left, right) => (
    left.coinId.localeCompare(right.coinId)
    || left.algorithm.localeCompare(right.algorithm)
    || left.host.localeCompare(right.host)
  ))
}

const resolveInside = (root, relative, label = 'path') => {
  const safe = safeRelative(relative, label)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, ...safe.split('/'))
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} leaves module storage`)
  return resolved
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await fs.promises.readFile(filename, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' && arguments.length > 1) return fallback
    throw error
  }
}

const writeJsonAtomic = async (filename, value) => {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await fs.promises.rename(temporary, filename)
}

const sha256File = async (filename) => {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filename)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', resolve)
  })
  return hash.digest('hex')
}

const directoryBytes = async (root) => {
  try {
    let total = 0
    const pending = [root]
    while (pending.length > 0) {
      const current = pending.pop()
      for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
        const filename = path.join(current, entry.name)
        if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(filename)
        else if (entry.isFile() && !entry.isSymbolicLink()) total += (await fs.promises.stat(filename)).size
      }
    }
    return total
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

const packageFiles = async (root) => {
  const files = []
  const pending = [{ directory: root, relative: '' }]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of await fs.promises.readdir(current.directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Mining module package cannot contain symbolic links')
      const relative = [current.relative, entry.name].filter(Boolean).join('/')
      const filename = path.join(current.directory, entry.name)
      if (entry.isDirectory()) pending.push({ directory: filename, relative })
      else if (entry.isFile()) files.push(relative)
      else throw new Error(`Mining module package contains an unsupported entry: ${relative}`)
    }
  }
  return files.sort()
}

const minerFileRecords = async (root) => {
  const records = []
  for (const relative of await packageFiles(root)) {
    if (relative === 'altbase-install.json') continue
    const filename = resolveInside(root, relative, 'installed miner file')
    const metadata = await fs.promises.lstat(filename)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Installed miner file is invalid: ${relative}`)
    records.push({
      path: relative,
      size: metadata.size,
      sha256: await sha256File(filename),
    })
  }
  return records
}

const manifestsMatch = (actual, expected) => Boolean(expected) && canonicalize(actual) === canonicalize(expected)

const compactLogText = (text) => {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean).slice(-MAX_LOG_LINES)
  const retained = []
  let retainedBytes = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (retained.length > 0 && retainedBytes + lineBytes > TARGET_LOG_BYTES) break
    retained.push(line)
    retainedBytes += lineBytes
  }
  return retained.length > 0 ? `${retained.reverse().join('\n')}\n` : ''
}

const minerAttestationPayload = (metadata) => {
  const payload = {
    schemaVersion: metadata.schemaVersion,
    id: metadata.id,
    version: metadata.version,
    platform: metadata.platform,
    artifactUrl: metadata.artifactUrl,
    sha256: metadata.sha256,
    size: metadata.size,
    executableRelativePath: metadata.executableRelativePath,
    executableSha256: metadata.executableSha256,
    executableSize: metadata.executableSize,
    files: Array.isArray(metadata.files)
      ? metadata.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })).sort((left, right) => left.path.localeCompare(right.path))
      : null,
  }
  for (const key of ['artifactTrust', 'upstreamSourceUrl', 'upstreamContentSha']) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) payload[key] = metadata[key]
  }
  return JSON.stringify(payload)
}

class MiningModuleManager {
  constructor(app, safeStorage, emit, runtimeEnvironment = {}) {
    this.app = app
    this.safeStorage = safeStorage
    this.emit = emit
    this.runtimeEnvironment = runtimeEnvironment
    this.installedRoot = path.join(app.getPath('userData'), 'modules', MODULE_ID)
    this.dataRoot = path.join(app.getPath('userData'), 'mining')
    this.running = new Map()
    this.downloads = new Map()
    this.moduleDownload = null
    this.upstreamUpdateCache = null
    this.moduleUpdateCache = null
    this.runtimePromise = null
    this.bundledRuntimePromise = null
    this.frontendPackagePromise = null
    this.minerVerificationCache = new Map()
    this.logWrites = new Map()
    this.logSizes = new Map()
  }

  bundledRoot() {
    return this.app.isPackaged
      ? path.join(process.resourcesPath, 'modules', MODULE_ID)
      : path.join(this.app.getAppPath(), 'modules', MODULE_ID)
  }

  validatePackageManifest(manifest, { allowUnsignedDevelopment = false } = {}) {
    if (manifest?.schemaVersion !== 2 || manifest?.id !== MODULE_ID || !SEMVER_PATTERN.test(String(manifest.version || ''))) {
      throw new Error('Mining module package manifest is invalid')
    }
    moduleReleaseEpoch(manifest)
    const generatedAt = Date.parse(String(manifest.generatedAt || ''))
    if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 5 * 60_000) throw new Error('Mining module manifest timestamp is invalid')
    const minimumApi = normalizeVersion(manifest?.walletApi?.min)
    const maximumApi = normalizeVersion(manifest?.walletApi?.maxExclusive)
    if (compareVersions(minimumApi, maximumApi) >= 0
      || compareVersions(MINING_MODULE_API_VERSION, minimumApi) < 0
      || compareVersions(MINING_MODULE_API_VERSION, maximumApi) >= 0) {
      throw new Error(`Mining module ${manifest.version} is incompatible with wallet API ${MINING_MODULE_API_VERSION}`)
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 1_000) {
      throw new Error('Mining module package file list is invalid')
    }
    const paths = manifest.files.map((file) => safeRelative(file.path, 'package file'))
    if (new Set(paths).size !== paths.length || paths.includes('package.manifest.json')) throw new Error('Mining module package file list contains duplicates or reserved paths')
    const signature = manifest.signature
    if (signature === null && allowUnsignedDevelopment) return manifest
    if (signature?.algorithm !== 'ed25519' || signature?.keyId !== MINING_MODULE_KEY_ID || typeof signature?.value !== 'string') {
      throw new Error('Mining module release signature is missing or untrusted')
    }
    const signatureBytes = Buffer.from(signature.value, 'base64')
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature.value) throw new Error('Mining module release signature is invalid')
    const payload = { ...manifest }
    delete payload.signature
    if (!verify(null, Buffer.from(canonicalize(payload), 'utf8'), createPublicKey(MINING_MODULE_PUBLIC_KEY), signatureBytes)) {
      throw new Error('Mining module release signature verification failed')
    }
    return manifest
  }

  async readPackageManifest(root, options = {}) {
    const manifest = await readJson(path.join(root, 'package.manifest.json'))
    return this.validatePackageManifest(manifest, {
      allowUnsignedDevelopment: options.allowUnsignedDevelopment ?? !this.app.isPackaged,
    })
  }

  async verifyPackage(root, expectedManifest = null, allowUnexpectedFiles = false, options = {}) {
    const manifest = await this.readPackageManifest(root, options)
    if (expectedManifest && !manifestsMatch(manifest, expectedManifest)) throw new Error('Mining module manifest does not match the signed release manifest')
    const expectedFiles = [...manifest.files.map((file) => safeRelative(file.path, 'package file')), 'package.manifest.json'].sort()
    const actualFiles = await packageFiles(root)
    const missingFiles = expectedFiles.filter((file) => !actualFiles.includes(file))
    const unexpectedFiles = actualFiles.filter((file) => !expectedFiles.includes(file))
    if (missingFiles.length > 0 || (!allowUnexpectedFiles && unexpectedFiles.length > 0)) throw new Error('Mining module package contains missing or unexpected files')
    for (const file of manifest.files) {
      const relative = safeRelative(file.path, 'package file')
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !MANIFEST_HASH.test(file.sha256)) throw new Error(`Invalid package record: ${relative}`)
      const filename = resolveInside(root, relative, 'package file')
      const metadata = await fs.promises.lstat(filename)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.size) throw new Error(`Mining module file verification failed: ${relative}`)
      if (await sha256File(filename) !== file.sha256) throw new Error(`Mining module SHA-256 mismatch: ${relative}`)
    }
    const descriptor = await readJson(path.join(root, 'module.json'))
    if (descriptor?.schemaVersion !== 1
      || descriptor?.id !== MODULE_ID
      || descriptor?.version !== manifest.version
      || moduleReleaseEpoch(descriptor) !== moduleReleaseEpoch(manifest)
      || descriptor?.walletApi?.min !== manifest.walletApi.min
      || descriptor?.walletApi?.maxExclusive !== manifest.walletApi.maxExclusive
      || descriptor?.updates?.repository !== MINING_MODULE_REPOSITORY) {
      throw new Error('Mining module descriptor does not match its signed manifest')
    }
    safeRelative(descriptor.entry, 'module entry')
    safeRelative(descriptor.frontend, 'module frontend')
    if (!expectedFiles.includes(descriptor.entry) || !expectedFiles.includes(descriptor.frontend)) {
      throw new Error('Mining module entry points are not covered by the signed manifest')
    }
    return manifest
  }

  async isInstalled() {
    try {
      await fs.promises.access(path.join(this.installedRoot, 'package.manifest.json'))
      return true
    } catch {
      return false
    }
  }

  async status() {
    const bundled = await this.readPackageManifest(this.bundledRoot())
    let installedManifest = null
    let installedVersion = null
    let verified = false
    if (await this.isInstalled()) {
      try {
        installedManifest = await this.verifyPackage(this.installedRoot)
        installedVersion = installedManifest.version
        verified = true
      } catch {
        installedVersion = 'invalid'
      }
    }
    return {
      installed: verified,
      verified,
      installedVersion,
      bundledVersion: bundled.version,
      updateAvailable: Boolean(installedManifest && compareModuleReleases(bundled, installedManifest) > 0),
      walletApiVersion: MINING_MODULE_API_VERSION,
      releaseKeyId: MINING_MODULE_KEY_ID,
      updateRepository: MINING_MODULE_REPOSITORY,
      platform: hostPlatform(),
      runningJobs: [...this.running.keys()],
      dataBytes: await directoryBytes(this.dataRoot),
      dataPath: this.dataRoot,
    }
  }

  async install() {
    const source = this.bundledRoot()
    const manifest = await this.verifyPackage(source, null, !this.app.isPackaged)
    if (await this.isInstalled()) {
      try {
        const installed = await this.verifyPackage(this.installedRoot)
        if (compareModuleReleases(installed, manifest) >= 0) return this.status()
      } catch {
        // Invalid installations are replaced below.
      }
    }
    const parent = path.dirname(this.installedRoot)
    const temporary = path.join(parent, `${MODULE_ID}.install-${randomUUID()}`)
    const backup = path.join(parent, `${MODULE_ID}.previous-${randomUUID()}`)
    await fs.promises.mkdir(parent, { recursive: true, mode: 0o700 })
    await fs.promises.mkdir(temporary, { recursive: true, mode: 0o700 })
    try {
      for (const file of manifest.files) {
        const relative = safeRelative(file.path, 'package file')
        const destination = resolveInside(temporary, relative, 'package file')
        await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        await fs.promises.copyFile(resolveInside(source, relative, 'package file'), destination, fs.constants.COPYFILE_EXCL)
      }
      await fs.promises.copyFile(path.join(source, 'package.manifest.json'), path.join(temporary, 'package.manifest.json'), fs.constants.COPYFILE_EXCL)
      await this.verifyPackage(temporary)
      await this.stopAll()
      if (fs.existsSync(this.installedRoot)) await fs.promises.rename(this.installedRoot, backup)
      await fs.promises.rename(temporary, this.installedRoot)
      await fs.promises.rm(backup, { recursive: true, force: true })
      this.runtimePromise = null
      this.frontendPackagePromise = null
      this.moduleUpdateCache = null
      this.emit({ type: 'module-installed', version: manifest.version })
      return this.status()
    } catch (error) {
      await fs.promises.rm(temporary, { recursive: true, force: true })
      if (!await this.isInstalled() && fs.existsSync(backup)) await fs.promises.rename(backup, this.installedRoot)
      throw error
    }
  }

  async remove({ preserveData = false } = {}) {
    await this.stopAll()
    await this.cancelAndWaitForDownloads()
    await fs.promises.rm(this.installedRoot, { recursive: true, force: true })
    if (!preserveData) await fs.promises.rm(this.dataRoot, { recursive: true, force: true })
    this.runtimePromise = null
    this.frontendPackagePromise = null
    this.moduleUpdateCache = null
    this.emit({ type: 'module-removed', preserveData })
    return this.status()
  }

  async verify() {
    if (!await this.isInstalled()) throw new Error('Mining module is not installed')
    const manifest = await this.verifyPackage(this.installedRoot)
    return { ok: true, version: manifest.version, files: manifest.files.length, keyId: manifest.signature?.keyId || 'development' }
  }

  async manifest() {
    if (await this.isInstalled()) {
      try {
        return await this.readPackageManifest(this.installedRoot)
      } catch {
        // Fall back to the signed copy bundled with the wallet.
      }
    }
    return this.readPackageManifest(this.bundledRoot())
  }

  async runtime() {
    if (!await this.isInstalled()) throw new Error('Mining module is not installed')
    if (!this.runtimePromise) {
      const manifest = await this.verifyPackage(this.installedRoot)
      const moduleManifest = await readJson(path.join(this.installedRoot, 'module.json'))
      const entry = resolveInside(this.installedRoot, moduleManifest.entry, 'module entry')
      this.runtimePromise = import(`${pathToFileURL(entry).href}?v=${encodeURIComponent(manifest.version)}`)
    }
    return this.runtimePromise
  }

  async bundledRuntime() {
    if (!this.bundledRuntimePromise) {
      const manifest = await this.verifyPackage(this.bundledRoot(), null, !this.app.isPackaged)
      const moduleManifest = await readJson(path.join(this.bundledRoot(), 'module.json'))
      const entry = resolveInside(this.bundledRoot(), moduleManifest.entry, 'bundled module entry')
      this.bundledRuntimePromise = import(`${pathToFileURL(entry).href}?bundled=${encodeURIComponent(manifest.version)}`)
    }
    return this.bundledRuntimePromise
  }

  async ensureInstalledBundleIsCurrent() {
    if (!await this.isInstalled()) return this.status()
    let installed
    try {
      installed = await this.verifyPackage(this.installedRoot)
    } catch {
      return this.install()
    }
    const bundled = await this.verifyPackage(this.bundledRoot(), null, !this.app.isPackaged)
    return compareModuleReleases(bundled, installed) > 0
      ? this.install()
      : this.status()
  }

  async frontendPackage() {
    if (!this.frontendPackagePromise) {
      this.frontendPackagePromise = (async () => {
        let root = this.bundledRoot()
        let manifest
        try {
          if (await this.isInstalled()) {
            const [installed, bundled] = await Promise.all([
              this.verifyPackage(this.installedRoot),
              this.verifyPackage(this.bundledRoot(), null, !this.app.isPackaged),
            ])
            if (compareModuleReleases(bundled, installed) > 0) {
              manifest = bundled
            } else {
              root = this.installedRoot
              manifest = installed
            }
          } else {
            manifest = await this.verifyPackage(root, null, !this.app.isPackaged)
          }
        } catch {
          root = this.bundledRoot()
          manifest = await this.verifyPackage(root, null, !this.app.isPackaged)
        }
        const descriptor = await readJson(path.join(root, 'module.json'))
        const frontend = safeRelative(descriptor.frontend, 'module frontend')
        if (!manifest.files.some((file) => file.path === frontend)) {
          throw new Error('Mining module frontend is not covered by the signed manifest')
        }
        return { root, manifest, frontend }
      })().catch((error) => {
        this.frontendPackagePromise = null
        throw error
      })
    }
    return this.frontendPackagePromise
  }

  async frontendPath() {
    const selected = await this.frontendPackage()
    return resolveInside(selected.root, selected.frontend, 'module frontend')
  }

  async frontendResourcePath(resource) {
    const selected = await this.frontendPackage()
    const relativeResource = safeRelative(resource, 'module frontend resource')
    const frontendDirectory = path.posix.dirname(selected.frontend)
    const relative = safeRelative(path.posix.join(frontendDirectory, relativeResource), 'module frontend resource')
    if (!selected.manifest.files.some((file) => file.path === relative)) {
      throw new Error('Mining module frontend resource is not covered by the signed manifest')
    }
    return resolveInside(selected.root, relative, 'module frontend resource')
  }

  async catalog() {
    if (!await this.isInstalled()) throw new Error('Mining module is not installed')
    const catalog = await readJson(path.join(this.installedRoot, 'catalog', 'default-catalog.json'))
    const runtime = await this.runtime()
    runtime.validateBundledCatalogShape(catalog)
    const research = await fs.promises.readFile(path.join(this.installedRoot, 'docs', 'MINING_MODULE_RESEARCH.md'), 'utf8')
    return {
      ...catalog,
      poolDirectory: {
        ...catalog.poolDirectory,
        entries: parsePoolDirectory(research, catalog),
      },
    }
  }

  async hardware() {
    const cpus = os.cpus()
    let gpuInfo = null
    try { gpuInfo = await this.app.getGPUInfo('complete') } catch { gpuInfo = null }
    const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : []
    return {
      cpu: {
        model: cpus[0]?.model?.trim() || 'Unknown CPU',
        logicalThreads: cpus.length,
        memoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
      },
      gpus: devices.map((device, index) => ({
        id: String(index),
        vendorId: Number(device.vendorId || 0),
        deviceId: Number(device.deviceId || 0),
        active: device.active === true,
        driverVendor: String(device.driverVendor || ''),
        driverVersion: String(device.driverVersion || ''),
        renderer: String(gpuInfo?.auxAttributes?.glRenderer || ''),
        usable: !/(?:microsoft basic render|swiftshader|llvmpipe|software rasterizer)/i.test(String(gpuInfo?.auxAttributes?.glRenderer || '')),
      })),
    }
  }

  jobsIndexPath() {
    return path.join(this.dataRoot, 'jobs', 'index.json')
  }

  customPoolsPath() {
    return path.join(this.dataRoot, 'custom-pools.json')
  }

  async customPoolsIndex() {
    const index = await readJson(this.customPoolsPath(), { schemaVersion: 1, pools: {} })
    if (index?.schemaVersion !== 1 || !index.pools || typeof index.pools !== 'object' || Array.isArray(index.pools)) {
      throw new Error('Custom pool storage is invalid')
    }
    if (Object.keys(index.pools).length > MAX_CUSTOM_POOLS) throw new Error('Custom pool storage exceeds its limit')
    return index
  }

  async customPools() {
    if (!await this.isInstalled()) return []
    const [catalog, index] = await Promise.all([this.catalog(), this.customPoolsIndex()])
    const pools = []
    for (const [id, stored] of Object.entries(index.pools)) {
      pools.push(normalizeCustomPool({ ...stored, id }, catalog, id))
    }
    return pools.sort((left, right) => left.displayName.localeCompare(right.displayName, 'en', { numeric: true }))
  }

  async saveCustomPool(input) {
    if (!await this.isInstalled()) throw new Error('Mining module is not installed')
    const [catalog, index] = await Promise.all([this.catalog(), this.customPoolsIndex()])
    const requestedId = input?.id ? safeId(input.id, 'custom pool identifier') : null
    if (requestedId && !Object.prototype.hasOwnProperty.call(index.pools, requestedId)) {
      throw new Error('Custom pool was not found')
    }
    const pool = normalizeCustomPool(input, catalog, requestedId)
    if (!requestedId && Object.keys(index.pools).length >= MAX_CUSTOM_POOLS) throw new Error('Custom pool limit reached')
    index.pools[pool.id] = pool
    await writeJsonAtomic(this.customPoolsPath(), index)
    this.emit({ type: 'custom-pools-changed', poolId: pool.id })
    return pool
  }

  async removeCustomPool(poolId) {
    const id = safeId(poolId, 'custom pool identifier')
    if (!id.startsWith('custom-')) throw new Error('Only custom pools can be removed')
    const index = await this.customPoolsIndex()
    if (!Object.prototype.hasOwnProperty.call(index.pools, id)) throw new Error('Custom pool was not found')
    delete index.pools[id]
    await writeJsonAtomic(this.customPoolsPath(), index)
    this.emit({ type: 'custom-pools-changed', poolId: id })
    return { ok: true }
  }

  async jobsIndex() {
    const index = await readJson(this.jobsIndexPath(), { schemaVersion: 1, jobs: {} })
    if (index?.schemaVersion !== 1 || !index.jobs || typeof index.jobs !== 'object' || Array.isArray(index.jobs)) {
      throw new Error('Mining job index is invalid')
    }
    return index
  }

  assertJobHostPolicy(job) {
    if (job.runtime.keepRunningAfterWalletClose) throw new Error('Background mining after wallet exit is disabled')
    if (job.runtime.pauseForFullscreen) throw new Error('Fullscreen pause is not supported by this wallet build')
  }

  async assertJobHardwarePolicy(job) {
    if (job.devices.mode === 'cpu') {
      const available = Math.max(1, os.cpus().length)
      if (job.devices.cpuThreads > available) throw new Error(`CPU thread count exceeds the ${available} logical threads available on this computer`)
      const minimumFreeMemory = MINIMUM_FREE_MEMORY_BY_ALGORITHM.get(job.algorithm)
      const freeMemory = Number(this.runtimeEnvironment.getFreeMemoryBytes?.() ?? os.freemem())
      if (minimumFreeMemory && freeMemory < minimumFreeMemory) {
        throw new Error(`${job.name} needs at least ${(minimumFreeMemory / GIBIBYTE).toFixed(1)} GB of free memory for its mining dataset; ${(freeMemory / GIBIBYTE).toFixed(1)} GB is available. Close memory-heavy applications before starting. CPU threads control processor load but do not reduce the dataset size.`)
      }
      return
    }
    const hardware = await this.hardware()
    const usable = new Set(hardware.gpus.filter((gpu) => gpu.usable).map((gpu) => gpu.id))
    const unavailable = job.devices.ids.filter((id) => !usable.has(id))
    if (unavailable.length > 0) throw new Error('Selected GPU is unavailable or is a software renderer')
  }

  async listJobs() {
    if (!await this.isInstalled()) return []
    const runtime = await this.runtime()
    const index = await this.jobsIndex()
    const jobs = []
    for (const [id, filename] of Object.entries(index.jobs)) {
      try {
        const job = await runtime.loadMiningJob(this.dataRoot, safeId(id, 'job identifier'), safeRelative(filename, 'job filename'))
        const managed = this.running.get(job.id)
        jobs.push({
          ...job,
          runtimeState: managed ? (managed.process ? 'running' : 'paused') : 'stopped',
          ...(managed ? { runtimeMetrics: { ...managed.metrics } } : {}),
        })
      } catch (error) {
        jobs.push({ id, runtimeState: 'invalid', error: error instanceof Error ? error.message : String(error) })
      }
    }
    return jobs
  }

  async saveJob(input) {
    const runtime = await this.runtime()
    const parsed = runtime.parseMiningJob(input)
    this.assertJobHostPolicy(parsed)
    const job = await runtime.saveMiningJob(this.dataRoot, parsed)
    if (!job.pools.some((pool) => pool.passwordRef)) await fs.promises.rm(this.secretPath(job.id), { force: true })
    const index = await this.jobsIndex()
    index.jobs[job.id] = job.moduleConfigFile
    await writeJsonAtomic(this.jobsIndexPath(), index)
    this.emit({ type: 'jobs-changed', jobId: job.id })
    return job
  }

  async validateJob(input) {
    const runtime = await this.runtime()
    const job = runtime.parseMiningJob(input)
    this.assertJobHostPolicy(job)
    await this.assertJobHardwarePolicy(job)
    const adapter = runtime.miningAdapterRegistry.require(job.miner.id)
    const compiled = runtime.compileMiningJob(job, adapter, hostPlatform())
    return { job, preview: compiled.redactedPreview, generatedFiles: compiled.generatedFiles.map((file) => file.relativePath) }
  }

  async removeJob(jobId) {
    const id = safeId(jobId, 'job identifier')
    await this.stopJob(id)
    const runtime = await this.runtime()
    await runtime.removeMiningJob(this.dataRoot, id)
    await fs.promises.rm(this.secretPath(id), { force: true })
    const index = await this.jobsIndex()
    delete index.jobs[id]
    await writeJsonAtomic(this.jobsIndexPath(), index)
    this.emit({ type: 'jobs-changed', jobId: id })
    return { ok: true }
  }

  async loadJob(jobId) {
    const id = safeId(jobId, 'job identifier')
    const index = await this.jobsIndex()
    const filename = index.jobs[id]
    if (!filename) throw new Error('Mining job was not found')
    return (await this.runtime()).loadMiningJob(this.dataRoot, id, safeRelative(filename, 'job filename'))
  }

  async minerIntegrityKey() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('Operating-system protection for miner integrity metadata is unavailable')
    const filename = path.join(this.dataRoot, 'trust', 'miner-integrity-key.json')
    let stored = await readJson(filename, null)
    if (!stored) {
      const value = randomBytes(32).toString('base64')
      stored = { schemaVersion: 1, encryptedKey: this.safeStorage.encryptString(value).toString('base64') }
      await writeJsonAtomic(filename, stored)
    }
    if (stored.schemaVersion !== 1 || typeof stored.encryptedKey !== 'string') throw new Error('Miner integrity key record is invalid')
    const decoded = this.safeStorage.decryptString(Buffer.from(stored.encryptedKey, 'base64'))
    const key = Buffer.from(decoded, 'base64')
    if (key.length !== 32) throw new Error('Miner integrity key is invalid')
    return key
  }

  async attestMinerMetadata(metadata) {
    const key = await this.minerIntegrityKey()
    return createHmac('sha256', key).update(minerAttestationPayload(metadata)).digest('hex')
  }

  async verifyMinerAttestation(metadata) {
    if (!MANIFEST_HASH.test(String(metadata?.attestation || ''))) throw new Error('Installed miner attestation is missing')
    const expected = Buffer.from(await this.attestMinerMetadata(metadata), 'hex')
    const actual = Buffer.from(metadata.attestation, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Installed miner integrity metadata was modified')
  }

  async verifyInstalledMinerMetadata(versionRoot, metadata) {
    if (metadata?.schemaVersion !== 2) throw new Error('Installed miner metadata must be refreshed')
    await this.verifyMinerAttestation(metadata)
    safeId(metadata?.id, 'installed miner identifier')
    normalizeVersion(metadata?.version)
    if (!['windows-x64', 'linux-x64', 'macos-x64', 'macos-arm64'].includes(metadata?.platform)) {
      throw new Error('Installed miner platform is invalid')
    }
    const artifactUrl = new URL(String(metadata?.artifactUrl || ''))
    const sourceUrl = new URL(String(metadata?.sourceUrl || ''))
    if (artifactUrl.protocol !== 'https:' || artifactUrl.username || artifactUrl.password) {
      throw new Error('Installed miner artifact URL is invalid')
    }
    if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) {
      throw new Error('Installed miner source URL is invalid')
    }
    if (!MANIFEST_HASH.test(String(metadata?.sha256 || '')) || !Number.isSafeInteger(metadata?.size) || metadata.size < 1) {
      throw new Error('Installed miner artifact integrity metadata is invalid')
    }
    if (Object.prototype.hasOwnProperty.call(metadata, 'artifactTrust')) {
      const allowedTrust = new Set(['direct-download', 'bundled-catalog', 'github-release-digest', 'github-readme-publisher-https'])
      if (!allowedTrust.has(metadata.artifactTrust)) throw new Error('Installed miner trust source is invalid')
      const upstreamSourceUrl = new URL(String(metadata?.upstreamSourceUrl || ''))
      if (upstreamSourceUrl.protocol !== 'https:' || upstreamSourceUrl.hostname !== 'github.com' || upstreamSourceUrl.username || upstreamSourceUrl.password) {
        throw new Error('Installed miner upstream source URL is invalid')
      }
      if (metadata.upstreamContentSha !== null && metadata.upstreamContentSha !== undefined && !/^[a-f0-9]{40}$/.test(metadata.upstreamContentSha)) {
        throw new Error('Installed miner upstream content SHA is invalid')
      }
      if (metadata.artifactTrust === 'github-release-digest' && artifactUrl.hostname !== 'github.com') {
        throw new Error('GitHub release miner artifact URL is invalid')
      }
      if (metadata.artifactTrust === 'github-readme-publisher-https') {
        if (artifactUrl.hostname !== 'dl.qubic.li' || !/^[a-f0-9]{40}$/.test(String(metadata.upstreamContentSha || ''))) {
          throw new Error('Publisher miner provenance is incomplete')
        }
      }
    }
    const executableRelativePath = safeRelative(metadata?.executableRelativePath, 'installed miner executable')
    if (!MANIFEST_HASH.test(String(metadata?.executableSha256 || '')) || !Number.isSafeInteger(metadata?.executableSize) || metadata.executableSize < 1) {
      throw new Error('Installed miner integrity metadata is invalid')
    }
    if (!Array.isArray(metadata.files) || metadata.files.length < 1 || metadata.files.length > 20_000) {
      throw new Error('Installed miner file manifest is invalid')
    }
    const expectedPaths = metadata.files.map((file) => safeRelative(file?.path, 'installed miner file'))
    if (new Set(expectedPaths).size !== expectedPaths.length || expectedPaths.includes('altbase-install.json')) {
      throw new Error('Installed miner file manifest contains duplicates or reserved paths')
    }
    const actualPaths = (await packageFiles(versionRoot)).filter((relative) => relative !== 'altbase-install.json')
    if (JSON.stringify([...actualPaths].sort()) !== JSON.stringify([...expectedPaths].sort())) {
      throw new Error('Installed miner package contains missing or unexpected files')
    }
    for (let index = 0; index < metadata.files.length; index += 1) {
      const record = metadata.files[index]
      const relative = expectedPaths[index]
      if (!MANIFEST_HASH.test(String(record?.sha256 || '')) || !Number.isSafeInteger(record?.size) || record.size < 0) {
        throw new Error(`Installed miner file record is invalid: ${relative}`)
      }
      const filename = resolveInside(versionRoot, relative, 'installed miner file')
      const stat = await fs.promises.lstat(filename, { bigint: true })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== BigInt(record.size)) throw new Error(`Installed miner file was modified: ${relative}`)
      const cacheKey = `${filename}\0${stat.size}\0${stat.mtimeNs}\0${stat.ctimeNs}\0${stat.ino}`
      let digest = this.minerVerificationCache.get(cacheKey)
      if (!digest) {
        digest = await sha256File(filename)
        this.minerVerificationCache.set(cacheKey, digest)
      }
      if (digest !== record.sha256) throw new Error(`Installed miner file SHA-256 mismatch: ${relative}`)
    }
    const executableRecord = metadata.files.find((file) => file.path === executableRelativePath)
    if (!executableRecord || executableRecord.size !== metadata.executableSize || executableRecord.sha256 !== metadata.executableSha256) {
      throw new Error('Installed miner executable record does not match the package manifest')
    }
    const executablePath = resolveInside(versionRoot, executableRelativePath, 'installed miner executable')
    return executablePath
  }

  async verifyInstalledMinerForJob(job) {
    const relativeRoot = `miners/${safeId(job.miner.id, 'miner identifier')}/${safeRelative(job.miner.version, 'miner version')}`
    const versionRoot = resolveInside(this.dataRoot, relativeRoot, 'installed miner directory')
    const metadata = await readJson(path.join(versionRoot, 'altbase-install.json'))
    if (metadata.id !== job.miner.id || metadata.version !== job.miner.version || metadata.platform !== hostPlatform()) {
      throw new Error('Installed miner metadata does not match this job')
    }
    await this.verifyInstalledMinerMetadata(versionRoot, metadata)
    return metadata
  }

  async installedMiners() {
    const root = path.join(this.dataRoot, 'miners')
    const result = []
    try {
      for (const miner of await fs.promises.readdir(root, { withFileTypes: true })) {
        if (!miner.isDirectory() || miner.isSymbolicLink() || !ID_PATTERN.test(miner.name)) continue
        const minerRoot = path.join(root, miner.name)
        for (const version of await fs.promises.readdir(minerRoot, { withFileTypes: true })) {
          if (!version.isDirectory() || version.isSymbolicLink()) continue
          try {
            const versionRoot = path.join(minerRoot, version.name)
            const metadata = await readJson(path.join(versionRoot, 'altbase-install.json'))
            await this.verifyInstalledMinerMetadata(versionRoot, metadata)
            const publicMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'files' && key !== 'attestation'))
            result.push({ ...publicMetadata, state: 'verified', running: [...this.running.values()].some((state) => state.job.miner.id === miner.name && state.job.miner.version === version.name) })
          } catch {
            result.push({ id: miner.name, version: version.name, state: 'invalid', running: false })
          }
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return result
  }

  async currentModuleManifest() {
    if (await this.isInstalled()) {
      try {
        return await this.verifyPackage(this.installedRoot)
      } catch {
        // An invalid installation cannot outrank the signed bundled fallback.
      }
    }
    return this.verifyPackage(this.bundledRoot(), null, !this.app.isPackaged)
  }

  async checkModuleUpdates({ force = false } = {}) {
    const now = Date.now()
    if (!force && this.moduleUpdateCache && now - this.moduleUpdateCache.timestamp < MODULE_UPDATE_CACHE_MS) {
      return this.moduleUpdateCache.value
    }
    let installed = null
    if (await this.isInstalled()) {
      try {
        installed = await this.verifyPackage(this.installedRoot)
      } catch {
        // A corrupt local module is replaceable by a signed GitHub release.
      }
    }
    const current = installed || await this.verifyPackage(this.bundledRoot(), null, !this.app.isPackaged)
    let value
    try {
      const release = await githubJson(`/repos/${MINING_MODULE_REPOSITORY}/releases/latest`)
      if (release.draft || release.prerelease) throw new Error('GitHub latest Mining module release is not stable')
      const latestVersion = normalizeVersion(release.tag_name)
      const manifestArtifact = trustedGitHubReleaseAsset(
        release,
        miningModuleManifestAssetName(latestVersion),
        MAX_MODULE_MANIFEST_BYTES,
      )
      const manifest = this.validatePackageManifest(
        await fetchVerifiedGithubJsonAsset(manifestArtifact),
        { allowUnsignedDevelopment: false },
      )
      if (manifest.version !== latestVersion) throw new Error('Mining module release tag and signed manifest version differ')
      const archive = trustedGitHubReleaseAsset(release, miningModuleArchiveAssetName(latestVersion))
      const sourceUrl = new URL(String(release.html_url || ''))
      if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'github.com') throw new Error('Mining module release source URL is invalid')
      value = {
        checkedAt: new Date(now).toISOString(),
        currentVersion: current.version,
        latestVersion,
        updateAvailable: Boolean(installed && compareModuleReleases(manifest, current) > 0),
        installable: Boolean(!installed && compareModuleReleases(manifest, current) >= 0),
        publishedAt: String(release.published_at || release.created_at || ''),
        sourceUrl: sourceUrl.href,
        manifest,
        artifact: {
          platform: hostPlatform(),
          url: archive.url,
          sha256: archive.sha256,
          size: archive.size,
          archive: 'tar.gz',
        },
      }
    } catch (error) {
      value = {
        checkedAt: new Date(now).toISOString(),
        currentVersion: current.version,
        latestVersion: null,
        updateAvailable: false,
        installable: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.moduleUpdateCache = { timestamp: now, value }
    this.emit({ type: 'module-update-checked', updateAvailable: value.updateAvailable, latestVersion: value.latestVersion })
    return value
  }

  async installModuleUpdate(version) {
    if (this.moduleDownload) throw new Error('Mining module update is already downloading')
    const update = await this.checkModuleUpdates({ force: true })
    if (update.error || !update.latestVersion || !update.manifest || !update.artifact) {
      throw new Error(update.error || 'No signed Mining module update is available')
    }
    if (version && normalizeVersion(version) !== update.latestVersion) throw new Error('The requested Mining module update is no longer latest')
    let installed = null
    if (await this.isInstalled()) {
      try {
        installed = await this.verifyPackage(this.installedRoot)
      } catch {
        // A corrupt local module is replaced below.
      }
    }
    const current = installed || await this.verifyPackage(this.bundledRoot(), null, !this.app.isPackaged)
    const comparison = compareModuleReleases(update.manifest, current)
    if ((installed && comparison <= 0) || (!installed && comparison < 0)) return this.status()

    const controller = new AbortController()
    let finishDownload
    const downloadState = {
      controller,
      done: new Promise((resolve) => { finishDownload = resolve }),
    }
    this.moduleDownload = downloadState
    const runtime = await this.bundledRuntime()
    const downloadRoot = path.join(this.dataRoot, 'downloads')
    const archive = path.join(downloadRoot, `${MODULE_ID}-${update.latestVersion}.tar.gz`)
    const parent = path.dirname(this.installedRoot)
    const temporary = path.join(parent, `${MODULE_ID}.install-${randomUUID()}`)
    const backup = path.join(parent, `${MODULE_ID}.previous-${randomUUID()}`)
    try {
      await runtime.downloadVerifiedArtifact(update.artifact, archive, {
        signal: controller.signal,
        onProgress: (progress) => this.emit({
          type: 'module-download-progress',
          version: update.latestVersion,
          ...progress,
        }),
      })
      await fs.promises.rm(temporary, { recursive: true, force: true })
      await runtime.extractMinerArchive(archive, temporary, update.artifact.archive)
      await this.verifyPackage(temporary, update.manifest, false, { allowUnsignedDevelopment: false })
      await this.stopAll()
      await fs.promises.mkdir(parent, { recursive: true, mode: 0o700 })
      if (fs.existsSync(this.installedRoot)) await fs.promises.rename(this.installedRoot, backup)
      await fs.promises.rename(temporary, this.installedRoot)
      await fs.promises.rm(backup, { recursive: true, force: true })
      await fs.promises.rm(archive, { force: true })
      this.runtimePromise = null
      this.frontendPackagePromise = null
      this.moduleUpdateCache = null
      this.emit({ type: 'module-installed', version: update.latestVersion, source: 'github-release' })
      return this.status()
    } catch (error) {
      await fs.promises.rm(temporary, { recursive: true, force: true })
      if (!fs.existsSync(this.installedRoot) && fs.existsSync(backup)) await fs.promises.rename(backup, this.installedRoot)
      throw error
    } finally {
      if (this.moduleDownload === downloadState) this.moduleDownload = null
      finishDownload()
    }
  }

  cancelModuleDownload() {
    if (!this.moduleDownload) return { ok: false }
    this.moduleDownload.controller.abort()
    return { ok: true }
  }

  async checkMinerUpdates({ force = false } = {}) {
    const now = Date.now()
    if (!force && this.upstreamUpdateCache && now - this.upstreamUpdateCache.timestamp < UPSTREAM_UPDATE_CACHE_MS) {
      return this.upstreamUpdateCache.value
    }
    const catalog = await this.catalog()
    const platform = hostPlatform()
    const miners = await Promise.all(catalog.miners.map(async (miner) => {
      const currentVersion = miner.releases[0]?.version || null
      try {
        const discovered = miner.updates.provider === 'github-release'
          ? await discoverGitHubReleaseUpdate(miner, platform)
          : await discoverGitHubReadmeUpdate(miner, platform)
        return {
          id: miner.id,
          currentVersion,
          latestVersion: discovered.version,
          updateAvailable: Boolean(currentVersion && compareVersions(discovered.version, currentVersion) > 0),
          installable: true,
          requiresSignedCatalog: false,
          checkedAt: new Date(now).toISOString(),
          ...discovered,
        }
      } catch (error) {
        return {
          id: miner.id,
          currentVersion,
          latestVersion: null,
          updateAvailable: false,
          checkedAt: new Date(now).toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }))
    const value = { checkedAt: new Date(now).toISOString(), miners }
    this.upstreamUpdateCache = { timestamp: now, value }
    this.emit({ type: 'miner-updates-checked', updates: miners.filter((entry) => entry.updateAvailable).length })
    return value
  }

  async downloadMinerArtifact(artifact, destination, options = {}) {
    const source = new URL(artifact.url)
    if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Miner download URL must use HTTPS without credentials')
    await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await fs.promises.rm(destination, { force: true })
    const partial = `${destination}.part`
    let offset = 0
    try {
      const metadata = await fs.promises.lstat(partial)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Publisher artifact cache entry is invalid')
      offset = metadata.size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (offset > MAX_UPSTREAM_ARTIFACT_BYTES) {
      await fs.promises.rm(partial, { force: true })
      offset = 0
    }
    const headers = new Headers()
    if (offset > 0) headers.set('Range', `bytes=${offset}-`)
    const response = await fetch(source, {
      headers,
      redirect: 'follow',
      signal: options.signal,
    })
    const finalUrl = new URL(response.url || source.href)
    if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password) throw new Error('Miner download redirect left HTTPS')
    if (!response.body) throw new Error('Miner download returned an empty response')
    let total = 0
    let resumed = false
    if (offset > 0 && response.status === 206) {
      const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
      if (!match || Number(match[1]) !== offset) throw new Error('Miner download returned an invalid resume range')
      total = Number(match[3])
      resumed = true
    } else if (response.status === 200) {
      offset = 0
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isSafeInteger(declaredLength) && declaredLength > 0) total = declaredLength
    } else {
      throw new Error(`Miner download failed with HTTP ${response.status}`)
    }
    if (total > MAX_UPSTREAM_ARTIFACT_BYTES) throw new Error('Miner download exceeds the local size limit')
    const progressTotal = total || (
      Number.isSafeInteger(artifact.size) && artifact.size > 0 && artifact.size <= MAX_UPSTREAM_ARTIFACT_BYTES
        ? artifact.size
        : 0
    )
    let received = offset
    const body = Readable.fromWeb(response.body)
    body.on('data', (chunk) => {
      received += chunk.length
      if (received > MAX_UPSTREAM_ARTIFACT_BYTES) body.destroy(new Error('Miner download exceeds the local size limit'))
      else options.onProgress?.({ received, total: progressTotal, resumed })
    })
    await pipeline(body, fs.createWriteStream(partial, { flags: offset > 0 ? 'a' : 'w', mode: 0o600 }))
    const metadata = await fs.promises.lstat(partial)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAX_UPSTREAM_ARTIFACT_BYTES) {
      throw new Error('Miner download is not a valid local file')
    }
    const sha256 = await sha256File(partial)
    await fs.promises.rename(partial, destination)
    options.onProgress?.({ received: metadata.size, total: metadata.size, resumed })
    return { ...artifact, size: metadata.size, sha256 }
  }

  async installResolvedMiner(miner, release, source = {}) {
    const id = safeId(miner.id, 'miner identifier')
    if (this.downloads.has(id)) throw new Error('This miner is already downloading')
    let artifact = release.artifacts.find((entry) => entry.platform === hostPlatform())
    if (!artifact) throw new Error('No miner artifact is available for this platform')
    const runtime = await this.runtime()
    const adapter = runtime.miningAdapterRegistry.require(id)
    if (!adapter.supportsMinerVersion(release.version)) throw new Error('The upstream miner version is incompatible with this wallet adapter')
    const executable = adapter.platforms[hostPlatform()]?.executable
    if (!executable) throw new Error('Miner adapter does not support this platform')

    const controller = new AbortController()
    let finishDownload
    const downloadState = {
      controller,
      done: new Promise((resolve) => { finishDownload = resolve }),
    }
    this.downloads.set(id, downloadState)
    const downloadRoot = path.join(this.dataRoot, 'downloads')
    const extension = artifact.archive === 'zip' ? '.zip' : '.tar.gz'
    const archive = path.join(downloadRoot, `${id}-${release.version}${extension}`)
    const minerRoot = path.join(this.dataRoot, 'miners', id)
    const destination = path.join(minerRoot, release.version)
    const temporary = path.join(minerRoot, `${release.version}.install-${randomUUID()}`)
    try {
      const onProgress = (progress) => this.emit({ type: 'miner-download-progress', minerId: id, version: release.version, ...progress })
      artifact = await this.downloadMinerArtifact(artifact, archive, { signal: controller.signal, onProgress })
      await fs.promises.rm(temporary, { recursive: true, force: true })
      await runtime.extractMinerArchive(archive, temporary, artifact.archive)
      const executablePath = resolveInside(temporary, executable, 'miner executable')
      const executableMetadata = await fs.promises.lstat(executablePath)
      if (!executableMetadata.isFile() || executableMetadata.isSymbolicLink()) throw new Error('Downloaded archive does not contain the expected miner executable')
      const executableSha256 = await sha256File(executablePath)
      const files = await minerFileRecords(temporary)
      await fs.promises.mkdir(minerRoot, { recursive: true, mode: 0o700 })
      await fs.promises.rm(destination, { recursive: true, force: true })
      const installMetadata = {
        schemaVersion: 2,
        id,
        displayName: miner.displayName,
        version: release.version,
        platform: hostPlatform(),
        sourceUrl: miner.sourceUrl,
        artifactUrl: artifact.url,
        sha256: artifact.sha256,
        size: artifact.size,
        installedAt: new Date().toISOString(),
        executableRelativePath: executable,
        executableSha256,
        executableSize: executableMetadata.size,
        artifactTrust: source.trust || 'direct-download',
        upstreamSourceUrl: source.sourceUrl || release.sourceUrl || miner.sourceUrl,
        upstreamContentSha: source.upstreamContentSha || null,
        files,
      }
      installMetadata.attestation = await this.attestMinerMetadata(installMetadata)
      await writeJsonAtomic(path.join(temporary, 'altbase-install.json'), installMetadata)
      await fs.promises.rename(temporary, destination)
      const installedExecutable = resolveInside(destination, executable, 'miner executable')
      const installedStat = await fs.promises.lstat(installedExecutable, { bigint: true })
      this.minerVerificationCache.set(`${installedExecutable}\0${installedStat.size}\0${installedStat.mtimeNs}\0${installedStat.ctimeNs}\0${installedStat.ino}`, executableSha256)
      await fs.promises.rm(archive, { force: true })
      this.upstreamUpdateCache = null
      this.emit({ type: 'miner-installed', minerId: id, version: release.version })
      return { ok: true, id, version: release.version, files: files.length }
    } finally {
      try {
        await fs.promises.rm(temporary, { recursive: true, force: true })
      } finally {
        if (this.downloads.get(id) === downloadState) this.downloads.delete(id)
        finishDownload()
      }
    }
  }

  async installMiner(minerId, version) {
    const id = safeId(minerId, 'miner identifier')
    const catalog = await this.catalog()
    const miner = catalog.miners.find((entry) => entry.id === id)
    const release = miner?.releases.find((entry) => entry.version === String(version || ''))
    if (!miner || !release) throw new Error('No configured miner release is available')
    return this.installResolvedMiner(miner, release)
  }

  async installMinerUpdate(minerId, version) {
    const id = safeId(minerId, 'miner identifier')
    const catalog = await this.catalog()
    const miner = catalog.miners.find((entry) => entry.id === id)
    const baseline = miner?.releases[0]
    if (!miner || !baseline) throw new Error('Miner catalog entry is unavailable')
    const requestedVersion = version ? normalizeVersion(version) : null
    if (requestedVersion === baseline.version) return this.installResolvedMiner(miner, baseline)
    const updates = await this.checkMinerUpdates({ force: true })
    const update = updates.miners.find((entry) => entry.id === id)
    if (!update || update.error || !update.latestVersion || !update.artifact) throw new Error(update?.error || 'No upstream miner update is available')
    if (requestedVersion && requestedVersion !== update.latestVersion) throw new Error('The requested miner update is no longer latest')
    if (compareVersions(update.latestVersion, baseline.version) < 0) throw new Error('Upstream latest is older than the trusted catalog release')
    const release = {
      ...baseline,
      version: update.latestVersion,
      publishedAt: update.publishedAt || new Date().toISOString(),
      sourceUrl: update.sourceUrl,
      artifacts: [update.artifact],
    }
    return this.installResolvedMiner(miner, release, update)
  }

  cancelMinerDownload(minerId) {
    const id = safeId(minerId, 'miner identifier')
    const state = this.downloads.get(id)
    if (!state) return { ok: false }
    state.controller.abort()
    return { ok: true }
  }

  async cancelAndWaitForDownloads() {
    const states = [...this.downloads.values(), ...(this.moduleDownload ? [this.moduleDownload] : [])]
    for (const state of states) state.controller.abort()
    await Promise.allSettled(states.map((state) => state.done))
  }

  async removeMiner(minerId, version) {
    const id = safeId(minerId, 'miner identifier')
    const normalizedVersion = String(version || '')
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(normalizedVersion)) throw new Error('Invalid miner version')
    if ([...this.running.values()].some((state) => state.job.miner.id === id && state.job.miner.version === normalizedVersion)) {
      throw new Error('Stop jobs using this miner before removing it')
    }
    await fs.promises.rm(resolveInside(this.dataRoot, `miners/${id}/${normalizedVersion}`, 'miner directory'), { recursive: true, force: true })
    this.minerVerificationCache.clear()
    this.emit({ type: 'miner-removed', minerId: id, version: normalizedVersion })
    return { ok: true }
  }

  logPath(jobId) {
    return resolveInside(this.dataRoot, `logs/${safeId(jobId, 'job identifier')}.log`, 'log file')
  }

  jobRuntimePath(jobId) {
    return resolveInside(this.dataRoot, `jobs/${safeId(jobId, 'job identifier')}/runtime`, 'job runtime directory')
  }

  async clearJobRuntime(jobId) {
    await fs.promises.rm(this.jobRuntimePath(jobId), { recursive: true, force: true })
  }

  redactLogLine(job, line, secrets = []) {
    const address = String(job.payoutAddress || '')
    const masked = address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : '[address]'
    let redacted = String(line || '')
    if (address) redacted = redacted.replaceAll(address, masked)
    for (const secret of secrets) if (secret) redacted = redacted.replaceAll(secret, '<secret>')
    redacted = redacted.replace(/(\bMining Seed:\s*)[A-Fa-f0-9]{32,}\b/gi, '$1<ephemeral>')
    return redacted.replace(/[\r\n]+/g, ' ').trim().slice(0, 4_000)
  }

  updateRuntimeMetrics(state, raw) {
    if (!state?.metrics) return
    const line = String(raw || '').replace(/^\s*\[[^\]]+\]\s*/, '').trim()
    if (!line) return
    const now = Date.now()
    for (const [entry, timestamp] of state.metricLines) {
      if (now - timestamp > METRIC_LINE_DEDUPLICATION_MS) state.metricLines.delete(entry)
    }
    if (state.metricLines.has(line)) return
    state.metricLines.set(line, now)
    const parsed = parseMiningMetricLine(line)
    if (Object.keys(parsed).length === 0) return
    if (Number.isFinite(parsed.hashrateHps)) state.metrics.hashrateHps = parsed.hashrateHps
    if (typeof parsed.hashrateUnit === 'string') state.metrics.hashrateUnit = parsed.hashrateUnit
    if (Number.isSafeInteger(parsed.acceptedShares)) state.metrics.acceptedShares = Math.max(state.metrics.acceptedShares, parsed.acceptedShares)
    else if (Number.isSafeInteger(parsed.acceptedDelta)) state.metrics.acceptedShares += parsed.acceptedDelta
    if (Number.isSafeInteger(parsed.rejectedShares)) state.metrics.rejectedShares = Math.max(state.metrics.rejectedShares, parsed.rejectedShares)
    else if (Number.isSafeInteger(parsed.rejectedDelta)) state.metrics.rejectedShares += parsed.rejectedDelta
    if (Number.isSafeInteger(parsed.staleShares)) state.metrics.staleShares = Math.max(state.metrics.staleShares, parsed.staleShares)
    if (Number.isFinite(parsed.powerWatts)) state.metrics.powerWatts = parsed.powerWatts
    if (Number.isFinite(parsed.temperatureCelsius)) state.metrics.temperatureCelsius = parsed.temperatureCelsius
    state.metrics.lastUpdatedAt = now
    this.emit({ type: 'job-metrics', jobId: state.job.id, metrics: { ...state.metrics } })
  }

  async appendLog(job, source, raw) {
    const state = this.running.get(job.id)
    this.observeStartupLine(state, raw)
    this.updateRuntimeMetrics(state, raw)
    const line = this.redactLogLine(job, raw, state?.redactions || [])
    if (!line) return
    if (state?.logLines) {
      const now = Date.now()
      for (const [entry, timestamp] of state.logLines) {
        if (now - timestamp > LOG_LINE_DEDUPLICATION_MS) state.logLines.delete(entry)
      }
      if (state.logLines.has(line)) return
      state.logLines.set(line, now)
    }
    const filename = this.logPath(job.id)
    const record = `${new Date().toISOString()} [${source}] ${line}\n`
    const previous = this.logWrites.get(job.id) || Promise.resolve()
    const write = previous.catch(() => undefined).then(async () => {
      await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
      let size = this.logSizes.get(job.id)
      if (!Number.isSafeInteger(size)) {
        size = await fs.promises.stat(filename).then((metadata) => metadata.size).catch((error) => {
          if (error?.code === 'ENOENT') return 0
          throw error
        })
      }
      await fs.promises.appendFile(filename, record, { encoding: 'utf8', mode: 0o600 })
      size += Buffer.byteLength(record, 'utf8')
      if (size > MAX_LOG_BYTES) {
        const compacted = compactLogText(await fs.promises.readFile(filename, 'utf8'))
        await fs.promises.writeFile(filename, compacted, { encoding: 'utf8', mode: 0o600 })
        size = Buffer.byteLength(compacted, 'utf8')
      }
      this.logSizes.set(job.id, size)
    })
    this.logWrites.set(job.id, write)
    try {
      await write
    } catch {
      // Logging must never crash a running miner.
    } finally {
      if (this.logWrites.get(job.id) === write) this.logWrites.delete(job.id)
    }
    this.emit({ type: 'log', jobId: job.id, source, line })
  }

  async consumeProcessOutput(state, source, raw, flush = false) {
    const key = source === 'stderr' ? 'stderrRemainder' : 'stdoutRemainder'
    const text = String(state[key] || '') + String(raw || '')
    const lines = text.split(/\r?\n/)
    state[key] = lines.pop() || ''
    for (const line of lines) await this.appendLog(state.job, source, line)
    if (state[key].length > MAX_STREAM_REMAINDER) {
      state[key] = ''
      await this.appendLog(state.job, 'error', `${source} emitted an oversized unterminated line; output was discarded`)
    }
    if (flush && state[key]) {
      await this.appendLog(state.job, source, state[key])
      state[key] = ''
    }
  }

  queueProcessOutput(state, source, raw, flush = false) {
    const queueKey = source === 'stderr' ? 'stderrQueue' : 'stdoutQueue'
    state[queueKey] = (state[queueKey] || Promise.resolve())
      .then(() => this.consumeProcessOutput(state, source, raw, flush))
      .catch(() => undefined)
    return state[queueKey]
  }

  async prepareNativeLogTail(state, processSpec) {
    if (!processSpec.outputLogRelativePath) return
    const relative = safeRelative(processSpec.outputLogRelativePath, 'miner output log')
    const filename = resolveInside(this.dataRoot, relative, 'miner output log')
    const conflict = [...this.running.values()].find((entry) => entry !== state && entry.nativeLogPath === filename && entry.process)
    if (conflict) throw new Error(`Miner output log is already in use by job ${conflict.job.id}`)
    await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    await fs.promises.writeFile(filename, '', { encoding: 'utf8', mode: 0o600 })
    state.nativeLogPath = filename
    state.nativeLogOffset = 0
    state.nativeLogRemainder = ''
  }

  async drainNativeLog(state, flushRemainder = false) {
    if (!state.nativeLogPath) return
    try {
      const metadata = await fs.promises.stat(state.nativeLogPath)
      if (metadata.size < state.nativeLogOffset) state.nativeLogOffset = 0
      while (state.nativeLogOffset < metadata.size) {
        const length = Math.min(256 * 1024, metadata.size - state.nativeLogOffset)
        const handle = await fs.promises.open(state.nativeLogPath, 'r')
        try {
          const buffer = Buffer.allocUnsafe(length)
          const { bytesRead } = await handle.read(buffer, 0, length, state.nativeLogOffset)
          if (bytesRead <= 0) break
          state.nativeLogOffset += bytesRead
          const text = state.nativeLogRemainder + buffer.subarray(0, bytesRead).toString('utf8')
          const lines = text.split(/\r?\n/)
          state.nativeLogRemainder = lines.pop() || ''
          for (const line of lines) await this.appendLog(state.job, 'miner', line)
        } finally {
          await handle.close()
        }
      }
      if (flushRemainder && state.nativeLogRemainder) {
        await this.appendLog(state.job, 'miner', state.nativeLogRemainder)
        state.nativeLogRemainder = ''
      }
      if (state.nativeLogOffset >= MAX_NATIVE_LOG_BYTES) {
        const latest = await fs.promises.stat(state.nativeLogPath)
        if (latest.size === state.nativeLogOffset) {
          await fs.promises.truncate(state.nativeLogPath, 0)
          state.nativeLogOffset = 0
          state.nativeLogRemainder = ''
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') await this.appendLog(state.job, 'error', `Miner log read failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  scheduleNativeLogTail(state) {
    if (!state.nativeLogPath || state.nativeLogTimer || state.stopping) return
    state.nativeLogTimer = setTimeout(() => {
      state.nativeLogTimer = null
      void this.drainNativeLog(state).finally(() => {
        if (this.running.get(state.job.id) === state && state.process && !state.stopping) this.scheduleNativeLogTail(state)
      })
    }, 750)
    state.nativeLogTimer.unref()
  }

  async stopNativeLogTail(state) {
    if (state.nativeLogTimer) clearTimeout(state.nativeLogTimer)
    state.nativeLogTimer = null
    await this.drainNativeLog(state, true)
  }

  async startJob(jobId) {
    const id = safeId(jobId, 'job identifier')
    if (this.running.has(id)) return { ok: true, alreadyRunning: true }
    const job = await this.loadJob(id)
    await this.assertJobHardwarePolicy(job)
    await this.verifyInstalledMinerForJob(job)
    await this.clearJobRuntime(id)
    const state = {
      job,
      process: null,
      exitPromise: null,
      stopping: false,
      pausing: false,
      startedAt: Date.now(),
      restartTimes: [],
      guardTimer: null,
      restartTimer: null,
      nativeLogPath: null,
      nativeLogOffset: 0,
      nativeLogRemainder: '',
      nativeLogTimer: null,
      stdoutRemainder: '',
      stderrRemainder: '',
      stdoutQueue: Promise.resolve(),
      stderrQueue: Promise.resolve(),
      redactions: [],
      metricLines: new Map(),
      logLines: new Map(),
      awaitingStartup: job.miner.id !== 'qli-client',
      startupPromise: null,
      startupResolve: null,
      startupReject: null,
      startupTimer: null,
      startupFailures: 0,
      startupLastFailure: '',
      startupLastFailureAt: 0,
      startupSettled: false,
      metrics: {
        startedAt: Date.now(),
        lastUpdatedAt: null,
        hashrateHps: null,
        hashrateUnit: null,
        acceptedShares: 0,
        rejectedShares: 0,
        staleShares: 0,
        powerWatts: null,
        temperatureCelsius: null,
      },
    }
    this.running.set(id, state)
    try {
      await this.evaluateRuntimeGuard(state)
      if (state.process && state.startupPromise) await state.startupPromise
      if (state.process && state.awaitingStartup) this.emit({ type: 'job-state', jobId: state.job.id, state: 'running' })
      state.awaitingStartup = false
      return { ok: true, jobId: id, state: state.process ? 'running' : 'paused' }
    } catch (error) {
      state.awaitingStartup = false
      if (this.running.get(id) === state) {
        await this.stopJob(id).catch(() => {
          this.running.delete(id)
        })
      }
      throw error
    }
  }

  beginStartupProbe(state) {
    if (!state.awaitingStartup || state.startupPromise) return
    state.startupPromise = new Promise((resolve, reject) => {
      state.startupResolve = resolve
      state.startupReject = reject
    })
    state.startupPromise.catch(() => undefined)
    state.startupTimer = setTimeout(() => {
      this.settleStartupProbe(state, null)
    }, MINER_STARTUP_TIMEOUT_MS)
    state.startupTimer.unref()
    this.emit({ type: 'job-state', jobId: state.job.id, state: 'connecting' })
  }

  settleStartupProbe(state, error = null) {
    if (!state?.startupPromise || state.startupSettled) return
    state.startupSettled = true
    if (state.startupTimer) clearTimeout(state.startupTimer)
    state.startupTimer = null
    if (error) state.startupReject?.(error)
    else state.startupResolve?.({ ready: true })
  }

  observeStartupLine(state, raw) {
    if (!state?.awaitingStartup || state.startupSettled) return
    const classification = classifyMiningStartupLine(raw)
    if (!classification) return
    if (classification.state === 'ready') {
      this.settleStartupProbe(state)
      return
    }
    if (classification.state === 'resource-failed') {
      const detail = this.redactLogLine(state.job, classification.line, state.redactions).replace(/^\s*\[[^\]]+\]\s*/, '')
      this.settleStartupProbe(state, new Error(`Miner memory allocation failed: ${detail}`))
      return
    }
    const now = Date.now()
    if (classification.line === state.startupLastFailure && now - state.startupLastFailureAt <= METRIC_LINE_DEDUPLICATION_MS) return
    state.startupFailures += 1
    state.startupLastFailure = classification.line
    state.startupLastFailureAt = now
    if (state.startupFailures < MINER_STARTUP_FAILURE_LIMIT) return
    const poolUrl = state.job.pools?.[0]?.url || 'the selected pool'
    const detail = this.redactLogLine(state.job, state.startupLastFailure, state.redactions).replace(/^\s*\[[^\]]+\]\s*/, '')
    this.settleStartupProbe(state, new Error(`Pool connection failed for ${poolUrl}: ${detail}`))
  }

  runtimeGuardReason(job) {
    if (job.runtime.pauseOnBattery && this.runtimeEnvironment.isOnBatteryPower?.()) return 'battery power'
    if (job.runtime.idleOnly) {
      const idleSeconds = Number(this.runtimeEnvironment.getSystemIdleTime?.() || 0)
      if (idleSeconds < job.runtime.idleDelayMinutes * 60) return `waiting for ${job.runtime.idleDelayMinutes} minutes of system idle time`
    }
    return null
  }

  scheduleRuntimeGuard(state, delay = 5_000) {
    if (state.guardTimer) clearTimeout(state.guardTimer)
    state.guardTimer = setTimeout(() => {
      state.guardTimer = null
      void this.evaluateRuntimeGuard(state).catch(async (error) => {
        await this.appendLog(state.job, 'error', error instanceof Error ? error.message : String(error))
        this.running.delete(state.job.id)
        this.emit({ type: 'job-state', jobId: state.job.id, state: 'failed', error: error instanceof Error ? error.message : String(error) })
      })
    }, delay)
    state.guardTimer.unref()
  }

  async evaluateRuntimeGuard(state) {
    if (this.running.get(state.job.id) !== state || state.stopping) return
    const reason = this.runtimeGuardReason(state.job)
    if (reason) {
      if (state.process && !state.pausing) {
        state.pausing = true
        await this.appendLog(state.job, 'supervisor', `Pausing for ${reason}`)
        await state.process.stop()
      } else if (!state.process) {
        this.emit({ type: 'job-state', jobId: state.job.id, state: 'paused', reason })
        this.scheduleRuntimeGuard(state)
      }
      return
    }
    if (!state.process) await this.launchJobState(state)
    else this.scheduleRuntimeGuard(state)
  }

  async launchJobState(state) {
    const runtime = await this.runtime()
    const adapter = runtime.miningAdapterRegistry.require(state.job.miner.id)
    const compiled = runtime.compileMiningJob(state.job, adapter, hostPlatform())
    state.redactions = []
    const materialized = await runtime.materializeMiningJob(compiled, {
      resolve: async (reference) => {
        const secret = await this.resolveSecret(state.job.id, reference)
        if (!state.redactions.includes(secret)) state.redactions.push(secret)
        return secret
      },
    })
    await fs.promises.mkdir(this.jobRuntimePath(state.job.id), { recursive: true, mode: 0o700 })
    await runtime.writeRuntimeFiles(this.dataRoot, materialized)
    await this.prepareNativeLogTail(state, materialized.process)
    this.beginStartupProbe(state)
    const running = await runtime.launchMiningProcess(this.dataRoot, materialized.process)
    state.process = running
    state.startedAt = Date.now()
    state.metrics.startedAt = state.startedAt
    running.child.stdout.setEncoding('utf8')
    running.child.stderr.setEncoding('utf8')
    running.child.stdout.on('data', (chunk) => { void this.queueProcessOutput(state, 'stdout', chunk) })
    running.child.stderr.on('data', (chunk) => { void this.queueProcessOutput(state, 'stderr', chunk) })
    running.child.once('error', (error) => void this.appendLog(state.job, 'error', error.message))
    state.exitPromise = new Promise((resolve) => {
      running.child.once('close', (code, signal) => {
        void this.handleJobExit(state, code, signal)
          .catch((error) => this.appendLog(state.job, 'error', error instanceof Error ? error.message : String(error)))
          .finally(resolve)
      })
    })
    await this.appendLog(state.job, 'supervisor', `Started ${state.job.miner.id} ${state.job.miner.version}`)
    if (!state.awaitingStartup) this.emit({ type: 'job-state', jobId: state.job.id, state: 'running' })
    this.scheduleNativeLogTail(state)
    this.scheduleRuntimeGuard(state)
  }

  async handleJobExit(state, code, signal) {
    if (state.guardTimer) clearTimeout(state.guardTimer)
    state.guardTimer = null
    await this.queueProcessOutput(state, 'stdout', '', true)
    await this.queueProcessOutput(state, 'stderr', '', true)
    await this.stopNativeLogTail(state)
    if (state.awaitingStartup && !state.startupSettled) {
      this.settleStartupProbe(state, new Error(`Miner exited before the selected pool supplied work (code ${code ?? 'none'})`))
    }
    state.process = null
    await this.appendLog(state.job, 'supervisor', `Process exited with code ${code ?? 'none'} signal ${signal ?? 'none'}`)
    await this.clearJobRuntime(state.job.id)
    if (state.pausing) {
      state.pausing = false
      this.scheduleRuntimeGuard(state)
      return
    }
    if (state.stopping || !state.job.runtime.restartAfterCrash) {
      this.running.delete(state.job.id)
      this.emit({ type: 'job-state', jobId: state.job.id, state: 'stopped', code, signal })
      return
    }
    const now = Date.now()
    state.restartTimes = state.restartTimes.filter((timestamp) => now - timestamp < 15 * 60_000)
    if (state.restartTimes.length >= 5) {
      this.running.delete(state.job.id)
      await this.appendLog(state.job, 'supervisor', 'Restart limit reached; job stopped')
      this.emit({ type: 'job-state', jobId: state.job.id, state: 'failed', error: 'Restart limit reached' })
      return
    }
    state.restartTimes.push(now)
    const delay = Math.max(5, state.job.runtime.restartDelaySeconds) * 1_000
    this.emit({ type: 'job-state', jobId: state.job.id, state: 'restarting', delayMs: delay })
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null
      if (this.running.get(state.job.id) !== state || state.stopping) return
      void this.evaluateRuntimeGuard(state).catch(async (error) => {
        await this.appendLog(state.job, 'error', error instanceof Error ? error.message : String(error))
        this.running.delete(state.job.id)
        this.emit({ type: 'job-state', jobId: state.job.id, state: 'failed', error: error instanceof Error ? error.message : String(error) })
      })
    }, delay)
    state.restartTimer.unref()
  }

  async stopJob(jobId) {
    const id = safeId(jobId, 'job identifier')
    const state = this.running.get(id)
    if (!state) return { ok: true, alreadyStopped: true }
    state.stopping = true
    if (state.awaitingStartup && !state.startupSettled) {
      this.settleStartupProbe(state, new Error('Miner stopped before the selected pool supplied work'))
    }
    try {
      if (state.guardTimer) clearTimeout(state.guardTimer)
      if (state.restartTimer) clearTimeout(state.restartTimer)
      if (state.process) await state.process.stop()
      if (state.exitPromise) await state.exitPromise
      if (this.running.get(id) !== state) return { ok: true }
      await this.stopNativeLogTail(state)
      await this.clearJobRuntime(id)
      this.running.delete(id)
      this.emit({ type: 'job-state', jobId: id, state: 'stopped' })
      return { ok: true }
    } catch (error) {
      state.stopping = false
      if (this.running.get(id) === state) this.scheduleRuntimeGuard(state)
      throw error
    }
  }

  async stopAll() {
    const results = await Promise.allSettled([...this.running.keys()].map((jobId) => this.stopJob(jobId)))
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), 'One or more mining jobs could not be stopped')
  }

  hasManagedJobs() {
    return this.running.size > 0
  }

  async restoreAutoStart() {
    if (!await this.isInstalled()) return
    for (const job of await this.listJobs()) {
      if (job.runtimeState !== 'invalid' && job.runtime?.startWithWallet) {
        void this.startJob(job.id).catch((error) => this.emit({ type: 'job-state', jobId: job.id, state: 'failed', error: error instanceof Error ? error.message : String(error) }))
      }
    }
  }

  secretPath(jobId) {
    return resolveInside(this.dataRoot, `secrets/${safeId(jobId, 'job identifier')}.json`, 'secret file')
  }

  async setSecret(jobId, secretRef, value) {
    const reference = safeId(secretRef, 'secret reference')
    const secret = String(value || '')
    if (!secret || secret.length > 1_024 || secret.includes('\0')) throw new Error('Secret value is invalid')
    if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('Operating-system secret storage is unavailable')
    const job = await this.loadJob(jobId)
    if (!job.pools.some((pool) => pool.passwordRef === reference)) throw new Error('This mining job does not reference the requested secret')
    const filename = this.secretPath(jobId)
    const stored = await readJson(filename, { schemaVersion: 1, values: {} })
    stored.values[reference] = this.safeStorage.encryptString(secret).toString('base64')
    await writeJsonAtomic(filename, stored)
    return { ok: true }
  }

  async resolveSecret(jobId, secretRef) {
    const reference = safeId(secretRef, 'secret reference')
    const stored = await readJson(this.secretPath(jobId))
    const encoded = stored?.values?.[reference]
    if (!encoded || !this.safeStorage?.isEncryptionAvailable()) throw new Error(`Secret ${reference} is unavailable`)
    return this.safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  }

  async logs(jobId, limit = 400) {
    const capped = Math.max(1, Math.min(MAX_LOG_LINES, Math.floor(Number(limit) || 400)))
    try {
      return (await fs.promises.readFile(this.logPath(jobId), 'utf8')).split(/\r?\n/).filter(Boolean).slice(-capped)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async clearLogs(jobId) {
    if (jobId) {
      const id = safeId(jobId, 'job identifier')
      await this.logWrites.get(id)?.catch(() => undefined)
      await fs.promises.rm(this.logPath(id), { force: true })
      this.logSizes.delete(id)
    } else {
      await Promise.allSettled([...this.logWrites.values()])
      await fs.promises.rm(path.join(this.dataRoot, 'logs'), { recursive: true, force: true })
      this.logSizes.clear()
    }
    this.emit({ type: 'logs-cleared', jobId: jobId || null })
    return { ok: true }
  }

  async clearCache() {
    await this.cancelAndWaitForDownloads()
    await fs.promises.rm(path.join(this.dataRoot, 'downloads'), { recursive: true, force: true })
    return { ok: true }
  }

  async settings() {
    return readJson(path.join(this.dataRoot, 'settings.json'), {
      schemaVersion: 1,
      autoUpdateModule: false,
      autoRefreshCatalog: true,
      telemetry: false,
    })
  }

  async updateSettings(input) {
    const allowed = ['autoUpdateModule', 'autoRefreshCatalog', 'telemetry']
    const current = await this.settings()
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
        if (typeof input[key] !== 'boolean') throw new Error(`Invalid setting: ${key}`)
        current[key] = input[key]
      }
    }
    await writeJsonAtomic(path.join(this.dataRoot, 'settings.json'), current)
    return current
  }
}

module.exports = {
  MiningModuleManager,
  compareModuleReleases,
  hostPlatform,
  resolveHostPlatform,
  parseMiningMetricLine,
  classifyMiningStartupLine,
  compareVersions,
  parsePoolDirectory,
  renderAssetName,
  assetTemplatePattern,
}
