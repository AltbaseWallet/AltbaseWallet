const DEFAULT_DECIMALS = 8

export const toBaseUnits = (value: string | number, decimals = DEFAULT_DECIMALS): bigint => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Invalid amount precision')
  const text = String(value ?? '').trim()
  if (!text) return 0n
  if (text.length > 256) throw new Error('Invalid decimal amount')
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match) throw new Error('Invalid decimal amount')
  const exponent = Number(match[3] || 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 256) throw new Error('Invalid decimal exponent')
  const [whole, fraction = ''] = match[2].split('.')
  const digits = BigInt((whole || '0') + fraction)
  const shift = decimals + exponent - fraction.length
  // Retain truncation toward zero for sub-atomic display arithmetic. Send
  // validation separately rejects amounts with non-zero sub-atomic digits.
  const units = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift)
  return match[1] === '-' ? -units : units
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
