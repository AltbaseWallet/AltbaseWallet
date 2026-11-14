# Changelog

## 0.1.13

### Delisted coins
- Hypercoin (HRC), Mydogecoin (MYDOGE), Nonsense (NNN) and BTGS are removed from the current GUI and Mining catalog. Use an older wallet version if you need these coins. Their source repositories are retained.

### New independent network modules
- **EVM:** Ethereum (ETH), BNB Smart Chain (BNB/BSC), Polygon (POL) and Arbitrum One (native ETH). Repository: https://github.com/AltbaseWallet/module-evm.
- **Solana:** SOL and its tokens. Repository: https://github.com/AltbaseWallet/module-sol.
- **Tron:** TRX and its tokens. Repository: https://github.com/AltbaseWallet/module-trx.
- Each module has its own repository and release assets. Module archives are distributed from those repositories.

### Application updates
- Restore the production application-update request and the visible update notice. The former local-project placeholder no longer suppresses release checks.
- Compare the installed and advertised versions, preserve daily optional dismissal, always show mandatory updates, and keep startup usable when the feed is unavailable.
- Keep the notice visible when the external browser cannot open. Accept download links only from the official website or the official wallet release repository.
- Keep platform update metadata aligned with the actual Windows, Linux and universal macOS binaries.

### Transfers, balances and privacy wallets
- Submit PEARL transactions with one constant-size raw-hex POST instead of JSON followed by a long GET URL. Never retry an uncertain broadcast through another route.
- Reserve pending UTXO inputs consistently across balances, fee estimation, MAX and final selection. Permit Bitcoin/PEARL engines to use other known unreserved inputs while retaining account/nonce guards.
- Deduct pending PEARL spends immediately, retain that deduction across stale mempool snapshots, reconcile several pending spends, and avoid subtracting confirmed spends twice.
- Prepare Xelis transactions before submission, persist their public hash before broadcast, retain uncertainty across IPC, and prevent replay. Share the same pending policy between the GUI and store.
- Derive EPIC receiving addresses before long scans or remote cache lookup. Publish privacy addresses independently; show the address and QR while synchronization continues.
- Refresh native-coin quotes independently of scans and history. Recalculate fiat values from native amounts and fresh dated quotes; reject invalid, future and expired rates.

### Modules and supported networks
- Discover native DLL/SO modules at runtime without rebuilding the wallet. Include diagnostics, a module-management page, standalone embedded metadata and isolated workers.
- Add Ethereum, BNB Smart Chain, Polygon, Arbitrum, Solana and Tron account modules using public PublicNode endpoints, without adding a private indexing service.
- Support manual token contracts/mints, on-demand client-side icons, icon download retries, hidden spam with an explicit override, native/token MAX and native fee previews.
- Use ordinary collapsible coin rows for network tokens. Preserve balances and verified network state through unavailable reads, including Tron balance endpoint failures.
- Retain actual provider restrictions as unavailable discovery; do not present restricted Solana owner indexing or incomplete history as empty holdings.
- Keep one populated common module directory for built-in and user modules, containing the platform binaries. Preserve installed changes and per-profile module data.
- Restore Altbase Wallet branding and released profile storage compatibility. Preserve prior working-copy profiles without blindly merging populated wallets.
- Delist Hypercoin (HRC), Mydogecoin (MYDOGE), Nonsense (NNN) and BTGS from the current GUI and mining catalog, with an accessible delisting notice. Retain their source repositories.

### Packaging, mining and dependencies
- Restore the macOS cross-build pipeline with osxcross and the macOS SDK. Fix Darwin vault-library naming, loader paths and universal runtime metadata.
- Link the newly compiled macOS vault against pinned OpenSSL 3.5.9 LTS. Preserve the supplied private implementation unchanged and retain existing prebuilt coin-engine dependencies.
- Publish EVM, Solana and Tron package 0.1.6 with Linux, Windows and universal macOS binaries in their own repositories.
- Build the vault from the owner-maintained local implementation without altering its contents. Keep the existing risk acknowledgement and encrypted profile behavior.
- Fix Windows MSI packaging, executable branding and platform resource selection. The Windows ZIP contains exactly the MSI installer; it is not a portable application archive. Exclude foreign native addons from cross-platform packages.
- Provide a portable Linux launcher that uses the Chromium sandbox without silently disabling it or archiving a machine-specific helper link.
- Allow unsigned locally modified Mining packages while retaining integrity hashes. Retain explicit miner downloads, process supervision and module update checks.
- Preserve the elliptic nonce-length and CCC/JoyID caller-binding corrections; verify BitGo, CKB, JoyID and Nexa with public offline vectors.
- Update development-time minimatch to the upstream security correction and test normal package patterns and adversarial preprocessing limits.
- Update packaged cryptography checks to execute the SDK runtimes actually distributed in coin module folders.

### Backend integration
- Supply compatible pending-mempool methods for BCH, DGB, PPC, ZEC and NEXA; distinguish incomplete or failed reads from empty results.
- Coalesce overlapping indexer sweeps, serialize block work, preserve failed-height watermarks and respect retained/pruned ranges.
- Preserve primary successful prices over fallback sources and use the correct NEXA market pair.

### Verification and platform availability
- Compile on Linux with one CPU. Run the application tests, mining tests and TypeScript/ESLint checks.
- Exercise actual GUI paths, offline PEARL/Xelis send fixtures, scan-blocked EPIC receiving, icons, spam controls and native module discovery.
- Check the packaged application on Linux and native Windows, plus MSI installation/removal under Wine, archive contents and published checksums.
- Supply Linux x64, Windows x64 and universal macOS builds for version 0.1.13. Compile the macOS vault and plugin host on Linux for Intel and Apple Silicon, with one CPU. Verify all 93 Mach-O files, universal loader metadata and archive contents. The macOS app is ad-hoc signed; Apple notarization and native macOS GUI execution are not available in this environment.
- No live user transactions are part of release verification. Protected wallet source is excluded from this source export and all new upload operations.

### Website corrections (2026-11-14)
- Share the complete 35-asset catalog across directory, demo, calculator, marquees and public footers; update all 17 public pages and current developer tables.
- Show readable unit prices, retain only valid cached quotes and recover native prices when market-statistic sources are unavailable.
- Stop the translation observer feedback loop and fix tablet navigation and marquee overflow.
- Verify all 35 asset profiles and the six new-network calculators in production Chrome, plus seven languages and 320–1920 px layouts.

## Earlier public release: 0.1.9

Added BCH, DGB, PPC, ZEC, NEXA, XEL and MWC through the Altbase remote-node API, GrandPool mining defaults and separate coin repositories. The current changes above retain that repository layout.
