# Reference wallet build inputs

The wallet release includes local Xelis 1.25.0 and MWC 6.0.1 executables. These processes hold wallet secrets locally; the Altbase API only relays public blockchain requests. Licenses are shipped beside each executable and under the owning coin module.

Run `node scripts/prepare-coin-runtimes.cjs --target=linux --arch=x64`, substituting `windows/x64` or `macos/universal`. The script verifies pinned upstream archive SHA-256 values, or builds unavailable macOS targets from exact upstream commits with Rust 1.97.0 and Cargo `--locked --jobs 1`. Source builds require the target Apple SDK/toolchain and its native dependencies, including OpenSSL for MWC. On macOS, use the native Apple toolchain and install the requested Rust target. Cross builds require configured Cargo linkers, C/C++ compilers, and target dependency paths. Windows packaging requires MinGW-w64 for the private console helper; set `ALTBASE_MINGW_CC` if necessary.

Source pins:

- Xelis: `xelis-project/xelis-blockchain`, commit `db59b5c246ab0e40386d6c241dcd77f0aea84b10`.
- MWC: `mwcproject/mwc-wallet`, commit `2fb156ac2952b61b59887a020465ba0d10ae0c53`.

`coin-runtimes/manifest.json` records the resulting executable hashes. `scripts/stage-coin-runtimes.cjs` verifies every hash before copying the selected platform into release resources. Never package a user's `local-wallets` directory. The clean source export excludes generated reference binaries and all wallet profiles.

Compilation for the September 2026 release is restricted to one CPU: Linux build commands run under `taskset -c 0`, Cargo uses one job, and architecture builds run sequentially.
