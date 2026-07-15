import { toBaseUnits } from './decimalAmount.ts'

export type JsonAmount = number | string

export const coinDecimalsFromSats = (satsPerCoin: number) => {
  if (!Number.isFinite(satsPerCoin) || satsPerCoin <= 1) return 0
  const rounded = Math.round(satsPerCoin)
  if (rounded !== satsPerCoin) return 8
  const text = String(rounded)
  return /^10+$/.test(text) ? text.length - 1 : 8
}

export const coinValueToUnits = (value: JsonAmount | undefined, decimals: number) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0n
    return toBaseUnits(value.toFixed(decimals), decimals)
  }
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return 0n
  return toBaseUnits(value.trim(), decimals)
}

export const sumCoinValuesToUnits = (values: (JsonAmount | undefined)[], decimals: number) =>
  values.reduce((sum, value) => sum + coinValueToUnits(value, decimals), 0n)
