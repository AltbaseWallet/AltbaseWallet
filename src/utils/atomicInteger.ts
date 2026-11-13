// Optional absent fields have no contribution. Supplied malformed or rounded
// values must fail verification rather than silently becoming zero.
export function atomicAmountToBigInt(value: unknown): bigint {
  if (value === undefined || value === null) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' && value.length <= 128 && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  throw new Error('Invalid or unsafe atomic amount')
}
