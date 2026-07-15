# Altbase Wallet

Altbase Wallet is a non-custodial, modular desktop cryptocurrency wallet. The
application combines an Electron and React interface with isolated C++, Rust,
and WebAssembly wallet modules. Sensitive wallet operations remain on the
user's device, while public blockchain data and transaction relay are obtained
through configured public RPC and Altbase API services.

Current application version: **0.1.5**

## Release Baseline

Version 0.1.5 establishes the modular source baseline for continued wallet and
Swap development. The current source state includes the following changes:

- The monolithic coin catalog was replaced by independently maintained coin
  modules. The organization now contains 23 coin repositories and one shared
  native SDK repository.
- The native runtime was divided into a single process bridge, per-coin wallet
  modules, per-coin node modules, shared transport and vault components, and
  dedicated Epic and Zano protocol modules.
- Bitcoin, Kaspa, Qubic, and Nervos support was added without requiring a local
  blockchain download. These integrations use public or backend-managed RPC
  services.
- Existing Epic and Zano support was retained and isolated from generic wallet
  code. Their source dependencies remain active Git submodules.
- Mining and staking targets are excluded from the wallet build graph. Runtime
  wallet modules do not expose mining or staking commands.
- Transaction identity and reconciliation were centralized. Confirmed remote
  transactions replace matching local pending records without creating
  duplicate history entries.
- Monetary values, fees, balances, and transaction deltas use decimal strings
  and integer atomic-unit arithmetic where precision is material.
- Epic sending now covers listener readiness, Slate compatibility, completion
  tracking, uncertain post-publish states, rollback rules, restart recovery,
  and application-close protection while a send is active.
- Zano handling now covers local spend-data readiness, restore and sync
  progress, stale outgoing reservations, incoming pending reconciliation, and
  confirmation updates.
- Kaspa uses a wallet-only WebAssembly build and an exact UTXO planner. Fee
  estimation, change, mass, selected inputs, and maximum-balance sends are
  calculated from the final transaction plan.
- Nervos transaction construction validates cell capacity and uses the RPC
  serialization names expected by CKB nodes.
- Remote confirmation tracking was normalized so transaction status continues
  to advance after the first confirmation.
- The interface is responsive down to the desktop minimum window size. Compact
  layouts use mobile-style navigation, preserve coin balances and prices, keep
  the disabled Swap entry visible, and provide Back actions for nested views.
- The Windows package is generated as an MSI by project-owned build code using
  Windows Installer SDK tools. Inno Setup and NSIS are not part of the current
  production packaging path.
- Native Windows targets use static runtime packaging so a separate Visual C++
  Redistributable installation is not required by project-built modules.
- Build downloads and dependency caches are resumable. Windows full builds use
  seven jobs; server-side Linux and macOS container builds default to two jobs.
- Product and native module version metadata is aligned to 0.1.5.

VirusTotal results are specific to an exact compiled file hash. This repository
does not describe a newly built binary as clean until that exact artifact has
completed analysis. Scan credentials, test wallet phrases, passwords, and
server credentials must never be committed.

## Architecture

The desktop application communicates with one local native bridge over a
structured request and response protocol. The bridge loads or links the module
assigned to the selected coin. Coin-specific state and protocol behavior remain
inside that module instead of being accumulated in one common wallet binary.

The source organization has two module layers:

1. `modules/<id>` contains the independently published coin or SDK repository.
2. `native/` contains the native build graph and the current upstream protocol
   dependencies required to produce platform binaries.

The shared `native-core-sdk` module owns common bridge contracts, transport,
vault, derivation, planning, signing, and module interface source. A coin module
owns its definition, wallet engine selection, native route, and any source that
is unique to that integration.

### Coin Modules

| Module | Asset | Integration model |
| --- | --- | --- |
| `bitcoin` | Bitcoin (BTC) | UTXO wallet and public indexed reads |
| `bitcoin2` | Bitcoin II (BC2) | UTXO wallet and backend node reads |
| `bitcoincashii` | Bitcoin Cash II (BCH2) | UTXO wallet with CashAddr handling |
| `btgs` | Bitcoin Gold (BTGS) | UTXO wallet and backend node reads |
| `capstash` | CapStash (CAPS) | UTXO wallet and backend node reads |
| `ckb` | Nervos (CKB) | Cell-model wallet and public RPC |
| `epic` | Epic Cash (EPIC) | Dedicated light wallet and Epicbox transport |
| `firo` | Firo (FIRO) | UTXO wallet and address-index reads |
| `hypercoin` | Hypercoin (HRC) | UTXO wallet and backend node reads |
| `junkcoin` | Junkcoin (JKC) | UTXO wallet and local index reads |
| `kaspa` | Kaspa (KAS) | DAG UTXO wallet, public RPC, wallet-only WASM |
| `kerrigan` | Kerrigan (KER) | UTXO wallet and address-index reads |
| `litecoinii` | LitecoinII (LC2) | UTXO wallet and backend node reads |
| `mydogecoin` | Mydogecoin (MYDOGE) | UTXO wallet and backend node reads |
| `neoxa` | Neoxa (NEOX) | UTXO wallet with Blockbook and RPC fallback |
| `pearl` | Pearl (PRL) | UTXO wallet and remote Blockbook reads |
| `pepecoin` | Pepecoin (PEPE) | UTXO wallet and local index reads |
| `quai` | Quai (QUAI) | Account-model wallet and remote RPC |
| `qubic` | Qubic (QUBIC) | Account-model wallet and public RPC |
| `raptoreum` | Raptoreum (RTM) | UTXO wallet and address-index reads |
| `scash` | Scash (SCASH) | UTXO wallet and backend node reads |
| `terracoin` | Terracoin (TRC) | UTXO wallet and address-index reads |
| `zano` | Zano (ZANO) | Dedicated light wallet and native protocol core |
| `native-core-sdk` | Shared SDK | Bridge, vault, transport, derivation, planning, and signing contracts |

### Active Native Dependency Repositories

The following repositories are still required by the current native build and
must not be archived while they remain referenced by `.gitmodules`:

- `native/core`
- `native/epic_core`
- `native/vendor/epic_src`
- `native/vendor/epic_wallet_src`
- `native/vendor/zano_native_lib`

## Repository Layout

- `src/` - React UI, application state, wallet services, transaction logic, and
  coin-module registry.
- `electron/` - Electron main process, preload API, lifecycle controls, and
  native bridge client.
- `modules/` - 24 independently published module submodules.
- `native/core/` - shared C++ bridge and native module build graph.
- `native/epic_*` - Epic router, state, sender, transport, and FFI components.
- `native/kaspa_wallet_wasm/` - wallet-only Kaspa WebAssembly source.
- `native/vendor/` - source-only Epic and Zano dependency submodules.
- `scripts/` - deterministic native, packaging, verification, and platform build
  automation.
- `tests/` - frontend, transaction, module, reconciliation, and regression tests.
- `docs/` - public technical and transparency documentation.
- `build/` - source artwork used by desktop packaging.

Generated dependency directories, native binaries, installers, wallet data,
logs, and local credentials are not source and are not committed.

## Trust Model

- Seed phrases, derived keys, WIF values, wallet passwords, and private wallet
  state are processed locally.
- Public chain state, fees, history, prices, update metadata, and transaction
  relay may be requested from the configured public services.
- The default application API base is `https://api.altbase.io/api/v1`.
- The API server implementation and deployment credentials are not included in
  this desktop source repository.
- Test phrases and service credentials must be supplied at runtime and must not
  be written to source, documentation, build logs, or committed configuration.

## Clone the Complete Source Tree

Clone the superproject and every active source dependency:

```bash
git clone --recurse-submodules https://github.com/AltbaseWallet/AltbaseWallet.git
cd AltbaseWallet
git submodule update --init --recursive --jobs 2
```

For an existing checkout:

```bash
git pull --ff-only
git submodule sync --recursive
git submodule update --init --recursive --jobs 2
```

Do not build from a ZIP export of the superproject. A ZIP does not populate Git
submodules and therefore does not contain the complete native source tree.

## Requirements

Common requirements:

- Node.js 22 or newer.
- npm 10 or newer.
- Git with submodule support.
- CMake 3.24 or newer.
- Rust stable and Cargo for Epic and Kaspa components.
- A C++20 compiler.

Windows requirements:

- Windows 10 or newer, x64.
- Visual Studio 2022 Build Tools with the C++ desktop workload.
- Windows 10 or 11 SDK, including Windows Installer SDK scripts.
- LLVM/Clang where required by Rust bindings.

Linux requirements:

- Docker for the maintained multi-distribution build.
- GCC or Clang, OpenSSL, libcurl, SQLite, GTK, and Electron runtime packages for
  a direct local build.

macOS cross-build requirements:

- Docker on the Linux build host.
- A supported macOS SDK for osxcross.
- The source-built Zano macOS dependency cache referenced by
  `ALTBASE_ZANO_MACOS_DEPS_DIR`.

## Install Dependencies

Use the lock file for a reproducible JavaScript dependency tree:

```bash
npm ci
```

## Development

Run Vite in the first terminal:

```bash
npm run dev
```

Run Electron in the second terminal:

```bash
npm run electron
```

Useful verification commands:

```bash
npm test
npm run lint
npm run build
```

## Native Build Commands

The maintained Windows native orchestrator builds Zano, Epic, Kaspa wallet-only
WASM, the C/C++ bridge, and the individual wallet and node modules:

```powershell
$env:ALTBASE_BUILD_JOBS = '7'
npm run build:core
```

Individual native stages are available for focused development:

```powershell
npm run build:zano
npm run build:epic
npm run build:kaspa-wallet-wasm
npm run build:core
```

`scripts/copy-native-core.cjs` copies the current platform binaries into the
runtime `native-core/` directory after a native build.

## Windows Package

The canonical repository command builds the native runtime, unpacked Electron
application, and MSI package:

```powershell
npm ci
npm test
npm run lint
npm run dist:win
```

Outputs:

```text
release/win-unpacked/
release/Altbase-Wallet-Windows.msi
```

The MSI is generated by `scripts/build-native-installer.cjs` using the Windows
Installer SDK. The build does not use Inno Setup or NSIS.

### Maintained Workspace Wrapper

The maintained Windows workspace may include `build.bat` one directory above
the repository. This wrapper preserves download caches and retries interrupted
network operations.

```bat
build.bat
build.bat --full
```

- `build.bat` rebuilds the GUI and Windows package while reusing the existing
  complete `native-core` directory.
- `build.bat --full` rebuilds all C, C++, Rust, Kaspa WASM, module, GUI, and MSI
  outputs with seven jobs.
- The final verification requires 19 wallet DLLs, 23 node DLLs, the bridge,
  Epic, Zano, the unpacked application, the MSI, and Windows SHA-256 output.

## Linux Container Build

The maintained script builds AppImages for Ubuntu 24, Debian, and Fedora. It
defaults to two build jobs and uses persistent npm, Cargo, and dependency
caches.

```bash
ALTBASE_BUILD_JOBS=2 \
ALTBASE_LINUX_SOURCE_DIR=/opt/altbase-wallet-build/source \
ALTBASE_DOWNLOADS_DIR=/opt/altbase-wallet-build/release \
bash scripts/build-linux-binaries-docker.sh
```

The distribution set can be limited with `ALTBASE_LINUX_DISTROS`, for example:

```bash
ALTBASE_LINUX_DISTROS="ubuntu24 debian" ALTBASE_BUILD_JOBS=2 \
bash scripts/build-linux-binaries-docker.sh
```

Expected artifacts include:

```text
Altbase-Wallet-Ubuntu24.AppImage
Altbase-Wallet-Debian.AppImage
Altbase-Wallet-Fedora.AppImage
checksums.txt
```

## macOS x64 Container Build

The macOS script cross-compiles an unsigned x64 package through osxcross. The
source directory and Zano dependency cache must be prepared before execution.

```bash
ALTBASE_BUILD_JOBS=2 \
ALTBASE_MACOS_SOURCE_DIR="$HOME/altbase-wallet-build/source" \
ALTBASE_ZANO_MACOS_DEPS_DIR="$HOME/altbase-wallet-build/dependencies/zano-macosx" \
ALTBASE_DOWNLOADS_DIR="$HOME/altbase-wallet-build/release" \
bash scripts/build-macos-docker.sh
```

Expected artifacts:

```text
Altbase-Wallet-macOS-x64.zip
Altbase-Wallet-macOS-x64.zip.sha256
```

The cross-built package is not code-signed or notarized. Production macOS
distribution requires an Apple signing identity and notarization pipeline.

## Verification Standard

A release candidate is not complete until all applicable checks have passed:

1. Initialize every submodule and confirm that no gitlink is missing.
2. Run the frontend and domain test suite with `npm test`.
3. Run `npm run lint` and `npm run build`.
4. Run native CTest from the active CMake build directory.
5. Verify the expected wallet and node module inventory for the target OS.
6. Exercise restore, balance refresh, fee calculation, send, receive,
   confirmation progression, restart recovery, and duplicate reconciliation in
   isolated GUI profiles.
7. Verify maximum-balance sends and insufficient-balance handling for each
   transaction model.
8. Confirm that generated Windows modules do not import a separately installed
   Visual C++ runtime.
9. Scan every newly generated native runtime file by exact hash. Record the
   analysis result without committing API credentials.
10. Create a fresh recursive clone and repeat the source and build preflight
    before publication.

Automated tests and static analysis do not replace live transaction validation.
Conversely, a successful transaction does not replace regression tests or
binary analysis.

## Source Publication Procedure

Development history must remain visible and module ownership must remain
independent.

1. Make and verify source changes in the appropriate module repository.
2. Commit and push the module repository first.
3. Update the corresponding submodule gitlink in `AltbaseWallet`.
4. Commit and push the superproject after every referenced module commit is
   available remotely.
5. Synchronize source deletions as deletions; do not leave obsolete files in a
   clean export.
6. Publish only changed source files and required gitlink updates. Do not
   rewrite unrelated files or force-push shared history.
7. Archive a legacy repository only after it is no longer referenced by
   `.gitmodules`, build scripts, or release automation.
8. Verify a fresh `--recurse-submodules` clone before declaring publication
   complete.

The source workflow does not publish release binaries. Releases are produced
and verified separately from the source repositories.

## Excluded Content

The following content must not be committed to the application or module
repositories:

- `node_modules`, Cargo `target`, CMake build directories, and compiler output.
- `native-core`, `dist`, `release`, AppImages, MSI files, executable files,
  shared libraries, object files, and WebAssembly output.
- Download caches, dependency archives, Git LFS working caches, and temporary
  build workspaces.
- Wallet profiles, LevelDB data, transaction test data, logs, crash dumps, and
  backups.
- Seed phrases, private keys, passwords, API keys, access tokens, SSH
  credentials, and server configuration secrets.
- Nested `.git` directories or stale Git pointer files in clean source exports.

Only source packaging artwork under `build/` is included. Generated packages
and compiled resources remain outside Git history.
