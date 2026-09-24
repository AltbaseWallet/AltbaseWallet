# Altbase service recovery and website verification — 2026-09-24

## Scope

This follow-up covers the two Altbase hosts: the primary website/API server and node2. Nonsense is a separate project; its servers were not changed in this follow-up. The NNN coin remains in the Altbase catalog and public API checks.

No GitHub source, tag, release or asset was published during the maintenance window ending at 04:27 UTC. The server sources and fixtures were subsequently prepared for a separately authorized source publication, as described below. No wallet transaction was signed, broadcast, repeated or confirmed, and no miner was started. Protected wallet source files and their copies were not opened. Existing wallet profiles, privacy indexes and scan results were preserved. No wallet binary was rebuilt; these changes affect services, backend reads, the website and local verification files.

Detailed local evidence is retained in `local-checks/maintenance-20260924T031506Z/` in the working Altbase directory. Credentials and recovery phrases are excluded from this report and the clean source export.

## Outage and daemon recovery

At 03:15 UTC, six network routes failed because node2 was unreachable from both the workstation and primary server: Neoxa, Terracoin, Raptoreum, Zano, EPIC and Junkcoin. The other 27 routes answered. The host became reachable after the hosting renewal and booted around 03:28 UTC.

The audit found and corrected the following problems:

- Raptoreum's required 90-second startup delay matched systemd's former 90-second startup deadline. Its first boot attempt timed out. `TimeoutStartSec=360` now leaves time for the daemon to start.
- The node2 API was ordered after slow coin daemons. It now starts after the network so a slow chain does not delay unrelated API routes.
- Neoxa 5.2.0 was connected to obsolete 5.1.1.4 peers and remained at height 2266093. Disconnecting those stale peers allowed current peers to supply headers and blocks. It caught up without a restart, reindex or database deletion.
- Junkcoin still ran deprecated 3.1.1 after the mandatory activation height 1145000. The official 4.0.3.1 Linux binary was installed after a clean shutdown and a complete data backup. Its archive SHA-256 was verified against the official GitHub asset: `14927c2f33effd05ebfc578efbc1b9675c8307bc4c9c9357a39412b5b123ab21`.
- Junkcoin v4 used port 9771 for both P2P and the inherited RPC default. RPC now explicitly binds to loopback port 19772, while P2P uses 9771. Backend configuration was updated accordingly. The normal health timer reads the daemon configuration through its CLI.
- Junkcoin rewound to 1144999 to revalidate SegWit data. Connecting peers obtained from its official DNS seeds supplied witness data and allowed it to pass activation and catch up. Consensus verification was not disabled.
- The health timer repeatedly probed the intentionally disabled local Zano daemon. It now skips that explicitly disabled/inactive service, while continuing to check enabled or active local daemons. Zano's configured remote source and existing scan index remain unchanged.
- EPIC's adapter formerly returned the local height as the target and could report ready during nonterminal synchronization stages. It now preserves the target height and reports synchronization until the daemon finishes, including snapshot validation and awaiting-peer stages.

Installed Raptoreum 2.0.3.1 and Terracoin 0.12.2.5 match their current official release lines. EPIC remains on 4.0.2, also used by the independent archive node. The newer [4.0.3 notes](https://github.com/EpicCash/epic/releases/tag/v4.0.3) describe version-check DNS and Windows build changes; [4.0.4](https://github.com/EpicCash/epic/releases/tag/v4.0.4) describes CI/build changes. Neither release note announces a new consensus activation. This audit did not replace the working EPIC daemon merely to change its version number.

Startup units pass `systemd-analyze verify`. Node2 has no failed systemd units or kernel error entries in the audited boot. Retained kernel journals since September 17 likewise contain no error-priority entries; the retained earlier boot ends on September 19. The filesystem is writable and uses 2% of its inodes. The single recorded Raptoreum restart predates its startup correction; other audited daemons report zero automatic restarts. The intentionally disabled local Zano daemon was not enabled: Zano uses its existing official remote source and persisted compact index.

Backups remain on node2 under `/opt/altbase-backups/startup-20260924/`, `/opt/altbase-backups/junkcoin-before-4031-20260924/`, `/opt/altbase-backups/junkcoin-rpc-port-20260924/` and `/opt/altbase-backups/junkcoin-full-reads-20260924/`. The primary gateway backup uses the last directory name on the primary host. Configuration backups remain on their original servers.

Evidence: `node2-startup-fix.json`, `neoxa-peer-recovery.json`, `junkcoin-upgrade.json`, `junkcoin-rpc-port-fix.json`, `node2-kernel-units-check.json`, `node2-timer-storage-audit.json`, `node2-retained-kernel-audit.json`, `node2-health-deployment.json`, `epic-sync-deployment.json` and the timestamped `node2-live-audit-*.json` snapshots.

## Junkcoin complete-balance correction

A funded public mining address exposed a separate adapter defect after the daemon recovered. The old bounded history index returned only 75.05244853 JKC. An independent complete `scantxoutset` returned 855.14376544 JKC across 171 outputs. The initial cold balance request also timed out, and a fast UTXO request incorrectly returned an empty list while the history backfill was unfinished.

A dedicated `junkcoinUtxo.cjs` module now obtains the complete UTXO set, verifies scan completion and totals, applies Junkcoin's 70-block reward maturity, and accounts for mempool spends and change. It serializes scans, coalesces requests and invalidates its short cache when the tip or mempool changes. Only recent outputs need additional maturity RPCs, so old outputs do not each require another request. Existing signing, fee, validation and broadcast code is unchanged.

Both gateways preserve an unavailable balance when this authoritative read fails. They cannot replace it with a partial or spendable-only list. An unfinished scan, missing proof or chain change cannot become a verified zero.

Seventeen fixtures cover maturity boundaries, complete and empty scans, 5000 mature outputs, failed or inconsistent RPC responses, foreign/duplicate outputs, concurrent requests, pending spend/change chains and snapshot invalidation. Five additional EPIC fixtures cover synchronization and scan readiness. The actual source of both deployed gateways was exercised with mocks to verify error propagation and preservation of complete balances.

Production verification returned 855.14376544 JKC and all 171 outputs through the public API, matching the direct node scan. The first production read took 4.359 seconds; UTXO and mempool reads also succeeded. A second public mining address returned 949225.37365046 JKC total, 948890.12604557 spendable and 335.24760489 immature, with 59262 spendable outputs. This large response took 37.423 seconds, including transfer time; it is not an interactive-latency guarantee for very large addresses. These are public chain addresses, not an assertion about any user's wallet balance.

Evidence: `junkcoin-direct-proof.json`, `junkcoin-balance-recheck.json` (old partial result), `junkcoin-fixtures.txt`, `junkcoin-gateway-fixtures.txt`, `junkcoin-read-stage.json`, `junkcoin-production-proof.json`, `junkcoin-maturity-production.json`, `junkcoin-reads-deployment.json` and `junkcoin-large-address-deployment.json`.

## Website and update checks

The production website now lists all 33 wallet coins in its catalog, calculator and homepage demo. BCH, DGB, PPC, ZEC, NEXA, XEL and MWC use their wallet icons and the existing provider selection/fallback structure. Xelis uses the verified `__XEL` LiveCoinWatch identifier. Missing NNN market data stays unavailable rather than becoming a zero price.

Download information, 0.1.9 release changes, Mining 0.1.13/GrandPool information and API/module descriptions were updated in English, German, French, Chinese, Japanese, Russian and Ukrainian. The Windows ZIP asset matcher was corrected for the current filename. Junkcoin's source link now points to the current official repository.

Production browser checks passed for all seven languages, all seven new asset profiles, loaded icons, prices and rendered charts, all 33 demo coins, and a 390-pixel mobile viewport without horizontal overflow. No JavaScript exceptions were recorded. Public API price/chart checks and release checksum checks also passed. Temporary review service and local SSH tunnel were stopped after verification.

The backend already advertises Wallet 0.1.9. Public update checks confirmed that versions 0.1.7 and 0.1.8 receive an available update on Windows, Linux and macOS, while 0.1.9 does not. Links point to the current platform assets. No new release publication was necessary for this service correction.

Evidence: `site-fixtures.json`, `site-stage-api.json`, `site-public-browser.json`, `site-deployment.json`, `site-jkc-link-deployment.json`, `review-cleanup.json` and `public-after-recovery-1.json`.

## Local artifacts and clean source

Removed 38 obsolete artifact files totaling 825945355 bytes: Wallet 0.1.8 packages, the old WASM runtime, obsolete checksums and Mining 0.1.9–0.1.12 packages. `artifacts/` retains Wallet 0.1.9 for Linux, Windows and macOS, the Windows MSI alongside its ZIP, and Mining 0.1.13 packages. Current wallet release SHA-256 values still match the manifest; the standalone Windows MSI matches the MSI inside the ZIP, and all six Mining 0.1.13 payload/manifest hashes match.

The new backend modules, patch helpers, fixtures and this report were copied into `/home/user/Documents/Altbase_GitHub` for local review before source publication was authorized. The subsequent server source commit includes those files, an English integration README, the verification follow-up and their source manifest entries. Its scope excludes wallet modules, protected source files, credentials, release tags and binary assets. GitHub commit history records the publication time. Evidence for local cleanup: `artifact-cleanup.json`, `artifact-final-verification.json` and `artifact-msi-mining-verification.json`.

## Final status

At **2026-09-24T04:27:30.938799+00:00**, all **33/33 public network routes** returned HTTP 200. None reported initial synchronization, and each returned equal block/header heights. Zano and EPIC privacy scan-info returned `ready=true`. The nine platform/version update checks also passed.

| Restored dependency | Public block/header height | Result |
| --- | ---: | --- |
| Neoxa | 2273198 | Available; no reported header lag |
| Terracoin | 3306635 | Available; no reported header lag |
| Raptoreum | 1436373 | Available; no reported header lag |
| Zano | 3873890 | Current compact index; ready |
| EPIC | 3724040 | Daemon caught up; ready |
| Junkcoin | 1145455 | Available; no reported header lag |

At 2026-09-24T04:27:07.959029+00:00, local EPIC and the independent archive both reported `no_sync`, height **3724040**, and the identical block hash `5fa1f9776bb36c88e4a7160d3fe80aad18c98d747cda8e1de85cd7825c03c27a`. A subsequent public scan-info read reached 3724041 with readiness still true. Zano's compact index matched height 3873890 after all API restarts.

Both Altbase hosts have no failed systemd units. Node2 has about 39 GiB free disk, 8 GiB available RAM and unused swap; the primary has about 13 GiB free disk and 12 GiB available RAM. The primary filesystem remains 91% used. No current daemon restart loop was found.

Final evidence: `public-final.json`, `node2-final-audit.json`, `primary-final-audit.json`, `epic-final-independent-proof.json`, `epic-sync-progress.jsonl`, `zano-after-restarts.json`, `node2-health-after-check.json`, `deployed-source-verification.json` and `clean-export-fixtures.txt`.

## Limits retained from earlier verification

This server recovery does not establish that every user profile has completed its local privacy scan. No seeds were opened and no user balances were inferred from unavailable data. Windows desktop installation/runtime and macOS runtime checks from the earlier release verification remain outside this follow-up. Mining share acceptance, payouts and live wallet transfers were not tested.

Junkcoin 4.0.3.1 still emits the upstream `unknown new rules activated (versionbit 21)` warning. It is retained in the audit evidence, not suppressed. Direct Python HTTP queries to the Junkcoin and Neoxa explorers returned 403. Ordinary browser navigation succeeded: Neoxa matched local height 2273169 and block hash `000000000214042cfcee601be44025619b3edbf0729ba77cbce9c2749a22e41e`; the two Junkcoin explorers returned 1145441 and 1145440 in sequential reads. The official Junkcoin explorer also matched the local block hash at height 1145440: `09b673689396b7e8159e9e34dc84a99957d11b8a502aceed2725e96783044f07`. Dedoo did not provide a hash through the tested route (404), so it supports only the height comparison here. Evidence: `independent-browser.json` and `junkcoin-independent-hashes.json`.

Official references: [Raptoreum 2.0.3.01](https://github.com/Raptor3um/raptoreum/releases/tag/2.0.3.01-mainnet), [Terracoin 0.12.2.5](https://github.com/terracoin/terracoin/releases/tag/v0.12.2.5), [Junkcoin 4.0.3.1](https://github.com/Junkcoin-Foundation/junkcoin/releases/tag/v4.0.3.1), [mandatory activation and repository migration](https://github.com/Junkcoin-Foundation/junkcoin-core/releases/tag/v4.0.3), [Junkcoin maturity constant](https://github.com/Junkcoin-Foundation/junkcoin/blob/v4.0.3.1/src/consensus/consensus.h), [Neoxa 5.2.0](https://github.com/NeoxaChain/Neoxa/releases/tag/v5.2.0.0).
