# Changelog

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
  macOS as a universal ZIP. Include SHA-256 checksums and the separate WASM
  dependency bundle needed for frontend builds from source.
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
