# Windows HF6 build on Linux (2026-09-08 UTC)

Compilation and linking run on Linux with CPU affinity **0** and one build job.
Windows is used only to install and execute the resulting binaries and GUI tests.
No restricted source is opened or compiled: the wrapper linker uses a named source
allowlist and reuses an existing storage object. User profiles are excluded from
the installer and GUI fixture package.

## Inputs

- Zano 2.2.1.505, commit `e30cf971b8b83c925252c0198f7ee482cdec34a4`, with the
  existing [Altbase patch](patches/zano-2.2.1.505-altbase.patch). Archive provenance
  and the Linux recipe are in [the Linux build note](ZANO-HF6-LINUX.md).
- [Boost 1.84.0 Windows x64 MSVC 14.3](https://www.boost.org/releases/1.84.0/),
  `boost_1_84_0-msvc-14.3-64.exe`, SHA-256
  `b14090362af9730ed9cc125b456a76d981b010060ee30e6d2eb109f8144fa444`.
  Extracted locally with innoextract. Its static MSVC ABI archives are linked
  explicitly; aliases satisfy autolink names left by clang-cl upstream objects.
- [OpenSSL 3.5.7 source tag](https://github.com/openssl/openssl/releases/tag/openssl-3.5.7),
  codeload archive `https://codeload.github.com/openssl/openssl/tar.gz/refs/tags/openssl-3.5.7`,
  SHA-256 `d71a811bfbd9153d7b30cbe476263302ee4b04a9a47ffea6e6a782326805c93f`.
- Local clang-cl/lld-link/LLVM tools 19 and the existing xwin Windows SDK.

Prepared inputs and logs: `/home/user/.cache/altbase-build/zano-windows-hf6-20260908`.
The original Windows payload and MSI are retained in its `previous-windows-payload`.

## Reproduction

The OpenSSL [target configuration](patches/windows-cross/openssl-3.5.7-altbase-cross.conf)
and [platform helper](patches/windows-cross/AltbaseCross.pm) combine its Windows
platform definitions with the Unix make generator. Set `ALTBASE_WINDOWS_CC` to a
local wrapper invoking `clang-cl-19 --target=x86_64-pc-windows-msvc` with the xwin
CRT, UCRT, shared and UM include paths. Copy the configuration to `Configurations/`
and the helper to `Configurations/platform/Unix/` in the source tree. Configure:

```sh
taskset -c 0 perl Configure VC-ALTBASE-LINUX64 no-shared no-asm no-tests no-comp no-uplink \
  --prefix="$TASK_WIN_CACHE/openssl-win" --libdir=lib
taskset -c 0 make -j1 build_libs
```

Copy generated `include/`, `libcrypto.a` and `libssl.a` into `openssl-win`, naming the
COFF archives `lib/libcrypto.lib` and `lib/libssl.lib`. The `.lib` suffix changes no
archive contents. The retained configure and build logs record the actual flags.

Configure the patched Zano tree with Ninja and the
[local MSVC ABI toolchain](patches/windows-cross/clang-msvc.cmake). The cache includes
the exact configure command and `CMakeCache.txt`. Required options are Release,
`BUILD_GUI=OFF`, `BUILD_TESTS=OFF`, `STATIC=ON`, `DISABLE_TOR=ON`, explicit Boost/OpenSSL
paths, `Boost_COMPILER=-vc143`, and the mobile/PFR definitions from the Linux note.
For Linux filesystem case sensitivity use `bcrypt.lib` in the upstream CMake
link flags. Replace upstream `/MP2` with `/MP1` and omit `/Z7` and linker `/DEBUG`.

```sh
taskset -c 0 cmake --build "$TASK_WIN_CACHE/build" --parallel 1 \
  --target wallet rpc currency_core crypto common zlibstatic libminiupnpc-static
python3 scripts/link-zano-hf6-windows.py --cache "$TASK_WIN_CACHE"
```

The linker pins its own process tree to one CPU. Protocol-facing translation
units use C++17 to match upstream; the other wrappers use C++20. Test translation
units explicitly undefine NDEBUG so assertions remain enabled. No whole-project
native build is needed. The modules directory contains hashes and the exact source
allowlist in `build-manifest.json`.

Stage the two Zano DLLs and the current platform-neutral app.asar into the existing
Windows Electron payload, retaining backups, then package locally:

```sh
taskset -c 0 env ALTBASE_CROSS_MSI_TOOLS="$TASK_MSI_TOOLS" ALTBASE_MSI_BACKEND=libmsi \
  node scripts/build-native-installer.cjs
```

All 200 extracted MSI files were compared with the staging files by SHA-256. The
installed app.asar and two Zano DLL hashes were also read back on Windows. Native
public-transaction fixtures, readiness fixtures, installed renderer startup and
18 GUI cases were executed there. Evidence and screenshots are under
`artifacts/windows-continuation-20260908/`. GUI send tests use mocks, never confirm
transfers, and record zero signature/broadcast calls. Live privacy balance reads
remain separate evidence from these fixture results.
