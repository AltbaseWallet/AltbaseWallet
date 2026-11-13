import type { WalletSnapshotCoin } from './coinApiService'

function amount(value: unknown): boolean {
  return (typeof value === 'string' && value.length <= 128 && /^\d+$/.test(value))
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}
const isMap = (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
export function validatePluginSnapshot(coinId: string, input: unknown, networkId?: string, addresses?: string[]): WalletSnapshotCoin {
  if (!input || typeof input !== 'object') throw new Error('Coin module returned an incomplete snapshot')
  const snapshot = input as WalletSnapshotCoin
  if (snapshot.coin !== coinId || !isMap(snapshot.balances) || !isMap(snapshot.histories)) throw new Error('Coin module snapshot identity is invalid')
  if (snapshot.errors?.balance || snapshot.errors?.network) throw new Error('Coin module data is unavailable')
  if (snapshot.network) {
    const n = snapshot.network
    if (n.ok !== true || n.coin !== coinId || typeof n.chain !== 'string' || !n.chain || (networkId && n.chain !== networkId) || !Number.isSafeInteger(n.blocks) || !Number.isSafeInteger(n.headers) || n.blocks < 0 || n.headers < n.blocks || typeof n.initialBlockDownload !== 'boolean') throw new Error('Coin module network state is incomplete')
    if (n.walletScanPercent !== undefined && (!Number.isFinite(n.walletScanPercent) || n.walletScanPercent < 0 || n.walletScanPercent > 100)) throw new Error('Coin module scan progress is invalid')
    if (n.initialBlockDownload || n.headers > n.blocks || (n.walletScanPercent !== undefined && n.walletScanPercent < 100)) {
      return { ...snapshot, walletBalance: null, balances: {}, histories: {}, errors: { ...snapshot.errors, balance: 'Module synchronization is incomplete' } }
    }
  }
  for (const balance of [snapshot.walletBalance, ...Object.values(snapshot.balances)]) {
    if (balance === undefined || balance === null) continue
    if (!snapshot.network) throw new Error('Coin module did not verify its network state')
    if (!['balance', 'balance_spendable', 'received', 'immature'].every(key => amount(balance[key as keyof typeof balance]))) throw new Error('Coin module returned an incomplete balance')
    if (BigInt(balance.balance_spendable) > BigInt(balance.balance)) throw new Error('Coin module spendable balance is inconsistent')
  }
  if (addresses?.length && !snapshot.walletBalance && !addresses.every(address =>
    (Object.hasOwn(snapshot.balances, address) && snapshot.balances[address])
    || (snapshot.network && typeof snapshot.errors?.[`balance:${address}`] === 'string' && snapshot.errors[`balance:${address}`]))) {
    throw new Error('Coin module returned only part of the requested balance')
  }
  return snapshot
}
