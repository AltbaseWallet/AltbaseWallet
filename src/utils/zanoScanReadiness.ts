import type { PrivacyWalletResponse } from '../services/privacyWalletTypes'
import type { NativeReadiness } from '../services/privacyWalletTypes'

/** A native balance can be valid for an old height while the scan is unfinished. */
export const zanoScanReadiness = (response: PrivacyWalletResponse): NativeReadiness => {
  if (!response.ok) return 'error'
  if (!response.serverStatus) return 'syncing'
  let server: { ok?: boolean; ready?: boolean; blocks?: number; headers?: number; indexedHeight?: number }
  try { server = JSON.parse(response.serverStatus) } catch { return 'error' }
  if (!server || server.ok === false) return 'error'
  const tip = Math.max(Number(server.blocks) || 0, Number(server.headers) || 0)
  const scanned = Number(response.lastScannedHeight) || 0
  if (server.ready === false || tip <= 0 || scanned < tip) return 'syncing'
  return 'ready'
}
