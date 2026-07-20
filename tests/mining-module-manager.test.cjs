const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  MiningModuleManager,
  assetTemplatePattern,
  classifyMiningStartupLine,
  compareModuleReleases,
  compareVersions,
  parseMiningMetricLine,
  renderAssetName,
  resolveHostPlatform,
} = require('../electron/mining-module-manager.cjs')
const {
  MINING_MODULE_REPOSITORY,
  miningModuleArchiveAssetName,
  miningModuleManifestAssetName,
} = require('../electron/mining-module-trust.cjs')

const repoRoot = path.resolve(__dirname, '..')

const sampleJob = {
  schemaVersion: 1,
  id: 'zano-gpu',
  name: 'Zano GPU',
  coinId: 'zano',
  network: 'mainnet',
  algorithm: 'progpowz',
  payoutAddress: 'Zx7mB2aK8v4sC6pQ9nL3m3Qp',
  workerName: 'Altbase-PC',
  miner: { id: 'rigel', version: '1.23.2', adapterVersion: '1.0.0' },
  profile: 'balanced',
  moduleConfigFile: 'zano-gpu.job.json',
  pools: [{
    id: 'zano-woolypooly-global',
    name: 'WoolyPooly',
    url: 'stratum+ssl://pool.woolypooly.com:3147',
    usernameTemplate: '{wallet}',
    passwordRef: 'pool-password',
    priority: 0,
  }],
  devices: { mode: 'gpu', ids: ['0'], intensity: 'auto', powerLimitPercent: 75, temperatureLimitCelsius: 78 },
  api: { enabled: true, host: '127.0.0.1', port: 5000 },
  options: { '--no-colour': true, '--no-tui': true, '--hashrate-avg': 10, '--log-file': 'logs/zano-gpu.log' },
  runtime: {
    reconnectAttempts: 5,
    connectionTimeoutSeconds: 15,
    statisticsIntervalSeconds: 10,
    restartAfterCrash: true,
    restartDelaySeconds: 15,
    startWithWallet: false,
    keepRunningAfterWalletClose: false,
    pauseOnBattery: true,
    pauseForFullscreen: false,
    idleOnly: false,
    idleDelayMinutes: 10,
  },
}

test('parses metrics emitted by every managed miner log family', () => {
  assert.deepEqual(parseMiningMetricLine('Total: 628.27 H/s'), { hashrateHps: 628.27, hashrateUnit: 'h/s' })
  assert.deepEqual(parseMiningMetricLine('miner speed 10s/60s/15m 180.4 184.5 n/a H/s max 217.5 H/s'), { hashrateHps: 180.4, hashrateUnit: 'h/s' })
  assert.deepEqual(parseMiningMetricLine('CPU: 192.45 H/s [ 3| 1| -| -]'), { acceptedShares: 3, rejectedShares: 1 })
  assert.deepEqual(parseMiningMetricLine('cpu accepted (4/2) diff 1000K'), { acceptedShares: 4, rejectedShares: 2 })
  assert.deepEqual(parseMiningMetricLine('Current hashrate: 14.5 it/s'), { hashrateHps: 14.5, hashrateUnit: 'it/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 4.2 kSol/s'), { hashrateHps: 4200, hashrateUnit: 'sol/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 5.2 kSols/s'), { hashrateHps: 5200, hashrateUnit: 'sol/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 6.2 MS/s'), { hashrateHps: 6_200_000, hashrateUnit: 'sol/s' })
  assert.deepEqual(parseMiningMetricLine('Current speed: 1.2 kIPS'), { hashrateHps: 1200, hashrateUnit: 'it/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 1.5 G/s'), { hashrateHps: 1.5, hashrateUnit: 'graph/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 2.5 kGPS'), { hashrateHps: 2500, hashrateUnit: 'graph/s' })
  assert.deepEqual(parseMiningMetricLine('Current speed: 3.2 MC/s'), { hashrateHps: 3_200_000, hashrateUnit: 'cycle/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 7.2 proofs/s'), { hashrateHps: 7.2, hashrateUnit: 'proof/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 8.3 nonces/s'), { hashrateHps: 8.3, hashrateUnit: 'nonce/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 9.4 keys/s'), { hashrateHps: 9.4, hashrateUnit: 'key/s' })
  assert.deepEqual(parseMiningMetricLine('Total: 10.5 shares/s'), { hashrateHps: 10.5, hashrateUnit: 'share/s' })
  assert.deepEqual(parseMiningMetricLine('Current hashrate: 12.5 Foo/s'), { hashrateHps: 12.5, hashrateUnit: 'foo/s' })
  assert.deepEqual(
    parseMiningMetricLine('[INFO] E:222 | SHARES: 0/0 (R:0) | [AVX2] 1375152 it/s | 1320377 avg it/s'),
    { hashrateHps: 1320377, hashrateUnit: 'it/s', acceptedShares: 0, rejectedShares: 0 },
  )
  assert.deepEqual(parseMiningMetricLine('[INFO] E:222 | [AVX2] 1375152 it/s'), { hashrateHps: 1375152, hashrateUnit: 'it/s' })
  assert.deepEqual(parseMiningMetricLine('CPU share accepted'), { acceptedDelta: 1 })
  assert.deepEqual(parseMiningMetricLine('GPU0 power 122.5 W temp 67 C'), { powerWatts: 122.5, temperatureCelsius: 67 })
})

test('classifies miner startup success and pool failures without confusing hardware warnings', () => {
  assert.equal(classifyMiningStartupLine('net new job from eu.flockpool.com:5555 diff 19669').state, 'ready')
  assert.equal(classifyMiningStartupLine('Connected to pool pool.example.com:443').state, 'ready')
  assert.equal(classifyMiningStartupLine('read error: "end of file"').state, 'failed')
  assert.equal(classifyMiningStartupLine('authorization failed: invalid wallet').state, 'failed')
  assert.equal(classifyMiningStartupLine('Not enough free pages to allocate 2080 MB in HP.').state, 'resource-failed')
  assert.equal(classifyMiningStartupLine('FAILED TO APPLY MSR MOD, HASHRATE WILL BE LOW'), null)
})

test('startup probe ignores duplicate log copies and rejects repeated real pool failures', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-startup-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const events = []
  const manager = new MiningModuleManager({
    isPackaged: false,
    getAppPath: () => repoRoot,
    getPath: () => profile,
  }, {}, (event) => events.push(event))
  const state = {
    job: {
      id: 'startup-test',
      payoutAddress: 'RTestAddress12345',
      pools: [{ url: 'stratum+tcp://pool.example.test:3110' }],
    },
    awaitingStartup: true,
    startupPromise: null,
    startupResolve: null,
    startupReject: null,
    startupTimer: null,
    startupFailures: 0,
    startupLastFailure: '',
    startupLastFailureAt: 0,
    startupSettled: false,
    redactions: [],
  }
  manager.beginStartupProbe(state)
  manager.observeStartupLine(state, 'read error: "end of file"')
  manager.observeStartupLine(state, 'read error: "end of file"')
  assert.equal(state.startupFailures, 1)
  manager.observeStartupLine(state, 'connection refused by remote pool')
  await assert.rejects(state.startupPromise, /Pool connection failed/)
  assert.equal(events[0]?.state, 'connecting')
})

test('managed miner logs stay bounded and retain only the newest output', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-log-limit-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const manager = new MiningModuleManager({
    isPackaged: false,
    getAppPath: () => repoRoot,
    getPath: () => profile,
  }, {}, () => {})
  const job = {
    id: 'bounded-log',
    payoutAddress: 'RTestAddress12345',
  }
  await Promise.all(Array.from({ length: 900 }, (_, index) => (
    manager.appendLog(job, 'miner', `record-${String(index).padStart(4, '0')} ${'x'.repeat(900)}`)
  )))
  const filename = manager.logPath(job.id)
  const metadata = await fs.promises.stat(filename)
  const lines = await manager.logs(job.id, 10_000)
  assert.ok(metadata.size <= 128 * 1024)
  assert.ok(lines.length <= 150)
  assert.doesNotMatch(lines.join('\n'), /record-0000/)
  assert.match(lines.at(-1), /record-0899/)
})

test('duplicate stdout and native miner lines are stored once', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-log-dedup-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const manager = new MiningModuleManager({
    isPackaged: false,
    getAppPath: () => repoRoot,
    getPath: () => profile,
  }, {}, () => {})
  const job = {
    id: 'deduplicated-log',
    payoutAddress: 'RTestAddress12345',
  }
  manager.running.set(job.id, {
    job,
    redactions: [],
    metricLines: new Map(),
    logLines: new Map(),
  })
  await manager.appendLog(job, 'stdout', 'new job from pool.example.test ')
  await manager.appendLog(job, 'miner', 'new job from pool.example.test')
  assert.equal((await manager.logs(job.id, 20)).length, 1)
  manager.running.delete(job.id)
})

test('normalizes upstream miner release names and QLI README assets', () => {
  assert.equal(compareVersions('6.26.1', '6.26.0'), 1)
  assert.equal(compareVersions('v6.26.0', '6.26.0'), 0)
  assert.equal(compareVersions('6.26.0-beta.1', '6.26.0'), -1)
  assert.equal(renderAssetName('SRBMiner-Multi-{version-dashes}-win64.zip', '3.4.7'), 'SRBMiner-Multi-3-4-7-win64.zip')
  const match = 'Windows: https://dl.qubic.li/downloads/qli-Client-3.7.0-Windows-x64.zip'
    .match(assetTemplatePattern('qli-Client-{version}-Windows-x64.zip'))
  assert.equal(match?.groups?.version, '3.7.0')
})

test('orders the 0.1.6 Mining release epoch after the legacy 0.1.25 line', () => {
  assert.equal(compareVersions('0.1.6', '0.1.25'), -1)
  assert.equal(compareModuleReleases(
    { version: '0.1.6', releaseEpoch: 2 },
    { version: '0.1.25', releaseEpoch: 1 },
  ), 1)
  assert.equal(compareModuleReleases(
    { version: '0.1.7', releaseEpoch: 2 },
    { version: '0.1.6', releaseEpoch: 2 },
  ), 1)
})

test('maps every supported desktop host to its miner artifact platform', () => {
  assert.equal(resolveHostPlatform('win32', 'x64'), 'windows-x64')
  assert.equal(resolveHostPlatform('linux', 'x64'), 'linux-x64')
  assert.equal(resolveHostPlatform('darwin', 'x64'), 'macos-x64')
  assert.equal(resolveHostPlatform('darwin', 'arm64'), 'macos-arm64')
  assert.throws(() => resolveHostPlatform('linux', 'arm64'), /does not support linux-arm64/)
})

test('uses the stable Mining module repository and exact 0.1.6 release assets', () => {
  assert.equal(MINING_MODULE_REPOSITORY, 'AltbaseWallet/module-mining')
  assert.equal(miningModuleArchiveAssetName('0.1.6'), 'altbase-mining-module-0.1.6.tar.gz')
  assert.equal(miningModuleManifestAssetName('0.1.6'), 'altbase-mining-module-0.1.6.manifest.json')
})

test('mining payout identity is display-only and always sourced from the wallet host', async () => {
  const [html, frontend, host] = await Promise.all([
    fs.promises.readFile(path.join(repoRoot, 'modules', 'mining', 'frontend', 'index.html'), 'utf8'),
    fs.promises.readFile(path.join(repoRoot, 'modules', 'mining', 'frontend', 'app.js'), 'utf8'),
    fs.promises.readFile(path.join(repoRoot, 'src', 'pages', 'Mining', 'Mining.tsx'), 'utf8'),
  ])
  assert.match(html, /<code id="job-address">Loading from wallet\.\.\.<\/code>/)
  assert.doesNotMatch(html, /<input[^>]+id="job-address"/)
  assert.doesNotMatch(frontend, /value\('#job-address'\)/)
  assert.match(frontend, /state\.miningIdentity\?\.value/)
  assert.match(host, /walletService\.ensurePublicAddress\(coinId\)/)
  assert.match(host, /walletService\.getWalletAddresses\(\)\[coinId\]/)
})

test('simple mining setup exposes four compact choices and one primary start action', async () => {
  const [html, frontend, styles] = await Promise.all([
    fs.promises.readFile(path.join(repoRoot, 'modules', 'mining', 'frontend', 'index.html'), 'utf8'),
    fs.promises.readFile(path.join(repoRoot, 'modules', 'mining', 'frontend', 'app.js'), 'utf8'),
    fs.promises.readFile(path.join(repoRoot, 'modules', 'mining', 'frontend', 'styles.css'), 'utf8'),
  ])
  assert.match(html, /id="quick-coin"/)
  assert.match(html, /id="quick-coin-choices"/)
  assert.match(html, /id="quick-cpu-threads"/)
  assert.match(html, /id="quick-gpu-intensity"/)
  assert.match(html, /id="quick-miner"/)
  assert.match(html, /id="quick-miner-choices"/)
  assert.match(html, /id="quick-pool"/)
  assert.match(html, /id="mining-mini-console"/)
  assert.match(html, /id="job-coin-choices"/)
  assert.match(html, /id="quick-start-dashboard"/)
  assert.match(html, /id="mining-advanced-menu"/)
  assert.match(html, /class="quick-start-content"/)
  assert.doesNotMatch(html, /id="cancel-quick-start"/)
  assert.doesNotMatch(html, /class="module-tabs"/)
  assert.doesNotMatch(styles, /\.job-row > div:nth-child\(4\)/)
  assert.match(frontend, /data-select-job-miner=/)
  assert.match(frontend, /data-use-job-pool=/)
  assert.doesNotMatch(frontend, /data-quick-use-miner=/)
  assert.doesNotMatch(frontend, /data-quick-use-pool=/)
  assert.match(frontend, /openQuickStartForMiner/)
  assert.match(frontend, /openQuickStartForCoin/)
  assert.match(frontend, /chooseQuickPool/)
  assert.match(frontend, /const quickMiner = value\('#quick-miner'\) \|\| state\.quickMinerId/)
  assert.match(frontend, /poolFailures/)
  assert.match(frontend, /Connection failed/)
  assert.match(frontend, /Download & start/)
  assert.match(frontend, /data-job-resource=/)
  assert.match(frontend, /jobResourceSaves/)
  assert.match(frontend, /enhanceThemedSelects/)
  assert.match(frontend, /confirmAction/)
  assert.match(frontend, /const update = await refreshModuleUpdate\(true\)/)
  assert.match(frontend, /update\?\.installable === true/)
  assert.doesNotMatch(frontend, /window\.confirm/)
  assert.doesNotMatch(html, /\stitle="/)
  assert.match(styles, /\.themed-select-menu/)
  assert.match(styles, /\.module-tooltip/)
  assert.match(frontend, /assets\/\$\{escapeHtml\(filename\)\}/)
  assert.match(styles, /\.coin-choice-grid/)
  assert.match(styles, /\.job-resource/)
  assert.match(styles, /#mining-mini-console/)
})

test('RandomSCASH CPU jobs fail preflight before starving the miner dataset', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-memory-preflight-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const manager = new MiningModuleManager({
    isPackaged: false,
    getAppPath: () => repoRoot,
    getPath: () => profile,
  }, {}, () => {}, {
    getFreeMemoryBytes: () => 1024 ** 3,
  })
  const job = {
    ...sampleJob,
    name: 'Scash CPU',
    algorithm: 'randomscash',
    devices: { mode: 'cpu', ids: ['cpu:0'], intensity: 'auto', cpuThreads: 1 },
  }
  await assert.rejects(
    manager.assertJobHardwarePolicy(job),
    /needs at least 2\.5 GB of free memory.*1\.0 GB is available/,
  )
})

test('mining module installs, verifies, stores jobs and removes in an isolated profile', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-manager-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const events = []
  const fakeApp = {
    isPackaged: false,
    getAppPath: () => repoRoot,
    getPath: (name) => {
      assert.equal(name, 'userData')
      return profile
    },
    getGPUInfo: async () => ({
      gpuDevice: [{ vendorId: 0x10de, deviceId: 0x2684, active: true, driverVendor: 'NVIDIA', driverVersion: 'test' }],
      auxAttributes: { glRenderer: 'NVIDIA test GPU' },
    }),
  }
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  }
  let onBattery = true
  let idleSeconds = 0
  const manager = new MiningModuleManager(fakeApp, safeStorage, (event) => events.push(event), {
    isOnBatteryPower: () => onBattery,
    getSystemIdleTime: () => idleSeconds,
  })

  const before = await manager.status()
  assert.equal(before.installed, false)
  assert.equal(before.bundledVersion, '0.1.6')
  const signedManifest = JSON.parse(await fs.promises.readFile(path.join(repoRoot, 'modules', 'mining', 'package.manifest.json'), 'utf8'))
  assert.equal(manager.validatePackageManifest(signedManifest).signature.keyId, 'altbase-mining-406c067310831fba')
  assert.throws(
    () => manager.validatePackageManifest({ ...signedManifest, version: '0.1.7' }),
    /signature verification failed/,
  )
  assert.throws(
    () => manager.validatePackageManifest({ ...signedManifest, signature: null }),
    /signature is missing or untrusted/,
  )

  const installed = await manager.install()
  assert.equal(installed.installed, true)
  assert.equal(installed.verified, true)
  const verification = await manager.verify()
  assert.equal(verification.ok, true)
  assert.equal(verification.version, '0.1.6')
  assert.ok(verification.files >= 50)
  await fs.promises.writeFile(path.join(manager.installedRoot, 'unexpected.bin'), 'not allowed')
  await assert.rejects(() => manager.verify(), /unexpected files/)
  await fs.promises.rm(path.join(manager.installedRoot, 'unexpected.bin'))
  assert.equal((await manager.verify()).ok, true)

  const catalog = await manager.catalog()
  assert.equal(catalog.coins.length, 23)
  assert.deepEqual(catalog.miners.map((entry) => entry.id), ['qli-client', 'rigel', 'srbminer', 'xmrig'])
  assert.ok(catalog.pools.length >= 36)
  assert.ok(catalog.pools.some((entry) => (
    entry.id === 'neoxa-rplant-eu'
    && entry.endpoints.some((endpoint) => endpoint.url === 'stratum+ssl://eu.rplant.xyz:17069')
  )))
  assert.ok(catalog.pools.some((entry) => (
    entry.id === 'quai-k1pool-eu'
    && entry.feePercent === 2
    && entry.minimumPayout === '200 QUAI'
  )))
  assert.ok(catalog.poolDirectory.entries.length >= 250)
  assert.ok(catalog.poolDirectory.entries.some((entry) => (
    entry.coinId === 'raptoreum' && entry.host === 'pool.rplant.xyz'
  )))

  const originalFetch = global.fetch
  const directDownload = path.join(profile, 'direct-miner.zip')
  const partialDownload = `${directDownload}.part`
  await fs.promises.writeFile(partialDownload, 'first-')
  global.fetch = async (_url, options) => {
    assert.equal(options.headers.get('Range'), 'bytes=6-')
    return new Response('second', {
      status: 206,
      headers: { 'content-range': 'bytes 6-11/12' },
    })
  }
  let downloaded
  try {
    downloaded = await manager.downloadMinerArtifact({
      platform: 'windows-x64',
      url: 'https://downloads.example.test/miner.zip',
      sha256: '0'.repeat(64),
      size: 1,
      archive: 'zip',
    }, directDownload)
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(await fs.promises.readFile(directDownload, 'utf8'), 'first-second')
  assert.equal(downloaded.size, 12)
  assert.equal(downloaded.sha256, createHash('sha256').update('first-second').digest('hex'))
  assert.notEqual(downloaded.sha256, '0'.repeat(64))

  const customPool = await manager.saveCustomPool({
    coinId: 'raptoreum',
    algorithm: 'gr',
    displayName: 'Local RTM pool',
    mode: 'pplns',
    region: 'test',
    feePercent: 0.75,
    minimumPayout: 'Pool policy',
    usernameTemplate: '{wallet}.{worker}',
    endpointUrl: 'stratum+ssl://pool.example.test:4443',
  })
  assert.match(customPool.id, /^custom-raptoreum-/)
  assert.equal(customPool.custom, true)
  assert.equal(customPool.feePercent, null)
  assert.equal((await manager.customPools())[0].endpoints[0].url, 'stratum+ssl://pool.example.test:4443')
  const updatedCustomPool = await manager.saveCustomPool({
    ...customPool,
    displayName: 'Updated local RTM pool',
    endpointUrl: 'stratum+tcp://pool.example.test:4444',
  })
  assert.equal(updatedCustomPool.displayName, 'Updated local RTM pool')
  assert.equal((await manager.customPools())[0].endpoints[0].tls, false)
  await assert.rejects(
    () => manager.saveCustomPool({
      coinId: 'raptoreum',
      algorithm: 'gr',
      displayName: 'Credential leak',
      endpointUrl: 'stratum+tcp://user:password@pool.example.test:4444',
      usernameTemplate: '{wallet}',
    }),
    /only a host|credentials|endpoint/i,
  )
  await assert.rejects(
    () => manager.saveCustomPool({
      coinId: 'missing',
      algorithm: 'gr',
      displayName: 'Unknown coin',
      endpointUrl: 'stratum+tcp://pool.example.test:4444',
      usernameTemplate: '{wallet}',
    }),
    /not in the Mining catalog/,
  )
  await manager.removeCustomPool(customPool.id)
  assert.deepEqual(await manager.customPools(), [])

  const qliMiner = catalog.miners.find((entry) => entry.id === 'qli-client')
  let installedRelease = null
  manager.checkMinerUpdates = async () => {
    throw new Error('Baseline installation must not query upstream updates')
  }
  manager.installResolvedMiner = async (miner, release) => {
    installedRelease = { miner, release }
    return { ok: true, id: miner.id, version: release.version }
  }
  assert.deepEqual(
    await manager.installMinerUpdate('qli-client', qliMiner.releases[0].version),
    { ok: true, id: 'qli-client', version: qliMiner.releases[0].version },
  )
  assert.equal(installedRelease.miner.id, 'qli-client')
  assert.equal(installedRelease.release.version, qliMiner.releases[0].version)
  manager.checkMinerUpdates = async () => ({
    miners: [{
      id: 'qli-client',
      currentVersion: qliMiner.releases[0].version,
      latestVersion: '3.7.0',
      updateAvailable: true,
      installable: true,
      requiresSignedCatalog: false,
      artifact: {
        platform: 'windows-x64',
        url: 'https://dl.qubic.li/downloads/qli-Client-3.7.0-Windows-x64.zip',
        sha256: null,
        size: null,
        archive: 'zip',
      },
    }],
  })
  assert.deepEqual(
    await manager.installMinerUpdate('qli-client', '3.7.0'),
    { ok: true, id: 'qli-client', version: '3.7.0' },
  )

  const validated = await manager.validateJob(sampleJob)
  assert.equal(validated.job.id, 'zano-gpu')
  const rigelExecutable = process.platform === 'win32' ? 'rigel.exe' : 'rigel'
  assert.equal(validated.preview.executableRelativePath, `miners/rigel/1.23.2/${rigelExecutable}`)
  await assert.rejects(() => manager.validateJob({ ...sampleJob, runtime: { ...sampleJob.runtime, pauseForFullscreen: true } }), /Fullscreen pause is not supported/)
  await manager.saveJob(sampleJob)
  const jobs = await manager.listJobs()
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].runtimeState, 'stopped')
  assert.equal(jobs[0].payoutAddress, sampleJob.payoutAddress)

  const softwareRendererApp = {
    ...fakeApp,
    getGPUInfo: async () => ({
      gpuDevice: [{ vendorId: 0x1414, deviceId: 0x008c, active: true, driverVendor: 'Microsoft', driverVersion: 'test' }],
      auxAttributes: { glRenderer: 'Microsoft Basic Render Driver' },
    }),
  }
  const softwareRendererManager = new MiningModuleManager(softwareRendererApp, safeStorage, () => undefined)
  await assert.rejects(() => softwareRendererManager.validateJob(sampleJob), /software renderer/)

  await manager.setSecret('zano-gpu', 'pool-password', 'test-only')
  assert.equal(await manager.resolveSecret('zano-gpu', 'pool-password'), 'test-only')

  assert.equal(manager.runtimeGuardReason(sampleJob), 'battery power')
  onBattery = false
  const idleJob = { ...sampleJob, runtime: { ...sampleJob.runtime, pauseOnBattery: false, idleOnly: true, idleDelayMinutes: 10 } }
  assert.equal(manager.runtimeGuardReason(idleJob), 'waiting for 10 minutes of system idle time')
  idleSeconds = 601
  assert.equal(manager.runtimeGuardReason(idleJob), null)

  const minerMetadata = {
    schemaVersion: 2,
    id: 'rigel',
    version: '1.23.2',
    platform: 'windows-x64',
    sourceUrl: 'https://github.com/rigelminer/rigel',
    artifactUrl: 'https://example.invalid/rigel.zip',
    sha256: 'a'.repeat(64),
    size: 100,
    executableRelativePath: 'rigel.exe',
    executableSha256: 'b'.repeat(64),
    executableSize: 50,
    files: [{
      path: 'rigel.exe',
      size: 50,
      sha256: 'b'.repeat(64),
    }],
  }
  minerMetadata.attestation = await manager.attestMinerMetadata(minerMetadata)
  await manager.verifyMinerAttestation(minerMetadata)
  await assert.rejects(() => manager.verifyMinerAttestation({ ...minerMetadata, executableSize: 51 }), /metadata was modified/)

  const fakeMinerRoot = path.join(profile, 'fake-miner')
  await fs.promises.mkdir(fakeMinerRoot, { recursive: true })
  await fs.promises.writeFile(path.join(fakeMinerRoot, 'rigel.exe'), 'verified executable')
  const fakeStat = await fs.promises.stat(path.join(fakeMinerRoot, 'rigel.exe'))
  const fakeMetadata = {
    ...minerMetadata,
    executableSize: fakeStat.size,
    executableSha256: require('node:crypto').createHash('sha256').update('verified executable').digest('hex'),
    files: [{
      path: 'rigel.exe',
      size: fakeStat.size,
      sha256: require('node:crypto').createHash('sha256').update('verified executable').digest('hex'),
    }],
  }
  fakeMetadata.attestation = await manager.attestMinerMetadata(fakeMetadata)
  await manager.verifyInstalledMinerMetadata(fakeMinerRoot, fakeMetadata)
  await fs.promises.writeFile(path.join(fakeMinerRoot, 'rigel.exe'), 'modified executable')
  await assert.rejects(() => manager.verifyInstalledMinerMetadata(fakeMinerRoot, fakeMetadata), /modified|mismatch/)

  manager.running.set('zano-gpu', { redactions: ['super-secret'] })
  assert.equal(manager.redactLogLine(sampleJob, `${sampleJob.payoutAddress} super-secret` , ['super-secret']), 'Zx7mB2...m3Qp <secret>')
  assert.equal(
    manager.redactLogLine(sampleJob, 'Mining Seed: 9362CA74F2A822F44C4913409C648CD220BBA44A50566DDD752FAFFD2B119B04'),
    'Mining Seed: <ephemeral>',
  )
  manager.running.delete('zano-gpu')

  const nativeLogState = {
    job: sampleJob,
    process: {},
    nativeLogPath: null,
    nativeLogOffset: 0,
    nativeLogRemainder: '',
    nativeLogTimer: null,
    redactions: [],
  }
  manager.running.set(sampleJob.id, nativeLogState)
  await manager.prepareNativeLogTail(nativeLogState, {
    cwdRelativePath: 'miners/rigel/1.23.2',
    outputLogRelativePath: 'jobs/zano-gpu/runtime/native-tail-test.log',
  })
  await fs.promises.appendFile(
    nativeLogState.nativeLogPath,
    `${sampleJob.payoutAddress}\nMining Seed: ${'A'.repeat(64)}\n`,
  )
  await manager.drainNativeLog(nativeLogState, true)
  const tailed = await fs.promises.readFile(manager.logPath(sampleJob.id), 'utf8')
  assert.match(tailed, /Zx7mB2\.\.\.m3Qp/)
  assert.match(tailed, /Mining Seed: <ephemeral>/)
  assert.doesNotMatch(tailed, new RegExp(sampleJob.payoutAddress))
  manager.running.delete(sampleJob.id)

  await manager.remove({ preserveData: false })
  assert.equal((await manager.status()).installed, false)
  assert.equal(fs.existsSync(path.join(profile, 'mining')), false)
  assert.ok(events.some((event) => event.type === 'module-installed'))
  assert.ok(events.some((event) => event.type === 'module-removed'))
})

test('initial installation downloads an equal signed 0.1.6 release from GitHub', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-github-install-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const bundledRoot = path.join(profile, 'bundled')
  const events = []
  const manifest = { version: '0.1.6', releaseEpoch: 2 }
  const manager = new MiningModuleManager({
    isPackaged: true,
    getAppPath: () => profile,
    getPath: () => profile,
  }, {}, (event) => events.push(event))

  manager.bundledRoot = () => bundledRoot
  manager.checkModuleUpdates = async () => ({
    latestVersion: '0.1.6',
    updateAvailable: false,
    installable: true,
    manifest,
    artifact: {
      archive: 'tar.gz',
      url: 'https://github.com/AltbaseWallet/module-mining/releases/download/v0.1.6/altbase-mining-module-0.1.6.tar.gz',
    },
  })
  manager.verifyPackage = async () => manifest
  manager.bundledRuntime = async () => ({
    downloadVerifiedArtifact: async (_artifact, destination) => {
      await fs.promises.mkdir(path.dirname(destination), { recursive: true })
      await fs.promises.writeFile(destination, 'signed archive')
    },
    extractMinerArchive: async (_archive, destination) => {
      await fs.promises.mkdir(destination, { recursive: true })
      await fs.promises.writeFile(path.join(destination, 'package.manifest.json'), '{}')
    },
  })
  manager.stopAll = async () => undefined
  manager.status = async () => ({
    installed: await manager.isInstalled(),
    installedVersion: '0.1.6',
  })

  const installed = await manager.installModuleUpdate('v0.1.6')
  assert.equal(installed.installed, true)
  assert.equal(await manager.isInstalled(), true)
  assert.ok(events.some((event) => event.type === 'module-installed' && event.source === 'github-release'))
})

test('new 0.1.6 release epoch supersedes the legacy 0.1.25 installed frontend', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-frontend-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const installedRoot = path.join(profile, 'installed')
  const bundledRoot = path.join(profile, 'bundled')
  await Promise.all([
    fs.promises.mkdir(path.join(installedRoot, 'dist', 'frontend'), { recursive: true }),
    fs.promises.mkdir(path.join(bundledRoot, 'dist', 'frontend', 'assets'), { recursive: true }),
  ])
  const descriptor = {
    schemaVersion: 1,
    id: 'mining',
    frontend: 'dist/frontend/index.html',
  }
  await Promise.all([
    fs.promises.writeFile(path.join(installedRoot, 'module.json'), JSON.stringify(descriptor)),
    fs.promises.writeFile(path.join(bundledRoot, 'module.json'), JSON.stringify(descriptor)),
    fs.promises.writeFile(path.join(installedRoot, 'dist', 'frontend', 'index.html'), 'installed'),
    fs.promises.writeFile(path.join(bundledRoot, 'dist', 'frontend', 'index.html'), 'bundled'),
    fs.promises.writeFile(path.join(bundledRoot, 'dist', 'frontend', 'assets', 'zano.png'), 'zano'),
  ])
  const fakeApp = {
    isPackaged: true,
    getAppPath: () => profile,
    getPath: () => profile,
  }
  const manager = new MiningModuleManager(fakeApp, {}, () => {})
  manager.installedRoot = installedRoot
  manager.bundledRoot = () => bundledRoot
  manager.isInstalled = async () => true
  manager.verifyPackage = async (root) => ({
    version: root === bundledRoot ? '0.1.6' : '0.1.25',
    releaseEpoch: root === bundledRoot ? 2 : 1,
    files: root === bundledRoot
      ? [
          { path: 'dist/frontend/index.html' },
          { path: 'dist/frontend/assets/zano.png' },
        ]
      : [{ path: 'dist/frontend/index.html' }],
  })
  assert.equal(
    await manager.frontendPath(),
    path.join(bundledRoot, 'dist', 'frontend', 'index.html'),
  )
  assert.equal(
    await manager.frontendResourcePath('assets/zano.png'),
    path.join(bundledRoot, 'dist', 'frontend', 'assets', 'zano.png'),
  )
  await assert.rejects(
    manager.frontendResourcePath('assets/unsigned.png'),
    /not covered by the signed manifest/,
  )
})

test('wallet startup replaces legacy Mining 0.1.25 with release epoch 2 version 0.1.6', async (context) => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-mining-startup-upgrade-'))
  context.after(() => fs.promises.rm(profile, { recursive: true, force: true }))
  const installedRoot = path.join(profile, 'installed')
  const bundledRoot = path.join(profile, 'bundled')
  const fakeApp = {
    isPackaged: true,
    getAppPath: () => profile,
    getPath: () => profile,
  }
  const manager = new MiningModuleManager(fakeApp, {}, () => {})
  manager.installedRoot = installedRoot
  manager.bundledRoot = () => bundledRoot
  manager.isInstalled = async () => true
  manager.verifyPackage = async (root) => ({
    version: root === bundledRoot ? '0.1.6' : '0.1.25',
    releaseEpoch: root === bundledRoot ? 2 : 1,
  })
  let installCalls = 0
  manager.install = async () => {
    installCalls += 1
    return { installedVersion: '0.1.6' }
  }

  assert.deepEqual(
    await manager.ensureInstalledBundleIsCurrent(),
    { installedVersion: '0.1.6' },
  )
  assert.equal(installCalls, 1)
})
