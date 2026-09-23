# Changelog

## 0.1.9 — GrandPool coins and remote-node integration

- Add separate BCH, DGB, PPC, ZEC, NEXA, XEL and MWC wallet modules. Together with BTC and PRL, Altbase covers all nine coins listed by GrandPool on 2026-09-23. The wallet now has 33 coin modules.
- Route public blockchain requests through the Altbase backend. Keys and signing stay in local wallet engines. Xelis and MWC use pinned official reference wallets and preserve encrypted local scan profiles.
- Add BCH ForkID, DigiByte witness and Peercoin v3 transaction support; verify legacy Peercoin previous transactions with their timestamp field. Add Zcash v5/ZIP-244 transparent transactions and Nexa outpoint-aware planning with exact integer amounts.
- Keep unfinished scans and failed balance reads unverified. Fix Electron compatibility for Xelis key derivation and MWC encrypted Owner API; both complete real read-only synchronization in the Linux GUI.
- Improve Nexa large-UTXO reads with persistent Rostrum connections, bounded concurrency and shared caches. Never replace a failed authoritative balance with a spendable-only UTXO total that omits immature rewards.
- Bundle signed Mining 0.1.13: GrandPool defaults, 54 pool/solo regional presets, Rigel XelisHash v3/NexaPow support and external ASIC setup. Existing saved job endpoints and Nonsense solo mining are preserved.
- Ship Linux x86_64 AppImage, Windows x64 MSI inside ZIP and universal Intel/Apple Silicon macOS ZIP. Compilation was pinned to one CPU.

### Verification and limits

165 wallet/backend tests and 27 Mining runtime/update tests passed. Native fixture signatures were independently checked; official Zcash ZIP-244 vectors and Electron runtime fixtures passed. All seven added coins reached Active in an isolated Linux GUI, including complete Xelis/MWC scans. All nine GrandPool defaults passed an Electron GUI check. No real wallet transaction was signed or broadcast, and no pool share was submitted.

Zcash currently supports transparent t1/t3 addresses; shielded/unified sends are unavailable. Nexa token outputs and Xelis token/contract operations are not supported. MWC sends require an online compatible MQS recipient. The first privacy scan can take several minutes. Very large exchange/pool histories can exceed the upstream Electrum history limit and remain explicitly unavailable. A cold Nexa address with over 1,000 UTXOs took about 27 seconds; subsequent reads took less than a second.

Windows MSI payload extraction passed. macOS architecture and ad-hoc code/resource signatures passed. Physical Windows/macOS runtime testing was unavailable; macOS is not Apple-notarized. Rigel GPU mining requires supported NVIDIA Windows/Linux hardware; ASIC mining requires an external device.

Three of four known servers were reachable. Both Nonsense nodes were synchronized and indexed; the secondary node's repeated OOM restarts were corrected with a memory budget and swap. Server `188.137.235.140` remained unreachable over SSH and API from both the workstation and primary backend, so Neoxa, Terracoin, Raptoreum, Zano, EPIC and Junkcoin availability could not be confirmed. These failures are not zero balances.

See [detailed verification](docs/VERIFICATION-0.1.9.md). Earlier changes from 0.1.7 remain below in this changelog.

## Nonsense API availability — 2026-09-16

Fixed false Nonsense syncing/maintenance status after DAG pruning. The Nonsense backend adapter now maps the virtual DAA score to the wallet network height fields, preserves raw DAG storage counts separately, and requires explicit node synchronization and UTXO-index readiness. Failed or incomplete RPC status remains unavailable. Eight fixture checks cover pruning, genuine synchronization, missing index/status, malformed height, and endpoint failover. Applied to both API servers; no wallet binary or mining module update is required. No transaction was signed or broadcast.

## Mining module 0.1.12 — published release

The Mining runtime is now a single ESM entry. Updating a running wallet
refreshes adapters and the launcher together, fixing the old one-worker
restriction that could survive installation of 0.1.10/0.1.11.
The separate module release [v0.1.12](https://github.com/AltbaseWallet/module-mining/releases/tag/v0.1.12) is published
at commit `7145b3d6c1f99e7e26e7cf3882044146c2ba197a`. No wallet binary or host API changed.
The Mining-only packaging hook now invokes the module's runtime builder
before signing. Source changes remain local here for wallet-project review.

All 25 runtime/update tests passed. A warm signed 0.1.9 -> 0.1.12 upgrade
passed through the original Wallet 0.1.8 host; three official NNN workers ran
and GUI Stop ended all three. See
[verification](modules/mining/docs/VERIFICATION-0.1.12.md).

## Mining module 0.1.11 — published release

Mining now displays module updates on the dashboard and in coin Quick Start,
checks again while open, retries failed checks and reports HTTP/host failures
instead of incorrectly announcing that the module is up to date.
The optional module is published at [v0.1.11](https://github.com/AltbaseWallet/module-mining/releases/tag/v0.1.11)
with commit `39dfe826b9b8ec2c6480004682573ca4e6b638e6`. The wallet and mining adapters are unchanged.

All 23 runtime tests and five browser scenarios passed. The original Wallet
0.1.8 Mining host upgraded signed 0.1.9 to signed 0.1.11 through its GUI Update
button using exact release artifacts and local HTTP fixtures; 77 files verified.
See [verification and limits](modules/mining/docs/VERIFICATION-0.1.11.md).
An existing older module uses Mining > Advanced mining tools > Module >
Check for updates for this first update. GitHub API quota errors still require
waiting for the external limit to reset.

## Mining module 0.1.10 — published release

The optional Mining module adds configurable Nonsense CPU worker counts while the wallet
version remains 0.1.8. It downloads the official NNN miner separately from
`nonsense-project/nonsense`, keeps all previous coin entries, and works with
the existing wallet's module installer. Source remains in the separate
`AltbaseWallet/module-mining` repository. [Version 0.1.10](https://github.com/AltbaseWallet/module-mining/releases/tag/v0.1.10)
has been published at commit `896e7d31acb364578a78d1041f1ef6949c26108b`.
The wallet source and wallet release were not changed for this update.

See [the module changelog](modules/mining/CHANGELOG.md) for changes and
[verification and limitations](modules/mining/docs/VERIFICATION-0.1.10.md) for
the Linux GUI, node, fixture and platform checks. The ordinary wallet's
Mining host code is unchanged in this source export.

## Mining module 0.1.9 — published release

The optional Mining module adds Nonsense CPU solo mining while the wallet
version remains 0.1.8. It downloads the official NNN miner separately from
`nonsense-project/nonsense`, keeps all previous coin entries, and works with
the existing wallet's module installer. Source remains in the separate
`AltbaseWallet/module-mining` repository. [Version 0.1.9](https://github.com/AltbaseWallet/module-mining/releases/tag/v0.1.9)
has been published with commit `8f801bc6776d84ae4847ac6c5b8974d762f98060`.
The wallet repository and wallet release were not republished.

See [the module changelog](modules/mining/CHANGELOG.md) for changes and
[verification and limitations](modules/mining/docs/VERIFICATION-0.1.9.md) for
the Linux GUI, node, fixture and platform checks. The ordinary wallet's
Mining host code is unchanged in this source export.

## 0.1.8 — changes from the published 0.1.7 release

### Coins and transaction preparation

- Add Nonsense wallet integration, its node adapter, WASM wallet and transaction
  planner. Source is published in the separate `module-nonsense` repository.
- Fix BC2 sends rejected with `mempool-script-verify-flag-failed` and
  `Signature must be zero for failed CHECK(MULTI)SIG operation`. Its wallet
  module now includes its own replay-protected signer, independent of an older
  shared UTXO signer. The final BC2 correction is confined to that module.
- Make Nonsense MAX respect transaction mass limits with large UTXO sets.
- Recalculate automatic UTXO/PEPE MAX fees from the actual selected inputs,
  without silently exceeding the approved fee or changing the approved amount.
- Allow CKB MAX to finish slow input/proof lookups with a bounded deadline and
  enforce the minimum output-cell capacity. Expired requests cannot overwrite
  newer form state.
- Preserve approved Quai MAX amounts when the gas price changes.
- Validate previous-output transaction evidence and bound retries of failed
  preparation reads. A broadcast timeout does not trigger an automatic resend.

### Balances, history and privacy synchronization

- Refresh balances and transaction state without requiring a wallet restart.
- Preserve funded BCH2 cashaddr identities during balance reconciliation.
- Keep unfinished or unavailable Zano, EPIC and Monero scans distinct from a
  verified zero balance, and invalidate stale readiness after a failed read.
- Update Zano dependencies to the patched 2.2.1.505 HF6 source, improve scan-info
  responsiveness and require a scan at the current chain height before showing
  the balance as ready.
- Correct Kaspa confirmations by keeping DAA scores and accepting-block blue
  scores separate; preserve the server's confirmation counter and display
  pending KAS amounts in coin units.
- Require positive execution evidence for Qubic confirmation. A scheduled tick
  or relay acceptance alone cannot be shown as a successful transfer; legacy
  records without proof become unverified.
- Improve transaction identity, pending-state reconciliation and stale-session
  handling across wallet refreshes.

### Repositories, packages and checks

- Preserve the separate repositories and histories of all existing modules.
  Pin all 33 coin, feature and native dependency submodules in the main wallet.
  Monero and XGR keep their existing repositories; Nonsense gets a new one.
- Synchronize platform source recipes, remove local wallet-operation helpers
  and generated host-specific manifests, and retain portable build templates.
- Correct Git inclusion rules for native source, Rust lockfiles, Kaspa glue and
  the signed Mining manifest. Default build jobs and Kaspa WASM threads to one.
- Publish Windows as a ZIP containing the MSI, Linux as an x86_64 AppImage, and
  macOS as a universal ZIP. Include SHA-256 checksums for the application packages.
  Building the frontend from source requires prepared WASM dependencies.
- Pass 135 wallet and 11 Mining tests in an isolated frontend build on one CPU.
- Pass nine BC2 fixture cases on Linux and nine on Windows, covering P2PKH,
  P2WPKH and P2TR. No real user transactions were signed or broadcast in these
  technical checks.

Initial privacy-wallet recovery may take time; incomplete scans and network
errors are displayed explicitly. macOS package signatures were checked, but
macOS runtime testing was not performed; the package is ad-hoc signed and not
notarized. Publication itself did not rebuild native code.

The core repository includes the owner's supplied storage implementation; the
native SDK retains its existing published implementation. Their contents were
not inspected during this publication.
