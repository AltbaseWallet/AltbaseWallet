import { clsx } from 'clsx'

// Static asset imports — Vite hashes & inlines these into the bundle.
import bitcoinLogo from '../../assets/coins/bitcoin.png'
import bitcoinIILogo from '../../assets/coins/bitcoinII.png'
import bch2Logo from '../../assets/coins/bch2.png'
import btgsLogo from '../../assets/coins/btgs.png'
import firoLogo from '../../assets/coins/firo.png'
import capStashLogo from '../../assets/coins/CapStash.png'
import hypercoinLogo from '../../assets/coins/hypercoin.png'
import mydogecoinLogo from '../../assets/coins/mydogecoin.png'
import pepecoinLogo from '../../assets/coins/pepecoin.png'
import kerriganLogo from '../../assets/coins/kerrigan.png'
import scashLogo from '../../assets/coins/scash.png'
import litecoinIILogo from '../../assets/coins/litecoinii.png'
import neoxaLogo from '../../assets/coins/neoxa.png'
import terracoinLogo from '../../assets/coins/terracoin.png'
import junkcoinLogo from '../../assets/coins/junkcoin.png'
import raptoreumLogo from '../../assets/coins/raptoreum.png'
import zanoLogo from '../../assets/coins/zano.png'
import epicLogo from '../../assets/coins/epiccash.png'
import quaiLogo from '../../assets/coins/quai.png'
import pearlLogo from '../../assets/coins/prl.png'
import qubicLogo from '../../assets/coins/qubic.png'
import kaspaLogo from '../../assets/coins/kaspa.png'
import ckbLogo from '../../assets/coins/ckb.svg'

/** Map ticker → bundled PNG. Lookup is case-insensitive. */
const LOGO_MAP: Record<string, string> = {
  BTC:   bitcoinLogo,
  BC2:   bitcoinIILogo,
  BCH2:  bch2Logo,
  BTGS:  btgsLogo,
  FIRO:  firoLogo,
  CAPS:  capStashLogo,
  HRC:   hypercoinLogo,
  MYDOGE: mydogecoinLogo,
  PEPE:  pepecoinLogo,
  KER:   kerriganLogo,
  SCASH: scashLogo,
  LC2:   litecoinIILogo,
  NEOX:  neoxaLogo,
  TRC:   terracoinLogo,
  JKC:   junkcoinLogo,
  RTM:   raptoreumLogo,
  ZANO:  zanoLogo,
  EPIC:  epicLogo,
  QUAI:  quaiLogo,
  PRL:   pearlLogo,
  QUBIC: qubicLogo,
  KAS:   kaspaLogo,
  CKB:   ckbLogo,
}

/** Fallback gradients for tickers that don't have a bundled PNG (e.g. BMC). */
const FALLBACK_GRADIENTS: Record<string, string> = {
  BMC:  'from-amber-300 to-rose-500',
  NOVA: 'from-cyan-300 to-blue-500',
  ZETA: 'from-violet-300 to-fuchsia-500',
  AUR:  'from-amber-300 to-rose-500',
  LUMA: 'from-teal-300 to-emerald-500',
  KAI:  'from-sky-300 to-indigo-500',
  ORB:  'from-slate-300 to-slate-500',
  FLUX: 'from-lime-300 to-cyan-500',
  ECHO: 'from-pink-300 to-orange-400',
}

export function CoinIcon({ ticker, className }: { ticker: string; className?: string }) {
  const normalizedTicker = ticker.toUpperCase()
  const logo = LOGO_MAP[normalizedTicker]
  if (logo) {
    return (
      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/5', className)}>
        <img
          src={logo}
          alt={ticker}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          className={clsx(
            'pointer-events-none select-none',
            normalizedTicker === 'ZANO'
              ? 'h-[76%] w-[76%] object-contain'
              : normalizedTicker === 'QUBIC'
                ? 'h-[72%] w-[72%] object-contain'
                : normalizedTicker === 'CKB'
                  ? 'h-[66%] w-[66%] object-contain invert'
              : 'h-full w-full rounded-full object-cover',
          )}
          loading="lazy"
          decoding="async"
        />
      </span>
    )
  }
  const gradient = FALLBACK_GRADIENTS[normalizedTicker] ?? FALLBACK_GRADIENTS.NOVA
  return (
    <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-black text-slate-950', gradient, className)}>
      {ticker.slice(0, 2)}
    </div>
  )
}
