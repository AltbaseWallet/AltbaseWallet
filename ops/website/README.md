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
