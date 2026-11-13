Price source follow-up — 2026-10-25

These patches apply after ops/backend/audit-2026-10-25 and retain the earlier
history/cache corrections. They change lib/priceFeed.cjs only on each server.
The primary and secondary feeds are separate variants; apply the matching patch.

Pearl: update the obsolete safe.trade/peatio route to
https://safetrade.com/api/v2/trade/public/tickers/prlusdt
If unavailable, use the independently verified NestEx PRL_USDT market before the
existing CoinPaprika market fallback. Reject mismatched markets/malformed prices.

Neoxa: add the verified neox-neoxa CoinPaprika ticker and include neoxa in the
existing single CoinGecko batch. No new credentials or registrations are needed.

Regression fixtures are in tests/backend-prices.test.cjs. Production source hashes,
backups and deployment times are recorded in manifest.json. Full read-only probes,
GUI evidence and reports are under local-checks/quotes-delist-20261025/.
Hypercoin/Mydogecoin backend routes and catalog entries remain for older wallets.
Their frontend delisting policy lives in src/utils/coinListings.ts.
No GitHub publication, wallet release or real transfer was performed.
