const DEFAULT_COIN_DECIMALS = 8

const COIN_DECIMALS: Record<string, number> = {
  ZANO: 12,
}

const normalizeDecimalText = (value: string | number, decimals: number) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const fixedDecimals = Math.min(20, Math.max(decimals + 6, decimals))
    return value.toFixed(fixedDecimals).replace(/0+$/, '').replace(/\.$/, '')
  }

  const text = String(value ?? '').trim().replace(/,/g, '')
  if (!text) return null
  if (/e/i.test(text)) {
    const numeric = Number(text)
    if (!Number.isFinite(numeric)) return null
    const fixedDecimals = Math.min(20, Math.max(decimals + 6, decimals))
    return numeric.toFixed(fixedDecimals).replace(/0+$/, '').replace(/\.$/, '')
  }
  return text
}

const formatCoinAmount = (value: string | number, decimals: number) => {
  const normalized = normalizeDecimalText(value, decimals)
  if (!normalized || !/^-?\d*(\.\d*)?$/.test(normalized)) return String(value)

  const negative = normalized.startsWith('-')
  const unsigned = negative ? normalized.slice(1) : normalized
  const [wholeRaw = '0', fractionRaw = ''] = unsigned.split('.')
  const whole = (wholeRaw.replace(/^0+(?=\d)/, '') || '0')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = fractionRaw.slice(0, decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export const formatAmount = (value: string | number, ticker?: string) => {
  const decimals = COIN_DECIMALS[ticker?.toUpperCase() ?? ''] ?? DEFAULT_COIN_DECIMALS
  const amount = formatCoinAmount(value, decimals)
  return ticker ? `${amount} ${ticker}` : amount
}

export const formatUsd = (value?: number) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    : 'N/A'

/**
 * Format a USD unit price with enough precision to be useful for sub-cent
 * altcoins. For values ≥ $0.01 it behaves like the standard USD formatter;
 * below that it auto-scales the number of decimals so the price is never
 * displayed as a misleading "$0.00".
 */
export const formatUsdPrice = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value >= 0.01) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      maximumFractionDigits: value >= 1 ? 4 : 4,
    }).format(value)
  }
  if (value >= 0.000001) {
    // 6 decimals is enough for ~$0.0001–$0.01
    return '$' + value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
  }
  // Very small: 4 significant figures, lossless for display
  return '$' + value.toPrecision(4)
}
