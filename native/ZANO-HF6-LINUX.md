# Linux Zano HF6 read compatibility (2026-09-08)

The verified candidate uses Zano **2.2.1.505**, commit
`e30cf971b8b83c925252c0198f7ee482cdec34a4`. The previously packaged
2.1.16.465 codec cannot decode the three public HF6 transaction fixtures.
A fixture pass proves codec compatibility; it does not prove a profile has
finished scanning. Live reads resumed on the existing native profiles. See the continuation
evidence for per-profile scan heights and balances; an unfinished scan is not
a verified zero balance.

Source archive:
`https://codeload.github.com/hyle-team/zano/tar.gz/refs/tags/2.2.1.505`

Archive SHA-256:
`3f88b1eee420e450a5407596027819d2e45dab7e3202ca7182dac5e17d0f8d41`

The prepared source is `/home/user/.cache/altbase-build/zano-hf6-20260908/upstream`;
the build is in the adjacent `build` directory. The source archive is retained
as `source-http1.tar.gz`. Other incomplete downloads in that cache are not
build inputs. Public dependencies `contrib/miniupnp` and `contrib/jwt-cpp`
were copied from the existing vendored source. The reproducible source patch
is [patches/zano-2.2.1.505-altbase.patch](patches/zano-2.2.1.505-altbase.patch).
It preserves Altbase's JSON IPC stdout discipline, eager output refresh and
restore-height overload; it also fixes the upstream disabled-PFR compile
guard and omits LTO/debug symbols for the isolated upstream build.

Configure the prepared tree (the patch must already be applied):

```sh
TASK_ZANO_CACHE=/home/user/.cache/altbase-build/zano-hf6-20260908
taskset -c 0 cmake -S "$TASK_ZANO_CACHE/upstream" -B "$TASK_ZANO_CACHE/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=/usr/bin/gcc-13 \
  -DCMAKE_CXX_COMPILER=/usr/bin/g++-13 -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DARCH=default -DBUILD_GUI=OFF -DBUILD_TESTS=OFF -DSTATIC=OFF -DDISABLE_TOR=ON \
  -DGIT= -DCOMMIT=e30cf971b8b83c925252c0198f7ee482cdec34a4 \
  -DBoost_DIR=/usr/lib/x86_64-linux-gnu/cmake/Boost-1.83.0 \
  -DBoost_INCLUDE_DIR=/usr/include -DBoost_NO_SYSTEM_PATHS=OFF \
  -DCMAKE_CXX_FLAGS_RELEASE='-O2 -DNDEBUG' -DCMAKE_C_FLAGS_RELEASE='-O2 -DNDEBUG' \
  '-DCMAKE_CXX_FLAGS=-DMOBILE_WALLET_BUILD=1 -DALTBASE_RELEASE_BINARY=1 -DDISABLE_PFR_SERIALIZATION_SELFCHECK'
taskset -c 0 cmake --build "$TASK_ZANO_CACHE/build" --parallel 1 \
  --target wallet rpc currency_core crypto common zlibstatic libminiupnpc-static
python3 scripts/build-zano-hf6-linux.py \
  --source "$TASK_ZANO_CACHE/upstream" --build "$TASK_ZANO_CACHE/build" \
  --output "$TASK_ZANO_CACHE"
python3 tests/runZanoHf6Decode.py --cache "$TASK_ZANO_CACHE"
```

The two Python build/test helpers pin their process tree to one CPU themselves.
The core wrapper and privacy read adapter are the only Altbase C++ sources
compiled. Other adapter objects are reused. Do not invoke a complete native
build under the current source-access restriction. Both rebuilt modules use
the HF6 headers/libraries. The read adapter handles the additional decoded
payment-ID output parameter without changing the displayed balance.

`-DGIT=` selects libmdbx's source-archive metadata fallback (version 0.0.0.0);
it does not change its storage implementation. The actual Zano release and
archive provenance are retained separately. Linux CMake accepts explicit
`ZANO_SOURCE_ROOT` and `ZANO_LINUX_BUILD_ROOT` paths, and links the required
HF6 `backtrace`/`dl` support. The dedicated helper rejects unresolved core
symbols and uses the host C++ runtime while retaining GCC 13 compatibility
with reused LTO objects.

The packaged native modules have been loaded against the bundled libraries.
The primary AppImage and earlier tar archive are preserved. Existing profiles
and scan databases are excluded from the new package.

Readiness additionally requires a valid daemon height and wallet state. The native
wallet top index is converted to a scanned-block count before comparison with
server height; a state value or positive cached balance alone does not prove
completion. `tests/zanoNativeReadiness.cpp` covers the one-block boundary and
missing, malformed, stale and overflowing height values (13 cases).
