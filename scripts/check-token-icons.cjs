'use strict'
// Explicit diagnostic imports of public token contracts. This script is not
// included in the application and performs no startup/bulk logo preload.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { createIconCache, iconIdentity } = require('../modules/account-common/icons.cjs')
const { PNG } = require('pngjs')
const contracts = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', bsc: '0x55d398326f99059fF775485246999027B3197955',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-icon-live-')), rows = []
async function main() {
  for (const [network, contract] of Object.entries(contracts)) {
    const directory = path.join(root, network), cache = createIconCache(network, directory), row = { network, contract, at: new Date().toISOString() }
    const result = await cache.load(contract)
    row.status = result.status
    if (result.status === 'cached') {
      const bytes = fs.readFileSync(path.join(directory, 'token-icons', result.key + '.png')), png = PNG.sync.read(bytes)
      Object.assign(row, { width: png.width, height: png.height, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), source: iconIdentity(network, contract).url })
      const offline = createIconCache(network, directory, { fetchImpl: () => { throw Error('Network forbidden on cache hit') } })
      row.offlineCachePass = (await offline.load(contract)).status === 'cached'
    } else process.exitCode = 1
    rows.push(row); console.log(JSON.stringify(row))
  }
  fs.writeFileSync(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || path.resolve(__dirname, '../local-checks/account-modules/token-icons-live-2026-09-26.json'), JSON.stringify({ at: new Date().toISOString(), electron: process.versions.electron || null,
    checks: rows, bundledTokenImages: 0, productionProfilesOpened: 0 }, null, 2) + '\n')
}
main().catch(() => { process.exitCode = 1 }).finally(() => fs.rmSync(root, { recursive: true, force: true }))
