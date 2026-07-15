import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

const API_ROOT = 'https://www.virustotal.com/api/v3'
const ROOT = 'C:\\Users\\suqua\\Desktop\\SWAP\\AltbaseWallet\\release\\win-unpacked\\resources\\native-core'
const OUTPUT = 'C:\\Users\\suqua\\Desktop\\SWAP\\VT_NATIVE_CORE_20260712.json'
const SPACING_MS = 15_500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stamp = () => new Date().toISOString()
const log = (message) => console.log(`[${stamp()}] ${message}`)

async function readApiKey() {
  if (process.env.VT_API_KEY) return process.env.VT_API_KEY.trim()
  return new Promise((resolve, reject) => {
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', (chunk) => {
      const key = chunk.trim()
      process.stdin.pause()
      if (!key) reject(new Error('Empty VirusTotal API key'))
      else resolve(key)
    })
  })
}

async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

async function inventory() {
  const names = (await readdir(ROOT)).sort((a, b) => a.localeCompare(b))
  const files = []
  for (const name of names) {
    const path = join(ROOT, name)
    const metadata = await stat(path)
    if (!metadata.isFile()) continue
    files.push({
      name,
      path,
      relative: relative(ROOT, path),
      size: metadata.size,
      sha256: await sha256(path),
    })
  }
  return files
}

let lastRequestAt = 0
let requestCount = 0

async function vtRequest(apiKey, url, options = {}, label, accepted = [200]) {
  for (;;) {
    const wait = Math.max(0, SPACING_MS - (Date.now() - lastRequestAt))
    if (wait) await sleep(wait)
    lastRequestAt = Date.now()
    requestCount += 1
    log(`REQUEST ${requestCount} ${label}`)
    let response
    try {
      response = await fetch(url, {
        ...options,
        headers: { 'x-apikey': apiKey, ...(options.headers || {}) },
        signal: AbortSignal.timeout(10 * 60_000),
      })
    } catch (error) {
      log(`NETWORK_RETRY ${label}: ${error.message}`)
      await sleep(60_000)
      continue
    }
    const body = await response.text()
    if (response.status === 429 || response.status >= 500) {
      log(`HTTP_RETRY ${label}: ${response.status}`)
      await sleep(65_000)
      continue
    }
    if (!accepted.includes(response.status)) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`)
    }
    return { status: response.status, body: body ? JSON.parse(body) : {} }
  }
}

const scanStats = (stats = {}) => ({
  malicious: Number(stats.malicious || 0),
  suspicious: Number(stats.suspicious || 0),
  harmless: Number(stats.harmless || 0),
  undetected: Number(stats.undetected || 0),
  timeout: Number(stats.timeout || 0),
  failure: Number(stats.failure || 0),
  typeUnsupported: Number(stats['type-unsupported'] || 0),
})

const detectionsFrom = (results = {}) => Object.values(results)
  .filter((item) => item && ['malicious', 'suspicious'].includes(item.category))
  .map((item) => ({
    engine: item.engine_name,
    category: item.category,
    result: item.result,
  }))
  .sort((a, b) => String(a.engine).localeCompare(String(b.engine)))

async function save(report) {
  report.updatedAt = stamp()
  report.requests = requestCount
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function loadReport(files) {
  let previous = null
  try {
    previous = JSON.parse(await readFile(OUTPUT, 'utf8'))
  } catch {}
  const sameInventory = previous
    && Array.isArray(previous.files)
    && previous.files.length === files.length
    && files.every((file) => previous.files.some((item) => item.name === file.name && item.sha256 === file.sha256))
  if (sameInventory && previous.status !== 'complete') {
    previous.files = files.map((file) => ({
      ...file,
      ...(previous.files.find((item) => item.name === file.name && item.sha256 === file.sha256) || {}),
    }))
    return previous
  }
  return {
    root: ROOT,
    startedAt: stamp(),
    updatedAt: stamp(),
    status: 'running',
    requestSpacingMs: SPACING_MS,
    files: files.map((file) => ({ ...file, status: 'pending' })),
    requests: 0,
  }
}

async function upload(apiKey, file) {
  const form = new FormData()
  form.append('file', await openAsBlob(file.path), basename(file.path))
  const response = await vtRequest(
    apiKey,
    `${API_ROOT}/files`,
    { method: 'POST', body: form },
    `upload ${file.name}`,
    [200],
  )
  file.analysisId = response.body.data?.id
  if (!file.analysisId) throw new Error(`VirusTotal returned no analysis id for ${file.name}`)
  file.status = 'analyzing'
  file.source = 'upload'
  file.uploadedAt = stamp()
}

async function applyExisting(file, attributes) {
  const stats = scanStats(attributes.last_analysis_stats)
  file.status = 'complete'
  file.source = 'hash-lookup'
  file.checkedAt = stamp()
  file.stats = stats
  file.malicious = stats.malicious
  file.suspicious = stats.suspicious
  file.total = Object.values(stats).reduce((sum, value) => sum + value, 0)
  file.detections = detectionsFrom(attributes.last_analysis_results)
  file.url = `https://www.virustotal.com/gui/file/${file.sha256}/detection`
}

async function lookupOrUpload(apiKey, report, file, index) {
  const response = await vtRequest(
    apiKey,
    `${API_ROOT}/files/${file.sha256}`,
    {},
    `lookup ${file.name}`,
    [200, 404],
  )
  if (response.status === 404) await upload(apiKey, file)
  else await applyExisting(file, response.body.data?.attributes || {})
  log(`${index + 1}/${report.files.length} ${file.name} ${file.status}`)
  await save(report)
}

async function pollAnalysis(apiKey, report, file) {
  const response = await vtRequest(
    apiKey,
    `${API_ROOT}/analyses/${file.analysisId}`,
    {},
    `analysis ${file.name}`,
    [200],
  )
  const attributes = response.body.data?.attributes || {}
  if (attributes.status !== 'completed') {
    log(`ANALYSIS_PENDING ${file.name}`)
    return false
  }
  const stats = scanStats(attributes.stats)
  file.status = 'complete'
  file.checkedAt = stamp()
  file.stats = stats
  file.malicious = stats.malicious
  file.suspicious = stats.suspicious
  file.total = Object.values(stats).reduce((sum, value) => sum + value, 0)
  file.detections = detectionsFrom(attributes.results)
  file.url = `https://www.virustotal.com/gui/file/${file.sha256}/detection`
  await save(report)
  return true
}

async function main() {
  const apiKey = await readApiKey()
  const files = await inventory()
  const report = await loadReport(files)
  await save(report)
  log(`INVENTORY ${files.length} files`)

  for (let index = 0; index < report.files.length; index += 1) {
    const file = report.files[index]
    if (file.status === 'complete' || file.status === 'analyzing') continue
    await lookupOrUpload(apiKey, report, file, index)
  }

  while (report.files.some((file) => file.status === 'analyzing')) {
    for (const file of report.files.filter((item) => item.status === 'analyzing')) {
      await pollAnalysis(apiKey, report, file)
    }
  }

  report.status = 'complete'
  report.finishedAt = stamp()
  report.clean = report.files.filter((file) => file.malicious === 0 && file.suspicious === 0).length
  report.flagged = report.files.length - report.clean
  await save(report)
  for (const file of report.files.filter((item) => item.malicious > 0 || item.suspicious > 0)) {
    for (const detection of file.detections || []) {
      log(`DETECTION ${file.name} ${detection.engine}: ${detection.result}`)
    }
  }
  log(`FINAL clean=${report.clean}/${report.files.length} flagged=${report.flagged}`)
}

main().catch((error) => {
  console.error(`[${stamp()}] FATAL ${error.stack || error.message}`)
  process.exitCode = 1
})
