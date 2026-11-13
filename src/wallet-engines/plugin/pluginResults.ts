import { toBaseUnits } from '../../utils/decimalAmount'

const invalid = () => { throw new Error('Coin module returned an invalid result') }
export const pluginAddress = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 4096 || [...value].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return invalid()
  return value
}
export const pluginBoolean = (value: unknown): boolean => typeof value === 'boolean' ? value : invalid()
export function pluginAmount(value: unknown, decimals: number): string {
  if (typeof value !== 'string' || value.length > 128 || !/^\d+(?:\.\d+)?$/.test(value)) return invalid()
  const fraction = value.split('.')[1] || ''
  if (fraction.slice(decimals).replace(/0/g, '').length) return invalid()
  return value
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
const atomicFee = (amount: string, value: unknown, decimals: number) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || BigInt(value as number) !== toBaseUnits(amount, decimals)) return invalid()
  return value as number
}
export function pluginFee(value: unknown, decimals: number) {
  const fee = record(value), coin = pluginAmount(fee.coin, decimals)
  if (fee.exact !== undefined && typeof fee.exact !== 'boolean') return invalid()
  return { coin, satoshis: atomicFee(coin, fee.satoshis, decimals), exact: fee.exact as boolean | undefined }
}
export function pluginMax(value: unknown, decimals: number) {
  const result = record(value)
  const amountCoin = pluginAmount(result.amountCoin, decimals), feeCoin = pluginAmount(result.feeCoin, decimals)
  for (const key of ['inputCount', 'remainingInputCount']) {
    if (result[key] !== undefined && (!Number.isSafeInteger(result[key]) || Number(result[key]) < 0)) return invalid()
  }
  return { amountCoin, feeCoin,
    feeSatoshis: result.feeSatoshis === undefined ? undefined : atomicFee(feeCoin, result.feeSatoshis, decimals),
    inputCount: result.inputCount as number | undefined, remainingInputCount: result.remainingInputCount as number | undefined,
    remainingAmountCoin: result.remainingAmountCoin === undefined ? undefined : pluginAmount(result.remainingAmountCoin, decimals) }
}
export function pluginSendResult(value: unknown, decimals: number) {
  const result = record(value)
  if (typeof result.txid !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(result.txid)) return invalid()
  return { txid: result.txid,
    amountCoin: result.amountCoin === undefined ? undefined : pluginAmount(result.amountCoin, decimals),
    feeCoin: result.feeCoin === undefined ? undefined : pluginAmount(result.feeCoin, decimals) }
}
