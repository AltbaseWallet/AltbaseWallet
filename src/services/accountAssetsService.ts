import { pluginService } from './pluginService'
import { coinModuleRegistry } from '../coin-modules'
export type AccountToken = { id: string; name: string; symbol: string; decimals: number; amount: string; atomic: string;
  standard: string; visible: boolean; status: 'verified' | 'partial' | 'unavailable'; verifiedAt: number;
  assessment: { classification: string; reasons: string[] }; override?: 'show' | 'hide'; icon?: { key?: string; status: string; revision?: string } }
export type AccountInventory = { network: string; owner: string; updating: boolean;
  discovery: { complete: boolean; reason?: string; checkedAt?: number; candidates?: number }; tokens: AccountToken[];
  receipts: Array<{ txid: string; status: string; at: number; amount: string }> }
export type TransferPreview = { planId: string; expiresAt: number; network: string; owner: string; to: string; asset: string | null;
  symbol: string; amount: string; fee: string; rent: string; nativeRequired: string; feeSymbol: string }
export const isAccountModule = (id: string) => coinModuleRegistry.descriptor(id)?.capabilities.includes('assets') === true
export async function accountRequest<T>(coin: string, method: string, params: Record<string, unknown>): Promise<T> {
  const result = await pluginService.request<T & { error?: string }>(coin, method, params)
  if (result?.error) throw new Error(result.error)
  return result
}
