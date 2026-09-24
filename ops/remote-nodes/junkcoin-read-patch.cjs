'use strict'

// Apply after a source backup. This helper never reads service credentials.
function patchJunkcoinReadGateway(source, role) {
  if (!['primary', 'node2'].includes(role)) throw new Error('Unknown gateway role')
  const marker = `// Junkcoin complete UTXO reads (${role}).`
  if (source.includes(marker)) return source
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('Unsupported gateway source layout')
    source = source.replace(before, after)
  }
  if (role === 'primary') {
    replace('const router = new Router()', `${marker}
if (registry.get('junkcoin')) Object.assign(registry.get('junkcoin'), { authoritativeBalance: true, preserveAtomicBalances: true })

const router = new Router()`)
    if (!source.includes('if (adapter.authoritativeBalance === true) return null')) throw new Error('Install authoritative balance guards first')
    return source
  }
  replace("const { AdapterRegistry } = require('./adapters/index.cjs')", "const { AdapterRegistry } = require('./adapters/index.cjs')\nconst { createJunkcoinUtxoReads } = require('./adapters/junkcoinUtxo.cjs')")
  const anchor = '// Altbase wallet-only remote chain adapters. Signing remains client-side.'
  replace(anchor, `${marker}
if (config.coins.junkcoin && registry.get('junkcoin')) {
  Object.assign(registry.get('junkcoin'), createJunkcoinUtxoReads(config.coins.junkcoin))
}

${anchor}`)
  for (const declaration of [
    'const readUtxoBalanceFallback = async (adapter, address, { force = false, fast = true } = {}) => {',
    'const readWalletUtxoBalanceFallback = async (adapter, addresses, primaryAddress) => {',
  ]) replace(declaration, `${declaration}\n  if (adapter.authoritativeBalance === true) return null`)
  replace("adapter.coin === 'neoxa' ? 25_000 : BALANCE_PRIMARY_TIMEOUT_MS", "adapter.coin === 'neoxa' ? 25_000 : Math.max(BALANCE_PRIMARY_TIMEOUT_MS, adapter.balanceTimeoutMs || 0)")
  return source
}

module.exports = { patchJunkcoinReadGateway }
