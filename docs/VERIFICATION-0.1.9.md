# Altbase Wallet 0.1.9 verification

## Scope and evidence

Checks performed on 2026-09-23–24 UTC (2026-09-24 in Europe/Zurich). Evidence is retained locally under `local-checks/grandpool-0.1.9/`; fixture profiles and completed scan data are preserved and excluded from published source. Production reads use public addresses, not recovery phrases. No transaction broadcast, user-wallet signing, transfer confirmation or pool-share submission occurred.

The GrandPool public APIs listed BTC, BCH, DGB, PPC, ZEC, MWC, PRL, XEL and NEXA. BCH, DGB, PPC, ZEC, MWC, XEL and NEXA have separate new module repositories. BTC/PRL retain their existing modules. Prices use verified provider identifiers, including `__XEL` for Xelis rather than the unrelated Elastic/XellyCoin symbols.

## Passing checks

- `all-tests-final-fixes.txt`: 172 wallet/backend fixtures; `all-tests-final.txt`: 25 Mining fixtures, no failures. `mining-runtime-update-final.txt`: two additional warm-update/process-group checks. No real miner or transaction is required by these fixtures.
- `native-signature-fixtures.json`: 18 independently verified BCH/DGB/PPC signatures with one and five inputs. `tests/fixtures/zcash-zip244-transparent.json`: 46 official ZIP-244 digest cases across NU6.2 and NU6.3. Exact atomic amounts, fee bounds, MAX planning, foreign/duplicate inputs and single-attempt broadcasts are covered by SDK fixtures.
- `electron-runtime-final-fixes.txt`: 22 runtime fixtures inside Electron; pure JavaScript SHA3/secp256k1 avoids unsupported BoringSSL operations.
- `gui-result.json`, completed 2026-09-24T00:56:31.307Z: all seven added coins Active in a fresh isolated Linux GUI. Xelis synchronized and MWC completed a full scan from height 1. Before completion the interface displayed an unverified balance. Only the random empty fixture was reported as verified zero.
- `mining-gui/results.json`, 2026-09-23T22:56:08.219Z: all nine selected GrandPool France regular by default. ASIC configuration stayed on the requested coin, with a synthetic payout identity. Local GPU setup was checked for PRL/XEL/NEXA.
- `grandpool-tls-read.json`: certificate-verified TLS connections to all nine France pool endpoints. This does not establish share acceptance or mining payout.
- `nexa-public-authoritative.json`: over 1,000 UTXOs on a public pool address; cold complete balance about 27 seconds, warm read below one second. Confirmed, spendable and immature amounts remain separate decimal strings. Failed reads cannot become partial or zero balances.
- `peercoin-public-read.json`: funded public address, history and raw transaction proof returned successfully. `public-wallet-read.json`: public BCH/DGB/ZEC reads; upstream history-limit failures recorded separately.
- Windows MSI: all 336 extracted payload files matched SHA-256 against the packaged source tree. macOS: 86 Mach-O files, 165,598 code pages and 506 resource hashes verified, with ad-hoc signatures. Linux package ran the read-only GUI check. Final asset hashes are provided with the release.

## Server audit

At 2026-09-23 22:36–22:37 UTC, both Nonsense nodes reported `isSynced=true`, `isUtxoIndexed=true`, version 2.3.0 and `NRestarts=0`. Their virtual DAA scores were 1,126,052 and 1,126,053 in sequential reads. The primary node's smaller stored block count is normal pruning, not a synchronization percentage.

The secondary Nonsense host had five OOM-related restarts earlier in the week. Added 4 GiB swap and a Go memory budget (`GOMEMLIMIT=2300MiB`, `GOGC=60`); the service remained running after its 20:08 UTC restart. No failed services remained on either Nonsense host.

The primary backend answered network requests for 27 of 33 coins. Seven new adapters, public Xelis WebSocket proxy, MWC foreign API proxy and all seven price mappings were verified. An obsolete failed Kerrigan one-shot from August was cleared after verifying the actual Kerrigan daemon was active; its blockchain data was not reset. The primary filesystem was 91% used, with approximately 13 GiB free.

## Unavailable checks and supported limits

- Host `188.137.235.140`: SSH and API timed out from both the workstation and primary host. No daemon inspection was possible there. Neoxa, Terracoin, Raptoreum, Zano, EPIC and Junkcoin were unavailable through this dependency. Recovery requires restoring host/network access; no balance is inferred.
- Windows SSH relay: resets before the SSH banner; direct alternate route also times out. MSI packaging is verified, but installing/running this build on the physical Windows desktop and the Windows MWC console helper were not verified.
- No macOS runtime machine was available. Both architectures and signatures were checked statically. The application has no Apple Developer ID/notarization.
- No supported NVIDIA GPU or external ASIC was available for a real mining workload. GrandPool presets/handshakes and miner commands are verified; shares and payouts are not.
- ZEC supports transparent t1/t3 only; no shielded/unified sends. Nexa tokens and Xelis tokens/contracts are outside this release. MWC uses interactive MQS and needs an online recipient. Remote UTXO servers may reject very large histories; history errors remain explicit while independent balances can remain available.

The exported source also passed a fresh frontend/SDK release build in an isolated directory using restored verified WASM inputs and the public signed Mining manifest, without a private signing key. The scan of 6,346 ordinary files found no credential patterns or newly introduced nonstandard mnemonic literals; existing public test vectors remain unchanged.

## Reproduction

Use one CPU for builds: `taskset -c 0 npm test`. Run `node --test modules/mining/tests/runtime-update.test.cjs` for warm-update checks. `xvfb-run -a node_modules/.bin/electron --no-sandbox tests/gui/grandpool-mining.cjs` uses synthetic host responses and refuses miner-start/install requests. Reference executable pins and build prerequisites are documented in `REFERENCE-WALLETS.md`.

`wallet_secret.cpp` and its copies were not read. Existing protected Git objects are retained without content inspection. Credentials, recovery phrases, private keys, wallet profiles and scan databases are excluded from the source export and reports.

## Zcash NU6.3 release gate

At 2026-09-23T23:58:25.590Z, the TLS Electrum node reported height 3493963 and coinbase `c911fa646b76631947b743c95aaa96f3f5e76ecf6e08b94212ffc961427e8c46` (version 6, branch `0x37a5165b`). Its verbose inputs and outputs were compatible with the backend maturity/history parser. The initially staged wallet still selected NU6.2; publication was stopped before the wallet became public. The final signer uses NU6.3 with v5 transparent transactions, which remain valid under [ZIP-229](https://zips.z.cash/zip-0229) and [ZIP-258](https://zips.z.cash/zip-0258). Activation-height and expiry bounds, exact txids and local fixture signatures pass. All three embedded SDKs and Electron ASAR integrity records were updated; every other packed file was checked unchanged.

## Final node and startup corrections

Both public Peercoin Blockbook hostnames stalled at index height 892668 while their node had reached 892670. Backend fixtures now reject balances, spendable outputs and history from an unfinished Blockbook index. Peercoin was switched to the mainnet Electrum WebSocket servers listed in the official peercoin_flutter source; each connection checks the expected genesis. The primary endpoint returned height 892675, 46 UTXOs and correct mining maturity for public address `PRZsYNcwiBxi5ggNrh3wuBkXqLPrZcVEdM`: 1607.030000 PPC confirmed, 346.650000 spendable and 1260.380000 immature. History and raw v3 transaction decoding passed. The listed secondary endpoint refused connections; it is not claimed healthy. Evidence: `peercoin-electrum-final.json`, `peercoin-adapter-final.json`, `peercoin-production-final.json`.

A first MWC start exceeded the former 15-second allowance during a congested GUI run. The startup budget is now 90 seconds; reopening after failed initialization or scanning preserves the encrypted profile. A fixture verifies failure followed by successful reopening creates the profile only once. A later GUI scan was interrupted by the backend deployment restart and stayed explicitly unverified. At 2026-09-24T00:56:31.307Z, the final isolated GUI check completed with all seven added coins Active after a full MWC scan and Xelis synchronization. The harness sends ordinary activity events while waiting so the wallet’s normal five-minute auto-lock does not terminate the test session.

At 2026-09-24 00:58 UTC both Nonsense nodes again reported synchronized, UTXO-indexed and `NRestarts=0`. At 00:59 UTC the original Wallet 0.1.8 Mining host also upgraded 0.1.12 to 0.1.13 successfully on the workstation, verifying all 87 files and preserving the PRL job endpoint. Earlier workstation connection timeouts were transient during saturated uploads. The final clean-source SDK rebuild produced identical code for all four bundles, excluding build-directory region comments.

## Publication and public update verification

Wallet [0.1.9](https://github.com/AltbaseWallet/AltbaseWallet/releases/tag/v0.1.9) and Mining [0.1.13](https://github.com/AltbaseWallet/module-mining/releases/tag/v0.1.13) are public. Release code commit: `ca95d2880b498fcc0828304c30342b216dd05c0e`; Mining commit: `a6444c657d980bacfaab756b1b63d4528ee73bfa`. All 40 submodule branch heads were verified. Protected source Git object IDs were retained without reading their contents.

At 2026-09-23T23:38:36.609Z, the original Wallet 0.1.8 Mining host installed signed Mining 0.1.13 from anonymous public GitHub downloads over an existing 0.1.12 installation in an isolated profile on the primary server. All 87 files verified. The existing PRL job retained `stratum+ssl://eu.rplant.xyz:17168`. No HTTP mocks, miner starts or wallet transactions were used. The workstation also passed the same public update check at 2026-09-24T00:59:19.490Z after upload congestion cleared.

At 2026-09-24T01:00:30.172230+00:00, the production backend advertised 0.1.9 to 0.1.8 clients and correctly reported no update to 0.1.9 clients. Its file URLs point to the verified public release.

Every uploaded asset matched the SHA-256 computed locally and independently by GitHub. Anonymous public download access and byte ranges were checked at 2026-09-24T01:01:09.739285+00:00. Windows is distributed as a ZIP containing the MSI. No WASM runtime was added to the release.

| Artifact | SHA-256 |
| --- | --- |
| Altbase-Wallet-Linux-x86_64-v0.1.9.AppImage | `e2cf7a0e5315ecddb5a4ceafca280693dc2d80901c80918e54c2c92f1dba4244` |
| Altbase-Wallet-Windows-x64-v0.1.9.zip | `d72c9a8fe0d3e688ee3a6d03cb04a9f0fe414dd8c8afb7a6341b68b269a2e78e` |
| Altbase-Wallet-macOS-universal-v0.1.9.zip | `990d5e083a75938a7d0816501e92130a8f78816cf10c486fcca0d3a1f28cce58` |
| SHA256SUMS-v0.1.9.txt | `6468598a6153f9bbc2e6106216ed2c3cc0efc3208fb00d276e03c53de62753fe` |

The unavailable server, physical desktop and mining workload checks listed above remain unavailable; publication does not change those conclusions.

## Final external access and cleanup

At 2026-09-24T01:01:38Z the production gateway returned successful network status for 27 of 33 coins, with none of those 27 reporting initial synchronization. All seven new adapters were healthy. The six unavailable coins still depended on unreachable host `188.137.235.140`. The final Nonsense reads at 00:58:52–53 UTC showed both nodes at virtual DAA 1,134,762, synchronized and indexed, with no service restart since the recorded changes.

At 01:03 UTC the Windows relay closed before its SSH banner and the direct alternate route timed out. The VirtualBox `re` mount was listed but its path returned `ENOENT`; the final Windows ZIP could not be delivered through the shared folder. The verified ZIP is available in local `artifacts/` and the public release. This does not constitute a Windows installation/runtime test.

All 11 public release assets passed anonymous download checks at 01:01:09 UTC. Release metadata and the backend use final `v0.1.9` asset URLs; draft-only URLs were replaced before the successful public-download verification. Old task-created drafts and 797,822,094 bytes of temporary server upload files were removed after hash verification. Wallet profiles and scan results were preserved.
