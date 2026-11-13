'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { verifyBundledMining } = require('../scripts/verify-bundled-mining.cjs')
const { MiningModuleManager } = require('../electron/mining-module-manager.cjs')
const { buildManifest } = require('../modules/mining/scripts/build-manifest.cjs')
const { createHash } = require('node:crypto'), tar = require('tar')

test('mining installer code and installed code both stay inside the common module directory', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-common-mining-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const modulesRoot = path.join(root, 'modules'), bundledModuleRoot = path.join(modulesRoot, 'installers/mining')
  const manager = new MiningModuleManager({ isPackaged: false, getPath: () => path.join(root, 'profile'), getAppPath: () => root }, {}, () => {}, { modulesRoot, bundledModuleRoot })
  const source = path.resolve(__dirname, '../modules/mining')
  await manager.cacheBundledPackage(source)
  assert.equal(manager.bundledRoot(), bundledModuleRoot)
  assert.equal(await manager.isInstalled(), false)
  const result = await manager.install()
  assert.equal(result.installed, true)
  assert.equal(manager.installedRoot, path.join(modulesRoot, 'mining'))
  assert.ok(manager.dataRoot.startsWith(path.join(root, 'profile') + path.sep))
  assert.equal((await manager.verifyPackage(bundledModuleRoot)).version, result.installedVersion)
})

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-mining-package-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.resolve(__dirname, '../modules/mining'), target = path.join(root, 'modules/mining')
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.manifest.json'), 'utf8'))
  for (const relative of [...manifest.files.map(f => f.path), 'package.manifest.json']) {
    const destination = path.join(target, relative); fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(source, relative), destination)
  }
  const app = { isPackaged: true, getPath: () => path.join(root, 'isolated-profile'), getAppPath: () => root }
  const manager = new MiningModuleManager(app, {}, () => {})
  manager.bundledRoot = () => target
  return { root, target, manifest, manager }
}

test('packaged wallets accept absent, null and legacy mining signatures without an owner key', async t => {
  const { root, target, manifest, manager } = fixture(t)
  for (const signature of [undefined, null, { algorithm: 'ed25519', keyId: 'independent-fork', value: 'legacy-metadata' }]) {
    if (signature === undefined) delete manifest.signature
    else manifest.signature = signature
    fs.writeFileSync(path.join(target, 'package.manifest.json'), JSON.stringify(manifest))
    assert.equal((await manager.verifyPackage(target)).id, 'mining')
    assert.deepEqual(await verifyBundledMining(root), { id: 'mining', version: manifest.version,
      files: manifest.files.length, integrityVerified: true, signatureRequired: false })
  }
})

test('unsigned mining packages still reject changed bytes, traversal and incompatible wallet APIs', async t => {
  const { root, target, manifest, manager } = fixture(t)
  const runtime = path.join(target, 'dist/src/runtime-bundle.js'), original = fs.readFileSync(runtime)
  fs.appendFileSync(runtime, '\n// fixture test rebuild\n')
  await assert.rejects(verifyBundledMining(root), /verification failed|SHA-256 mismatch/)
  fs.writeFileSync(runtime, original)
  assert.throws(() => manager.validatePackageManifest({ ...manifest, walletApi: { min: '9.0.0', maxExclusive: '10.0.0' } }), /incompatible/)
  manifest.files[0].path = '../outside'
  fs.writeFileSync(path.join(target, 'package.manifest.json'), JSON.stringify(manifest))
  await assert.rejects(verifyBundledMining(root), /path|package file/)
})

test('an independently modified mining module installs and loads in packaged mode without signing', async t => {
  const { target, manager } = fixture(t)
  fs.appendFileSync(path.join(target, 'dist/src/runtime-bundle.js'), '\nexport const independentForkFixture = true;\n')
  const descriptorPath = path.join(target, 'module.json'), descriptor = JSON.parse(fs.readFileSync(descriptorPath))
  descriptor.updates.repository = 'IndependentDeveloper/custom-mining'
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor))
  const manifest = buildManifest(target)
  assert.equal(Object.hasOwn(manifest, 'signature'), false)
  const status = await manager.install()
  assert.equal(status.installed, true)
  assert.equal(status.signatureRequired, false)
  assert.equal(status.updateRepository, descriptor.updates.repository)
  assert.equal((await manager.runtime()).independentForkFixture, true)
  assert.equal((await manager.verify()).ok, true)
  assert.equal(await manager.frontendPath(), path.join(manager.installedRoot, descriptor.frontend))
  assert.equal((await manager.ensureInstalledBundleIsCurrent()).installed, true)
})

test('remote mining discovery and atomic update accept an unsigned fork and preserve miner data', async t => {
  const { root, target, manager } = fixture(t)
  const descriptorPath = path.join(target, 'module.json'), descriptor = JSON.parse(fs.readFileSync(descriptorPath))
  descriptor.updates.repository = 'IndependentDeveloper/custom-mining'
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor)); buildManifest(target)
  await manager.install()
  fs.mkdirSync(manager.dataRoot, { recursive: true })
  fs.writeFileSync(path.join(manager.dataRoot, 'retained.fixture'), 'keep existing scan/job data')
  descriptor.version = '9.0.0'; fs.writeFileSync(descriptorPath, JSON.stringify(descriptor))
  const pkgPath = path.join(target, 'package.json'), pkg = JSON.parse(fs.readFileSync(pkgPath))
  pkg.version = descriptor.version; fs.writeFileSync(pkgPath, JSON.stringify(pkg))
  const manifest = buildManifest(target)
  const archive = path.join(root, 'update.tar.gz')
  await tar.c({ file: archive, cwd: target, gzip: true }, [...manifest.files.map(file => file.path), 'package.manifest.json'])
  const bytes = fs.readFileSync(archive), manifestBytes = Buffer.from(JSON.stringify(manifest))
  const digest = value => createHash('sha256').update(value).digest('hex')
  const base = 'https://github.com/IndependentDeveloper/custom-mining/releases/download/v9.0.0/'
  const asset = (suffix, body) => ({ name: 'altbase-mining-module-9.0.0.' + suffix, state: 'uploaded',
    browser_download_url: base + 'altbase-mining-module-9.0.0.' + suffix, digest: 'sha256:' + digest(body), size: body.length })
  const originalFetch = globalThis.fetch, requests = []
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async url => {
    requests.push(String(url)); let response
    if (url === 'https://api.github.com/repos/IndependentDeveloper/custom-mining/releases/latest') {
      response = Response.json({ tag_name: 'v9.0.0', html_url: 'https://github.com/IndependentDeveloper/custom-mining/releases/tag/v9.0.0',
        assets: [asset('manifest.json', manifestBytes), asset('tar.gz', bytes)] })
    } else if (url === base + 'altbase-mining-module-9.0.0.manifest.json') response = new Response(manifestBytes)
    else throw Error('Unexpected fixture request')
    Object.defineProperty(response, 'url', { value: String(url) }); return response
  }
  manager.bundledRuntime = async () => ({
    downloadVerifiedArtifact: async (artifact, destination) => {
      assert.equal(artifact.sha256, digest(bytes))
      fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes)
    },
    extractMinerArchive: async (file, destination) => {
      fs.mkdirSync(destination, { recursive: true }); await tar.x({ file, cwd: destination })
    },
  })
  const update = await manager.checkModuleUpdates({ force: true })
  assert.equal(update.updateAvailable, true, update.error); assert.equal(Object.hasOwn(update.manifest, 'signature'), false)
  const installed = await manager.installModuleUpdate('9.0.0')
  assert.equal(installed.installedVersion, '9.0.0')
  assert.equal(fs.readFileSync(path.join(manager.dataRoot, 'retained.fixture'), 'utf8'), 'keep existing scan/job data')
  assert.ok(requests.every(url => url.includes('IndependentDeveloper/custom-mining')))
})
