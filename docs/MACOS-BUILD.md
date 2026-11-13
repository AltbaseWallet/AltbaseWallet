# macOS universal release builds on Linux

Compile only on Linux with CPU affinity restricted to one core. `npm run dist:mac`
builds the Intel and Apple Silicon plugin hosts, stages both full applications,
merges and ad-hoc signs their Mach-O resources, validates the result and writes
`artifacts/Altbase-Wallet-macOS-universal-v<version>.zip`.

Prerequisites: installed locked npm dependencies, a current `npm run build`
frontend, compiled account programs (`node scripts/build-account-modules.mjs
--macos`), staged and hash-verified Darwin coin engines/runtimes, osxcross with a
compatible macOS SDK, `lipo`, and `rcodesign`. Keep the owner-maintained private
implementation local and unchanged; it is needed by the compiler but excluded
from source publication. This project does not distribute that source.

`scripts/build-macos-openssl.py` compiles the checksum-pinned OpenSSL 3.5.9 LTS
static vault dependency for both CPUs. It does not replace prebuilt legacy coin
engines. The toolchain locator defaults to `~/.cache/altbase-build`; overrides:
`ALTBASE_OSXCROSS_ROOT`, `ALTBASE_MACOS_SDK`, `ALTBASE_MACOS_DEPS_ROOT`,
`ALTBASE_OSXCROSS_COMPAT_LIBS`, `ALTBASE_RCODESIGN`, and
`ALTBASE_MACOS_ELECTRON_ROOT`. See `scripts/macos-toolchain.cjs` for exact paths.
Place official version-matched Electron distributions, verified against their
official SHA256SUMS, under `unpacked-darwin-x64` and `unpacked-darwin-arm64`.
The branded ICNS is included at `build/icon.icns`.

Start with empty `local-checks/macos-package/darwin-x64`,
`local-checks/macos-package/darwin-arm64` and `artifacts/mac-universal` outputs.
Do not remove source, dependencies or wallet profiles. Packaging refuses to
replace an assembled universal app implicitly. Intermediate architecture apps
can be removed after ZIP validation. The final ZIP preserves executable modes
and relative framework symlinks. Validation checks architecture, CodeDirectory
page hashes, per-entry checksums, CRCs, bundle metadata and foreign executables.

The minimum supported system is macOS 12. This environment cannot execute a
native Mac GUI or provide Apple notarization. Ad-hoc signing does not confer
Developer ID trust. Native installation and GUI testing still require a Mac.
