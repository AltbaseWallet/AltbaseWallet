const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MiningModuleManager } = require('../electron/mining-module-manager.cjs')

const root = path.resolve(__dirname, '..')
const minerId = process.argv[2] || 'rigel'
const requestedVersion = process.argv[3] || ''

const run = async () => {
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'altbase-miner-artifact-qa-'))
  let lastPercent = -10
  const app = {
    isPackaged: false,
    getAppPath: () => root,
    getPath: () => profile,
    getGPUInfo: async () => ({ gpuDevice: [], auxAttributes: {} }),
  }
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  }
  const manager = new MiningModuleManager(app, safeStorage, (event) => {
    if (event.type !== 'miner-download-progress') return
    const percent = event.total > 0 ? Math.floor((event.received / event.total) * 100) : 0
    if (percent >= lastPercent + 10 || percent === 100) {
      lastPercent = percent
      console.log(`${event.resumed ? 'resume' : 'download'} ${event.minerId} ${percent}% (${event.received}/${event.total})`)
    }
  })
  try {
    await manager.install()
    const catalog = await manager.catalog()
    const miner = catalog.miners.find((entry) => entry.id === minerId)
    const version = requestedVersion || miner?.releases?.[0]?.version
    if (!miner || !version) throw new Error(`Catalog miner not found: ${minerId}`)
    const result = await manager.installMiner(minerId, version)
    const installed = await manager.installedMiners()
    if (!installed.some((entry) => entry.id === minerId && entry.version === version && entry.state !== 'invalid')) {
      throw new Error('Installed miner metadata was not readable')
    }
    console.log(JSON.stringify({ result, installed }, null, 2))
  } finally {
    await manager.stopAll()
    await fs.promises.rm(profile, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
