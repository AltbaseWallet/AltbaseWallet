# Source review and publication scope — 0.1.8

The reviewed local source is published through the existing per-module Git
repositories. The main wallet uses pinned submodule commits from `.gitmodules`.
The Nonsense module has its own repository; existing Monero, XGR, Mining and
other module repositories retain their histories.

See [CHANGELOG.md](CHANGELOG.md) for changes from 0.1.7.

## Source verification

The source cleanup on 2026-09-09 verified 6,202 ordinary source files against
the manifest and found no unexpected differences from the intended working
sources. Deliberate export changes included cleanup of local wallet diagnostics,
corrected Git ignores, source documentation and the patched Zano HF6 trees.
Git inclusion checks passed, and all tested documentation links resolved.

The owner subsequently provided `native/core/src/wallet_secret.cpp` for
publication. It is handled by Git as an opaque file and its content was not
inspected. The native SDK's previously published storage file is preserved by
its existing Git blob reference. These files are outside the content scan;
no replacement implementation was written. SOURCE-MANIFEST.json distinguishes
reviewed file hashes from owner-provided or preserved protected Git objects.

Ordinary source was checked for known user recovery inputs, private-key blocks
and credential-token patterns without printing secrets. No matches requiring
removal remained. Public synthetic fixtures, dependency names and interface
labels account for the retained scanner findings. Profiles, environment files,
private signing keys, local wallet-operation logs and compiled outputs are not
part of the source commits. The publication credential is kept in process memory
and is not written into Git URLs, configuration, source files or reports.

## Build and test evidence

An isolated copy passed these checks on 2026-09-09, with compilation pinned to
CPU 0:

- `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`.
- Detached WASM restoration with SHA-256 and exact file-list verification.
- `npm run build:release`, including TypeScript and signed Mining verification.
- `npm test`: 135 wallet tests and 11 Mining tests passed, with no failures or skips.

The tested application source is unchanged by the publication layout and
changelog updates. Vite's bundle-size warning and npm's transitive dependency
deprecation warnings remain. This pass is not a dependency vulnerability audit
or a new full native rebuild. macOS runtime testing and notarization were not
performed. Publication does not access live wallets or perform transactions.

## Detached WASM runtime

The source-only export omits four compiled WASM/runtime files. The existing
`Altbase-WASM-runtime-v0.1.7.zip` bundle remains compatible with wallet 0.1.8.
Its SHA-256 is:

`7a5fa2cd5e4be6d144125c4ac875fec712310f3a6bc5f6028117c1f7b4a8c6dc`

Restore a verified bundle before dependency installation and frontend builds:

```sh
python3 scripts/restore-vendor-runtime.py /path/to/Altbase-WASM-runtime-v0.1.7.zip
npm ci
taskset -c 0 npm run build:release
taskset -c 0 npm test
```

Native builds require their platform SDKs and protocol dependencies. See
[native/ZANO-HF6-LINUX.md](native/ZANO-HF6-LINUX.md),
[native/ZANO-HF6-WINDOWS.md](native/ZANO-HF6-WINDOWS.md),
[native/ZANO-HF6-MACOS.md](native/ZANO-HF6-MACOS.md) and
[modules/bitcoin2/README.md](modules/bitcoin2/README.md).
