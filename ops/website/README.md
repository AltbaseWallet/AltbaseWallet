# Homepage wallet preview

The public preview mirrors the shipped Altbase Wallet dashboard: sidebar,
portfolio card, coin rows, expandable network token controls, history, mining
and module pages. Thirty-five initial sample balances are positive. They are
illustrations, clearly labelled as demo balances, not user wallets or deposits.
Swap stays disabled to match the desktop application. All interactions stay
inside the demo; no keys, real addresses, signatures or broadcasts are used.

`demo-prices.cjs` reads the existing public Altbase wallet price feed. It retains
per-coin timestamps, rejects invalid/future/expired quotes, coalesces overlapping
requests and caches for 30 seconds. The public `GET /api/wallet-demo-prices`
route returns the sanitized data. Allow GET only and add `/demo-prices.cjs` to
the static-file deny list when integrating it into the site's existing server.
The client refreshes every minute, on visibility and on demand, with a timeout.
Only priced balances contribute to the displayed known market value. Unavailable
or expired prices display a dash, never an invented dollar amount or zero.

`public` contains only public frontend files. The existing private marketing
server, administration routes and server credentials are not part of this export.
Keep the main stylesheet and existing public images from the full website when
using this patch. `main.js` includes all seven supported interface languages.

The preview can be deployed independently of wallet releases; it does not modify
installed desktop applications, modules or wallet profiles.

The single active-asset catalog is `asset-catalog.json`. The directory and demo
read its generated browser payload directly. After changing metadata, run
`node ops/website/build-catalog.cjs` to regenerate the runtime payload, all public
network footers and the three duplicated homepage marquee tracks. Run it with
`--check` to reject missing or stale surfaces. The catalog matches all 35 active
wallet module IDs; archive metadata is excluded from current listings.

The demo has separate readable unit-price fields in both Portfolio and Coins.
Dated quotes may be restored from the browser's public-price cache, then refreshed.
Expired entries are rejected. The language selector updates only changed DOM
values, so translation observation settles instead of scheduling endless full-page
passes. Regression: `node --test ops/website/i18n-idle.test.cjs`.

The public patch also includes every public developer page and shared network
navigation. The retired Nonsense/Hypercoin/Mydogecoin/BTGS adapters are excluded
from current-engine tables. EVM, Solana and Tron use PublicNode directly; wallet
pricing remains supplied by the Altbase backend. Existing base styles and coin
images are still required from the complete website installation.

`market-fallback.cjs` bounds slow market-statistic requests and can retain a fresh
native quote from the same wallet feed. Fallback results identify their source
and date; unavailable volume, capitalization, history and venue counts are not
invented. Both HTTP and browser price-only caches use a 30-second lifetime. The
client retries selected incomplete markets and bounds network waits. The source
registry for this helper is generated at `public/assets/data/asset-catalog.json`.
