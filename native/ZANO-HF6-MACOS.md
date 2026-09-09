# Zano HF6 macOS universal cross build

The reviewed snapshot contains patched Zano 2.2.1.505. Both x86_64 and arm64 modules were built on Linux with CPU affinity 0 and one CMake job. The build uses osxcross with MacOSX15.5.sdk and deployment target 12.0, plus prepared Boost 1.84, OpenSSL and iconv static libraries for each architecture.

```sh
taskset -c 0 python3 scripts/prepare-zano-hf6-macos.py \
  --output "$TASK_MAC_BUILD" --osxcross "$TASK_OSXCROSS_TARGET" \
  --dependencies "$TASK_MAC_DEPS"
taskset -c 0 python3 scripts/link-zano-hf6-macos.py \
  --build-root "$TASK_MAC_BUILD" --osxcross "$TASK_OSXCROSS_TARGET" \
  --dependencies "$TASK_MAC_DEPS"
```

Use `--host-libraries` for the Linux shared-library directory required by the cached osxcross linker. All other arguments are explicit local paths. The linker compiles an explicit allowlist and reuses existing storage objects from native/core/build/macos-{x64,arm64}-release. These objects and the restricted storage source are not included in the source snapshot; the owner must supply them independently. Remaining native dependencies must be prepared in the same core build directories.

The universal outputs were checked for both architectures and for portable dylib dependencies. The app.asar header hash in Info.plist was updated. The review ZIP uses local ad-hoc code signatures and is not Apple notarized. macOS runtime execution was not available on the Linux build host. Linux test execution covers 13 readiness cases, 3 scan-info mocks and 3 public HF6 decode fixtures; macOS fixture executables were cross-compiled only.
