# Changelog

## 0.1.13

### Application updates
- Restore the production application-update request and the visible update notice. The former local-project placeholder no longer suppresses release checks.
- Compare the installed and advertised versions, preserve daily optional dismissal, always show mandatory updates, and keep startup usable when the feed is unavailable.
- Keep the notice visible when the external browser cannot open. Accept download links only from the official website or the official wallet release repository.
- Keep platform update metadata aligned with published binaries; macOS remains on its last available build until a new macOS package exists.

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
- Build the vault from the owner-maintained local implementation without altering its contents. Keep the existing risk acknowledgement and encrypted profile behavior.
- Fix Windows MSI packaging, executable branding and platform resource selection; exclude Linux native addons from Windows packages.
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
- Linux x64 and Windows x64 builds are supplied. A new macOS build is not supplied because the Darwin native toolchain and compatibility inputs are not staged.
- No live user transactions are part of release verification. Protected wallet source is excluded from this source export and all new upload operations.

## Earlier public release: 0.1.9

Added BCH, DGB, PPC, ZEC, NEXA, XEL and MWC through the Altbase remote-node API, GrandPool mining defaults and separate coin repositories. The current changes above retain that repository layout.
