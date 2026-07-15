const DEFAULT_DECIMALS = 8

const cleanDecimal = (value: string) => value.replace(/[^0-9.]/g, '')

export const toBaseUnits = (value: string | number, decimals = DEFAULT_DECIMALS): bigint => {
  const text = cleanDecimal(String(value ?? '').trim())
  if (!text) return 0n

  const [whole = '0', fraction = ''] = text.split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  const safeWhole = whole.length === 0 ? '0' : whole

  return BigInt(safeWhole) * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

export const fromBaseUnits = (units: bigint, decimals = DEFAULT_DECIMALS): string => {
  const negative = units < 0n
  const absolute = negative ? -units : units
  const factor = 10n ** BigInt(decimals)
  const whole = absolute / factor
  const fraction = (absolute % factor).toString().padStart(decimals, '0').replace(/0+$/, '')
  const formatted = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`
  return negative ? `-${formatted}` : formatted
}

export const addAmounts = (a: string | number, b: string | number, decimals = DEFAULT_DECIMALS) =>
  fromBaseUnits(toBaseUnits(a, decimals) + toBaseUnits(b, decimals), decimals)

export const compareAmounts = (a: string | number, b: string | number, decimals = DEFAULT_DECIMALS) => {
  const aa = toBaseUnits(a, decimals)
  const bb = toBaseUnits(b, decimals)
  if (aa === bb) return 0
  return aa > bb ? 1 : -1
}
