# PublicNode and token discovery qualification

Historical transport report. The implemented modules, final PublicNode-only decision and current GUI/build evidence are in [ACCOUNT-MODULES-2026-09-26.md](ACCOUNT-MODULES-2026-09-26.md).

This is a transport/capability report, not a completed EVM/Solana/Tron wallet release. No account modules have yet been installed into the application's coin catalog. No transactions were signed or submitted, and no real wallet profiles were opened. No backend nodes or indexers were deployed.

## Decisions

The owner authorized PublicNode after successful checks and suggested explorer-based token discovery followed by RPC balance verification. Arkham is being evaluated; no account was created, API plan purchased, or API key supplied during these checks. Nothing was published.

## Confirmed connection fixes

1. Python's default User-Agent consistently returned Cloudflare HTTP 403/code 1010. The same six network reads with `AltbaseFullNode/0.1.2` succeeded without registration/API keys. Evidence: `local-checks/account-modules/publicnode-user-agent.json` (20:33–20:34 UTC).
2. Electron 43.1.1 / Node 24.18.0's default fetch connection race failed with IPv4 ETIMEDOUT and IPv6 ENETUNREACH. An HTTPS agent with a 2-second address-family attempt timeout succeeded; IPv6 and normal certificate/hostname verification remain enabled. No global DNS/TLS setting changed.
3. `modules/account-common/publicnode.cjs` now supplies that isolated HTTPS transport, an honest User-Agent, read-method allowlists, bounded read retries, request deadlines and response-size limits. Large atomic JSON integers are preserved as strings. A rejected or unavailable RPC never becomes a zero balance. The distinct broadcast path has no retries; only offline mocks exercised it.

Linux Node qualification: `local-checks/account-modules/publicnode-linux-runtime.json`. Linux Electron qualification before/after the connection fix: `publicnode-linux-electron.json` and `publicnode-linux-electron-fixed.json`. The final Electron run completed at 20:44:56 UTC and verified the correct chain identity for all six networks.

## Capability results

| Network | Anonymous PublicNode checks | Token-discovery limit |
|---|---|---|
| Ethereum | Chain ID 1, height, gas price, native balance, single-block Transfer logs | A multi-block log request without a token-contract filter returned RPC -32701. A single-block request succeeded. The earlier blanket claim that every log request needs a contract was too broad. |
| BSC | Chain ID 56, height, gas price, native balance, single-block Transfer logs | Same multi-block restriction; single-block reads succeeded. |
| Polygon | Chain ID 137, height, gas price, native balance, single-block Transfer logs with actual results | Same multi-block restriction; single-block reads succeeded. |
| Arbitrum | Chain ID 42161, height, gas price, native balance, single-block Transfer logs | Same multi-block restriction; single-block reads succeeded. |
| Solana | Mainnet genesis hash and parsed wrapped-SOL mint/9 decimals | `getTokenAccountsByOwner` for the classic SPL program returned HTTP 403/Request blocked; Token-2022 returned HTTP 403 and an explicit personal-token requirement. These are unavailable discovery checks, not empty holdings. |
| Tron | Mainnet genesis block, latest/finalized height, account data, read-only USDT decimals=6 | PublicNode is a node endpoint, not the TronGrid address indexer: `/v1/accounts/...` GET returned 404. |

All owner arguments in the probes were public burn/system addresses. No user addresses or secrets were sent. Raw read evidence: `publicnode-capabilities.json`; reusable qualification command: `node scripts/check-publicnode.cjs --output=<report.json>`.

## Explorer plus RPC approach

The proposed split is technically valid: an explorer supplies candidate chain/contract or mint identities; RPC independently verifies the chain, token metadata and current balances. Pagination/completeness must remain explicit. Explorer quantities are not used as an unquestioned spendable balance. Icons and spam classification need separate validated metadata; neither is guaranteed merely because an RPC endpoint works.

Anonymous live probes (`local-checks/account-modules/explorer-keyless.json`):

- Routescan Ethereum holdings returned HTTP 200 with token contracts and a next-page cursor. This confirms a candidate discovery source, not a complete account scan (only two rows were requested).
- Routescan BSC/Polygon/Arbitrum returned HTTP 400 for unsupported chains. They must never be interpreted as empty accounts.
- Arbitrum Blockscout returned HTTP 200 with 50 ERC-20 rows and a next-page cursor. Its current documentation deprecates per-instance APIs in favor of its authenticated PRO API; anonymous availability is not a durable guarantee.
- Ethereum and Polygon Blockscout timed out at 20 seconds; unavailable, not zero.
- TronScan's documented account-token route returned HTTP 401 without a key.

Sources: [Routescan keyless plan](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing), [supported chains](https://routescan.io/docs/getting-started/supported-chains), [Blockscout API migration](https://docs.blockscout.com/devs/apis), [TronScan account tokens](https://docs.tronscan.org/en/api/account/account-tokens).

## Arkham evaluation

[Arkham's API page](https://arkm.com/api) lists Ethereum, BNB, Polygon, Arbitrum, Solana and Tron. Its [address-balances endpoint](https://arkm.com/llms/get-balances-address-address.md) documents chain-specific token arrays, contract identifiers and exact balances. This fits the proposed discovery role; live coverage, tiny/unpriced/spam tokens, Solana account enumeration and icons remain unverified without access.

[Getting Access](https://arkm.com/llms/guides/getting-access.md) requires an account, approved trial/API plan and generated key. Subscriptions start at $100. The [credit guide](https://arkm.com/llms/guides/credit-pricing.md) lists 100,000 credits for an individual trial and 1,000,000 for an organization trial; exhausted trials pause. A normal registration is not sufficient evidence of API entitlement. No paid plan is needed for our initial qualification if trial access is granted.

## Validation and outstanding work

- Six transport unit tests pass: headers/exact integers, bounded retries, rejected reads, no submission through read routes, single-attempt uncertain mock broadcast, explicit authentication restriction, size/deadline checks. Existing account-amount/spam and archive tests also passed (12 total in the combined run).
- Legacy Solana SDK dependencies introduced high/moderate advisories. Replaced them with pinned official `@solana/kit` and program SDK packages. Current npm audit reports 9 low, 0 moderate/high/critical findings; earlier audited elliptic/CKB vendors were preserved. Evidence: `dependency-audit-current.json`.
- Windows SSH on the existing relay reset the connection before the SSH banner at 20:41:05 UTC. No Windows runtime check ran. Evidence: `publicnode-windows-launch.json`.
- A portable read-only diagnostic bundle was built on Linux/CPU 0; this is not a rebuilt wallet release.
- EVM/SOL/TRX runtime modules, account-token UI, full discovery/metadata validation and backend-driven automatic module activation remain unfinished. The transport proof must not be presented as completion of those features.
