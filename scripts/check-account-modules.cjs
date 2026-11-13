'use strict'
// Read-only qualification against PUBLIC burn/system addresses, in an isolated
// temporary profile. This script never derives, prepares, signs or broadcasts.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { PluginManager } = require('../electron/plugins/manager.cjs')
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-publicnode-check-'))
const output = process.argv.find(x => x.startsWith('--output='))?.slice(9) || path.join(root, 'local-checks/account-modules/integrated-publicnode-2026-09-26.json')
const addresses = { ethereum: '0x000000000000000000000000000000000000dEaD', bsc: '0x000000000000000000000000000000000000dEaD', polygon: '0x000000000000000000000000000000000000dEaD', arbitrum: '0x000000000000000000000000000000000000dEaD',
  solana: 'SysvarRent111111111111111111111111111111111', tron: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' }
const tokens = { ethereum: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', solana: 'So11111111111111111111111111111111111111112', tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }
const manager = new PluginManager({ bundledRoot: path.join(root, 'coin-plugins'), installedRoots: [], dataRoot: path.join(directory, 'data'), hostPath: '/not-used' })
const report = { startedAt: new Date().toISOString(), node: process.versions.node, electron: process.versions.electron || null, checks: [], realTransactions: 0, userProfilesOpened: 0 }
function save() { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n') }
async function main() {
  await manager.discover()
  for (const [network, owner] of Object.entries(addresses)) {
    const row = { network, address: owner, at: new Date().toISOString() }
    try {
      const snapshot = await manager.request(network, 'snapshot', { addresses: [owner], includeHistory: false })
      if (!snapshot.network?.ok || snapshot.balances[owner]?.balance === undefined) throw Error('Incomplete native snapshot')
      row.status = 'PASS'; row.height = snapshot.network.blocks; row.nativeAtomic = snapshot.balances[owner].balance
      if (tokens[network]) {
        const imported = await manager.request(network, 'importAsset', { owner, asset: tokens[network] })
        row.token = imported.error ? { status: 'UNAVAILABLE', error: imported.error } : imported.tokens.map(t => ({ id: t.id, symbol: t.symbol, atomic: t.atomic, decimals: t.decimals, status: t.status }))
      }
      row.discovery = (await manager.request(network, 'assets', { owner })).discovery
    } catch (error) { row.status = 'UNAVAILABLE'; row.error = error.message }
    report.checks.push(row); save(); console.log(JSON.stringify(row))
  }
  report.finishedAt = new Date().toISOString(); save()
  if (report.checks.some(row => row.status !== 'PASS')) process.exitCode = 1
}
main().catch(() => { process.exitCode = 1 }).finally(() => { manager.closeSessions(); setTimeout(() => fs.rmSync(directory, { recursive: true, force: true }), 1500) })
