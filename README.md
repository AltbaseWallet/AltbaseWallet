# Altbase Wallet

Altbase Wallet, developed in this working directory with runtime coin discovery. The directory name does not name a separate product. A new coin can be installed as a native library or a JavaScript package without changing or rebuilding the wallet.

Current local version: **0.1.13**. See the [branding, icon and audit corrections](docs/AUDIT-ICONS-2026-09-26.md). EVM, SOL and TRX modules use PublicNode; token logos download only when a contract is explicitly added. See [account modules and checks](docs/ACCOUNT-MODULES-2026-09-26.md) and [backend module delivery](docs/MODULE-DELIVERY.md). See the [cryptographic audit follow-up](docs/CRYPTO-AUDIT-2026-09-24.md) for the verified elliptic correction and BitGo/CKB/JoyID/Nexa signing checks. The [earlier full audit](docs/AUDIT-2026-09-24.md) covers the module, profile and interface fixes.

The [October 4 audit](docs/AUDIT-2026-10-04.md) records the current MAX, account preparation, worker/download/session fixes, dependency corrections, Linux/Windows GUI checks and artifact hashes. The portable account modules are **0.1.5**. See [the current changelog](CHANGELOG.md) for changes since the earlier public release.

Each coin module implements its connection to a local node, remote node or backend. Installing a module does not automatically add a chain to an existing backend.

## Run the local builds

Windows x64: unpack `artifacts/Altbase-Wallet-Windows-v0.1.13.zip` and launch `Altbase Wallet.exe`. Keep the complete extracted folder together. Existing profile storage is retained across this branding correction. The Windows application and DLL discovery were checked on native Windows 11; normal MSI installation and removal were also checked under Wine.

Linux:

```sh
cd /home/user/Documents/AltbaseFullNode
./artifacts/linux-unpacked/altcoinwallet
```

The executable and its entire `linux-unpacked` directory belong together. The source checkout can also run with `npm start` after `npm run build`.

The portable Linux launcher configures an existing root-owned Chromium sandbox helper automatically, or uses the user-namespace sandbox when supported. Normal packaged launch checks do not pass `--no-sandbox`. No system policy is changed. Hosts with restricted user namespaces and no installed SUID helper need administrator setup as described in `build/LINUX-SANDBOX.txt` (also included in the package).

## Install a new coin

1. Open **Coin modules** from the welcome screen, sidebar or settings.
2. Select **Open modules folder**.
3. Copy the coin's library (`.dll` on Windows, `.so` on Linux, `.dylib` on macOS), or its complete package folder, into that directory.
4. Select **Refresh modules**. The coin, its icon and supported wallet actions appear from the module metadata. An unlocked wallet derives the new coin's address.

A standalone library embeds its manifest and optional icon, so a sidecar manifest is unnecessary. It must implement **Altbase Plugin ABI v1**; an arbitrary daemon library or an old Altbase internal DLL is not compatible with this API. Platform and CPU architecture must match the application.

For development, `plugins/` at the project root is an additional discovery directory. Packaged applications also inspect `plugins/` beside the executable. Do not install the same coin ID into both directories: duplicate IDs are reported and disabled.

Replacing a module preserves its data. Close the wallet before replacing a Windows library that may still be loaded. Removing a module hides that coin but retains its preferences and stored module data for reinstallation.

## What is included

- Runtime catalog, module diagnostics and a module management page in English, Russian, Ukrainian, German, French, Chinese and Japanese.
- Native C ABI, isolated native host, JavaScript worker, example modules and automated tests.
- Common address, balance, history, fee, MAX, send and export routing based on advertised capabilities.
- Separate processes and bounded request timeouts. A failed or timed out send is never retried automatically.
- Explicit unavailable/synchronizing balance states. A failed read preserves the previous displayed balance and does not authorize send preparation.
- Six new PublicNode account modules plus 33 external compatibility descriptors for the existing Altbase coins, using the retained legacy engines. These engines have **not** all been rewritten to ABI v1. New ABI v1 coins require no new entry in the wallet source or legacy engine registry.

Installed native/JavaScript modules execute trusted code under the user's account and receive wallet material needed for their advertised operations. The worker boundary contains crashes; it is not an operating-system security sandbox.

## Build and verify

Dependencies are present in this local checkout. A new checkout requires `npm ci` and C++17 tooling. Linux builds are pinned to one CPU; `ALTBASE_BUILD_CPU` may select a different **single CPU**. Compilation tasks and tests run sequentially.

The checked-in `vendor/elliptic-6.6.1+altbase.1.tgz` supplies a minimal local RFC 6979 nonce-length correction through npm overrides. Its source, MIT license and patch explanation are beside it. `npm run build` regenerates the coin SDK bundles before building the frontend so dependency corrections cannot leave stale SDK code in the application.

`vendor/ckb-ccc-core-1.16.1+altbase.1.tgz` also binds JoyID verification to the caller's expected message and identity. Both local dependency corrections have offline regression tests; their versions are local build metadata, not upstream releases.

The development-only `vendor/braces-3.0.3+altbase.1.tgz` bounds glob recursion while preserving ordinary expansion. See [the patch explanation](vendor/braces-PATCH.md) and the current audit for source provenance and the remaining version-based npm advisory entries.

```sh
npm run build
npm test
xvfb-run -a node_modules/.bin/electron --no-sandbox scripts/qa-plugin-gui.cjs
npm run dist:linux
xvfb-run -a node scripts/qa-packaged-smoke.cjs
```

Windows cross-builds on Linux, with MinGW installed:

```sh
npm run build:plugin-host:windows
node scripts/build-plugin-fixtures.cjs --windows
npm run dist:win
node scripts/verify-windows-package.cjs
xvfb-run -a -s '-screen 0 1440x1000x24' node scripts/qa-windows-app.cjs
```

This checkout stages Linux and Windows compatibility binaries in separate directories. Windows resources were selected from the existing local 0.1.9 MSI without reading private source; [provenance and hashes](docs/windows-runtime-source.json) are retained. To reproduce staging, use `taskset -c 0 python3 scripts/stage-windows-runtime.py /path/to/Altbase-Wallet-Windows-v0.1.9.msi` (requires `msiinfo` and `libarchive`).

Windows packaging validates PE32+ x64 headers and excludes Linux native Node addons. The packaged Windows native addon was loaded directly, without allowing a JavaScript fallback. `npm run dist:mac` still requires matching staged compatibility binaries; a full macOS application has not been built or tested for this working copy.

The packager uses `--publish never`. Source and release publication are separate explicit operations.

## Profiles and source boundaries

The application ID is `com.altbase.wallet`. The default profile directory is `Altbase` beneath the platform application-data directory; `--altbase-profile=NAME` selects `Altbase Profiles/NAME`, exactly as in the released wallet. New encryption uses the released native envelope; the prior working copy's envelopes are still readable and are converted only after successful authenticated unlock.

All installed coin and mining module code lives under `Altbase/modules` in that application-data directory, independent of the selected profile. Built-in coin packages are installed into that same folder on first start. Added DLL/SO/JavaScript packages go there too; downloaded package versions live beneath its `downloaded` subdirectory. The module page opens this populated common folder. Unmodified defaults can update with the wallet; custom changes and deliberately removed defaults are retained. Module data stays in the selected profile's `coin-plugin-data/<coin-id>` directory.

The previous `AltbaseFullNode` and `AltbaseFullNode Profiles` directories are preserved. They are not blindly merged into a populated released profile. To open a previous working-copy profile explicitly, pass `--altbase-storage=fullnode` (and the same `--altbase-profile=NAME` if applicable). Namespace compatibility keeps the original encrypted values, avoids mixing two populated wallets, and converts a working-copy envelope to the released format after a correct password. Existing real profiles were not opened or migrated during verification.

Protected wallet source and credentials are excluded from the review export and new upload operations. Existing protected files in remote repositories remain unchanged. Linux compatibility binaries were taken from the existing 0.1.9 release; their private/native source is not required by the new plugin host or profile vault.

See [the plugin API](docs/PLUGIN-API.md) for development and [the current audit report](docs/AUDIT-2026-09-24.md) for evidence and remaining limits. The [initial verification report](docs/VERIFICATION.md) records the earlier 0.1.0 build.

## Release updates and source repositories

The application checks `https://api.altbase.io/api/v1/app/update` and displays a verified newer release through its update notice. Optional notices can be dismissed for the local day. An unavailable feed does not prevent startup. Downloads open the official website or the official wallet release repository.

Every coin and feature module remains in its own repository; the main repository pins them as Git submodules. `GITHUB-REPOSITORIES.json` records the source directories and repositories. Use `git clone --recurse-submodules https://github.com/AltbaseWallet/AltbaseWallet.git` for a complete checkout. A populated local export already includes its public module source. The local protected vault implementation is required for a fresh vault compilation; it is never substituted or included in new uploads.

Current application changes are described in [CHANGELOG.md](CHANGELOG.md). PublicNode discovery restrictions, externally missing token icons and the unavailable macOS build toolchain remain explicit platform limits.
