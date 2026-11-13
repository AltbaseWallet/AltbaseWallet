import { useEffect, useState, type ReactNode } from 'react'

function CachedTokenIcon({ url, symbol, fallback }: { url: string; symbol: string; fallback: ReactNode }) {
  const [attempt, setAttempt] = useState(0), [failedAttempt, setFailedAttempt] = useState(-1)
  const failed = failedAttempt === attempt
  useEffect(() => {
    if (!failed) return
    // A temporary local protocol/file error must not suppress a logo for the
    // lifetime of the row. Retries stay local and back off to once per 32 s.
    const timer = window.setTimeout(() => setAttempt(value => value + 1), 1000 * 2 ** Math.min(attempt, 5))
    return () => window.clearTimeout(timer)
  }, [failed, attempt])
  return failed ? fallback : <img src={`${url}&retry=${attempt}`} alt={symbol} data-testid="token-downloaded-icon" className="h-full w-full object-contain" loading="lazy" decoding="async" draggable={false} onError={() => setFailedAttempt(attempt)} />
}

export function TokenIcon({ network, contract, symbol, icon }: { network: string; contract: string; symbol: string; icon?: { key?: string; status: string; revision?: string } }) {
  const revision = /^[a-f0-9]{16}$/.test(icon?.revision || '') ? icon?.revision : '1'
  const url = icon?.status === 'cached' && /^[a-f0-9]{64}$/.test(icon.key || '') ? `altbase-coin://tokens/${encodeURIComponent(network)}/${icon.key}?v=${revision}` : null
  // Stable local identicon for an absent logo. Never match another token's logo
  // by ticker/name; the network and full contract determine both lookup paths.
  let hash = 2166136261
  for (const char of network + ':' + contract) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  const cells = []
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if ((hash >>> (y * 3 + x)) & 1) {
      cells.push(<rect key={`${x}:${y}`} x={x * 8 + 4} y={y * 8 + 4} width="8" height="8" />)
      if (x !== 2) cells.push(<rect key={`${4 - x}:${y}`} x={(4 - x) * 8 + 4} y={y * 8 + 4} width="8" height="8" />)
    }
  }
  const fallback = <svg viewBox="0 0 48 48" role="img" aria-label={symbol} data-testid="token-generated-icon" fill={`hsl(${hash % 360} 65% 65%)`}>{cells}</svg>
  return <span aria-busy={icon?.status === 'loading'} className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-800 ${icon?.status === 'loading' ? 'animate-pulse' : ''}`}>
    {url ? <CachedTokenIcon key={url} url={url} symbol={symbol} fallback={fallback} /> : fallback}
  </span>
}
