'use strict'
// A spendable-only UTXO list cannot substitute for a confirmed balance: it
// omits immature rewards. Preserve an unavailable result on upstream failure.
const patchAuthoritativeBalances = source => {
  if (source.includes('// Authoritative remote balances: no partial UTXO substitution.')) return source
  const patches = [
    ["const readUtxoBalanceFallback = async (adapter, address, { force = false, fast = true } = {}) => {",
      "const readUtxoBalanceFallback = async (adapter, address, { force = false, fast = true } = {}) => {\n  // Authoritative remote balances: no partial UTXO substitution.\n  if (adapter.authoritativeBalance === true) return null\n"],
    ["const readWalletUtxoBalanceFallback = async (adapter, addresses, primaryAddress) => {",
      "const readWalletUtxoBalanceFallback = async (adapter, addresses, primaryAddress) => {\n  if (adapter.authoritativeBalance === true) return null\n"],
    ["scanAwareTimeout(adapter, BALANCE_PRIMARY_TIMEOUT_MS)",
      "scanAwareTimeout(adapter, Math.max(BALANCE_PRIMARY_TIMEOUT_MS, adapter.balanceTimeoutMs || 0))"],
  ]
  for (const [before, after] of patches) {
    if (!source.includes(before)) throw new Error('Unsupported gateway balance source layout')
    source = source.replace(before, after)
  }
  return source
}
module.exports = { patchAuthoritativeBalances }
if (require.main === module) {
  const fs = require('node:fs'), file = process.argv[2]
  fs.writeFileSync(file, patchAuthoritativeBalances(fs.readFileSync(file, 'utf8')))
}
