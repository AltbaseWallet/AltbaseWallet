# Altbase Wallet

Altbase Wallet is a non-custodial desktop cryptocurrency wallet built with
Electron, React, TypeScript, and a local native C++ bridge.

The wallet keeps seed phrases, private keys, wallet passwords, WIF keys, and
plaintext privacy-wallet cache data local to the user's machine. Public chain
data is read through the configured Altbase API endpoint, but the API server
source code is not included in this wallet-only repository copy.

Current application version: **0.1.6**

## Release 0.1.6

Version 0.1.6 advances the wallet from the previous public release with the
following user-facing and architectural changes:

- Added Bitcoin, Kaspa, Qubic, and Nervos support through public or
  backend-managed RPC services without downloading their blockchains.
- Split the supported assets into independently maintained coin repositories
  and registered them as Git submodules of the desktop wallet.
- Retained the local native bridge while separating shared wallet services,
  per-coin wallet modules, node adapters, and the dedicated Epic and Zano
  protocol components.
- Reworked Epic transaction submission, Epicbox listener readiness, restart
  recovery, cancellation reconciliation, and pending-state handling.
- Reworked Zano synchronization, local spend-data readiness, stale outgoing
  reservations, incoming updates, and confirmation reconciliation.
- Added exact Kaspa UTXO planning for fees, change, selected inputs, and
  maximum-balance sends.
- Corrected Nervos transaction serialization and enforced the CKB minimum cell
  capacity before submission.
- Centralized transaction identity, duplicate suppression, confirmation
  progression, balance refresh, and local-versus-remote pending reconciliation.
- Added a removable Mining feature module with its own signed GitHub release
  channel. Miner executables remain separate downloads and are never bundled in
  the base wallet package.
- Added wallet-derived mining payout identities, CPU/GPU selection, saved pool
  presets, bounded miner logs, runtime controls, and platform-aware miner
  availability.
- Made the desktop interface resizable and added compact mobile-style layouts,
  balance visibility, navigation back actions, and a consistent disabled Swap
  entry where Swap is not yet available.
- Added a project-owned Windows MSI packaging path and statically linked native
  runtime components so project-built modules do not require a separately
  installed Visual C++ Redistributable.
- Added Ubuntu 24 packaging and a universal macOS build containing native Intel
  and Apple Silicon application slices.
- Aligned wallet, installer, native-module, and optional Mining-module version
  metadata to 0.1.6.

## Repository Layout

- `src/` - React wallet UI, stores, services, wallet engines, and coin logic.
- `electron/` - Electron main/preload process and native bridge client.
- `modules/mining/` - Optional, independently updatable Mining feature module.
  Its UI, catalog, adapters, validation, and managed-process runtime are kept
  outside the base wallet feature set.
- `native/core/` - C++ native bridge for wallet-sensitive operations, attached
  as a Git submodule.
- `native/epic_core/` - Rust FFI wrapper for Epic Cash, attached as a Git
  submodule.
- `native/vendor/` - Zano and Epic source dependencies, attached as Git
  submodules. Generated build output and prebuilt binary dependency folders are
  intentionally omitted.
- `scripts/` - Build helper scripts only.
- `docs/` - Public transparency and privacy design notes.

This source package intentionally does not include Windows `.bat` build files.
Build commands are documented below so they can be reviewed and run manually.

## Clone With Native Sources

Clone the wallet and all native source submodules:

```bash
git clone --recurse-submodules https://github.com/AltbaseWallet/AltbaseWallet.git
cd AltbaseWallet
git submodule update --init --recursive
```

If the repository was already cloned without submodules, run:

```bash
git submodule update --init --recursive
```

## What Is Not Included

Generated binaries, build output, and prebuilt native dependency packages are
intentionally not included:

- `native/core/build`
- `native/epic_core/target`
- `native/vendor/**/build`
- `native/vendor/**/target`
- `native/vendor/zano_native_lib/_install_*`
- `native/vendor/zano_native_lib/_libs_*`
- `native-core/*` generated bridge binaries
- downloaded miner executables, archives, drivers, and per-user Mining data
- Altbase API server source code
- `node_modules`, `dist`, `release`, logs, local wallet files, and backups

The included vendor trees are source snapshots only. To build full Zano/Epic
native privacy support, restore or build the omitted dependency packages first.

## API Endpoint

This repository contains only the desktop wallet. Runtime blockchain reads,
fee hints, history, prices, update metadata, and transaction relay are requested
from the configured public API endpoint. The production API implementation and
server deployment files are intentionally not shipped here.

Default wallet API base:

```text
https://api.altbase.io/api/v1
```

## Requirements

- Node.js 22 or newer.
- npm 10 or newer.
- CMake 3.24 or newer.
- C++20 compiler.
- Windows: Visual Studio 2022 Build Tools.
- Linux: GCC/Clang, OpenSSL development package, and libcurl development
  package.
- Optional Epic build: Rust toolchain and the upstream Epic wallet sources.

## Install

```bash
npm install
```

## Run UI In Development

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run electron
```

## Optional Mining Module

Mining is implemented as the removable `AltbaseWallet/module-mining` feature
module. Wallet `0.1.6` downloads module `0.1.6` from the latest stable GitHub
Release only after the user requests installation. Altbase Wallet verifies the
module package with the embedded Altbase Ed25519 public key and signed package
manifest before installation or update. The private signing key is never
stored in the repository or packaged application.

The base wallet does not include miner executables, libraries, drivers, or
archives. A miner is downloaded only after the user starts a configured job.
Miner downloads use the official configured HTTPS source, support interrupted
download resume, and install without a publisher checksum gate so upstream
miner releases are not coupled to wallet releases. The module records a local
post-download fingerprint only to detect later modification of installed files.

The module:

- obtains the coin payout address or public mining identity from the wallet;
- supports coin-scoped CPU and GPU choices where the selected algorithm and
  available hardware permit them;
- defaults CPU jobs to one thread;
- starts miners as direct child processes without a command shell;
- disables miner-managed self-update where the miner supports that option;
- confines extraction, configuration, logs, and runtime files to the module
  data directory;
- keeps saved custom pools locally, pins them above catalog presets, and does
  not expose a misleading user-editable pool fee;
- can be updated or removed independently of the wallet application.

The module archive is shared by Windows x64, Linux x64, macOS x64, and macOS
Apple Silicon. Miner executables are not shared: the module selects only the upstream artifact for
the current host. Unsupported miner choices are hidden. The release contract
for `v0.1.6` is documented in `modules/mining/README.md`.

Build and verify the local module:

```bash
npm run sync:mining
npm run build:mining
npm test
npm run lint
```

## Build The Web UI

```bash
npm run build
```

## Build Native C++ Bridge

### Windows

Run from a Visual Studio Developer PowerShell:

```powershell
cmake --preset vs2022-x64-release -S native/core
cmake --build native/core/build/vs2022-x64-release --config Release
node scripts/copy-native-core.cjs
```

### Linux

Ubuntu/Debian packages:

```bash
sudo apt update
sudo apt install -y build-essential cmake pkg-config libssl-dev libcurl4-openssl-dev
```

Fedora packages:

```bash
sudo dnf install -y gcc gcc-c++ cmake make pkgconf-pkg-config openssl-devel libcurl-devel
```

Build:

```bash
cmake --preset linux-x64-release -S native/core
cmake --build native/core/build/linux-x64-release --parallel 2
node scripts/copy-native-core.cjs
```

Without compiled Zano native libraries, the bridge still builds with a
privacy-wallet stub. Zano/Epic privacy wallet functions remain unavailable
until the optional native dependency is configured.

## Optional Zano Native Support

The Zano source snapshot is attached as a Git submodule. Generated Zano build
output and prebuilt Boost/OpenSSL packages are not included.

Source:

- https://github.com/AltbaseWallet/zano_native_lib.git

Expected location:

```text
native/vendor/zano_native_lib/
```

If the source snapshot is missing, restore submodules:

```bash
git submodule update --init --recursive native/vendor/zano_native_lib
```

On Windows, the project expects the Zano source tree plus dependency packages
under that directory. If you cloned `zano_native_lib` as a Git repository, the
helper script initializes Zano submodules and pulls the required Git LFS files
for Windows Boost/OpenSSL:

```powershell
npm run build:zano
```

Then rebuild the bridge:

```powershell
npm run build:core
```

## Optional Epic Cash Native Support

The Rust wrapper lives in `native/epic_core`. Epic and Epic Wallet source
snapshots are attached as Git submodules, but Rust `target` build output is not
included.

Sources:

- https://github.com/AltbaseWallet/epic_src.git
- https://github.com/AltbaseWallet/epic_wallet_src.git

Expected locations:

```text
native/vendor/epic_src/
native/vendor/epic_wallet_src/
```

If the source snapshots are missing, restore submodules:

```bash
git submodule update --init --recursive native/vendor/epic_src native/vendor/epic_wallet_src
```

Build the Rust wrapper and then rebuild the native bridge:

```powershell
npm run build:epic
npm run build:core
```

## Build Desktop Packages

### Windows unpacked app and installer

```powershell
npm run dist:win
```

The unpacked app is created in:

```text
release/win-unpacked
```

### Linux builds in Docker

The helper script builds Ubuntu 24, Debian, and Fedora packages:

```bash
bash scripts/build-linux-binaries-docker.sh
```

Outputs are written under `release/` inside the build workspace and copied by
the script to `ALTBASE_DOWNLOADS_DIR` when that environment variable is set.
If it is not set, the script writes to a local `downloads/` directory inside
the Linux build root.
