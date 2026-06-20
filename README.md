# Altbase Wallet

Altbase Wallet is a non-custodial desktop cryptocurrency wallet built with
Electron, React, TypeScript, and a local native C++ bridge.

The wallet keeps seed phrases, private keys, wallet passwords, WIF keys, and
plaintext privacy-wallet cache data local to the user's machine. Public chain
data is read through the configured Altbase API endpoint, but the API server
source code is not included in this wallet-only repository copy.

## Repository Layout

- `src/` - React wallet UI, stores, services, wallet engines, and coin logic.
- `electron/` - Electron main/preload process and native bridge client.
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
