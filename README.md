# Altbase Wallet

Altbase Wallet is a non-custodial desktop cryptocurrency wallet built with
Electron, React, TypeScript and local native wallet modules.

Current application version: **0.1.9**.

## Version 0.1.9

Adds BCH, DGB, PPC, ZEC, NEXA, XEL and MWC through remote blockchain nodes behind the Altbase API. Mining 0.1.13 defaults new GrandPool jobs to its France pool and includes GPU presets and external ASIC setup. See [release verification and supported operations](docs/VERIFICATION-0.1.9.md) and [reference-wallet build inputs](docs/REFERENCE-WALLETS.md).

## Previous version 0.1.8

Bitcoin II (BC2) now signs transactions in its own wallet module using the
BC2 replay-protected digest. This fixes Windows packages whose shared UTXO
signer predated BC2 Core 31.1. The BC2 correction is isolated in its wallet module.
See [the changelog](CHANGELOG.md) for changes from 0.1.7 and
[the BC2 module](modules/bitcoin2/README.md) for its focused build and tests.

## Source layout

Each coin and feature module is maintained in its own repository. The main
repository pins them as Git submodules, including the separate Nonsense module.
Clone the complete source with:

```sh
git clone --recurse-submodules https://github.com/AltbaseWallet/AltbaseWallet.git
cd AltbaseWallet
```

For an existing checkout, run `git submodule update --init --recursive` after
pulling. GitHub's automatically generated source archives do not include
submodule contents. A local source export with populated module directories
already contains these files.

Layout:

- `src/` — wallet interface, services, stores and engines.
- `electron/` — desktop process, preload and native bridge client.
- `modules/` — coin modules, native SDK and optional Mining module.
- `native/` — native bridge and protocol dependencies.
- `scripts/` — build, packaging and isolated QA helpers.
- `tests/` — unit tests and GUI mocks.
- `ops/remote-nodes/` — adapter source and integration patches used by checks;
  this is not a complete production API deployment.
- `docs/` — API transparency and privacy design notes.

The Zano source snapshot is the patched **2.2.1.505 HF6** tree used by the
release builds. Dependency licenses and copyright notices are retained.

## Prepare frontend dependencies

Use Node.js 22 or newer and npm. Compiled WASM assets are required before
frontend builds and are not included in the application release downloads.
Build them using the platform-specific [Kaspa helper](scripts/build-kaspa-wallet-wasm.ps1)
and [Nonsense helper](scripts/build-nonsense-wallet-wasm.sh), with the required
Rust and platform tooling. If a verified runtime bundle is already available
locally, restore it before installing and building:

```sh
python3 scripts/restore-vendor-runtime.py /path/to/Altbase-WASM-runtime-v0.1.7.zip
npm ci
```

The unchanged dependency bundle keeps its `v0.1.7` filename; the application
version is `0.1.9`. The restore script verifies its SHA-256 and exact file list.
See [the source manifest](SOURCE-MANIFEST.json) for the bundle checksum and validation.

## Build and test the frontend

The following Linux commands restrict work to one CPU:

```sh
taskset -c 0 npm run build:release
taskset -c 0 npm test
```

The public signed Mining package manifest is included so release verification
works without a private signing key. Miner executables are separate downloads.

For development, run `npm run dev` and `npm run electron` in separate terminals.
Wallet operations in Electron also require the native modules.

## Native modules and desktop packages

Native builds require CMake 3.24 or newer, a C++20 toolchain, and the applicable
crypto/network dependencies. Epic also requires Rust; macOS cross-builds require
an appropriate SDK and osxcross. Use one build job and one CPU for compilation.

The owner-provided `native/core/src/wallet_secret.cpp` is included in the core
repository without content inspection. The native SDK retains its already
published storage implementation. No substitute implementation is generated.
A local review export may omit restricted copies; a recursive Git checkout
uses the versions committed in their respective repositories.

The 0.1.9 packages rebuild the native dispatcher and new coin modules for each target while retaining verified 0.1.8 protocol dependencies and the BC2/Zano fixes. Incremental recipes may reuse existing compiled objects.

Platform dependency procedures:

- [Zano HF6 on Linux](native/ZANO-HF6-LINUX.md)
- [Zano HF6 for Windows](native/ZANO-HF6-WINDOWS.md)
- [Zano HF6 for macOS](native/ZANO-HF6-MACOS.md)
- [Targeted BC2 module build](modules/bitcoin2/README.md)

`package.json` includes Windows MSI, Linux AppImage and universal macOS package
commands. These require prepared platform-native modules and build tooling;
production signing and notarization require the publisher's own credentials.

## Excluded local data

Profiles, recovery data, environment files, signing keys, local wallet
transfer/unlock/diagnostic helpers, caches, compiled binaries and Git history
are omitted. Public synthetic test vectors and source image/font assets remain.

The default public API endpoint is `https://api.altbase.io/api/v1`.
Production credentials and private deployment configuration are not included.

See [SOURCE-REVIEW.md](SOURCE-REVIEW.md) for validation scope and
[SOURCE-MANIFEST.json](SOURCE-MANIFEST.json) for reviewed source hashes,
owner-provided files and pinned module commits.
