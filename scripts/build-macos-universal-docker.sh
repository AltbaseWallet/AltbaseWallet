#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ALTBASE_MACOS_BUILD_ROOT:-/opt/altbase-wallet-build}"
SOURCE_DIR="${ALTBASE_MACOS_SOURCE_DIR:-$ROOT_DIR/source}"
DOCKER_DIR="$ROOT_DIR/docker"
SDK_DIR="${ALTBASE_MACOS_SDK_DIR:-$ROOT_DIR/macos-sdk}"
OSXCROSS_DIR="${ALTBASE_OSXCROSS_DIR:-$ROOT_DIR/osxcross}"
DOWNLOADS_DIR="${ALTBASE_DOWNLOADS_DIR:-$ROOT_DIR/downloads}"
SDK_URL="${ALTBASE_MACOS_SDK_URL:-https://github.com/alexey-lysiuk/macos-sdk/releases/download/15.5/MacOSX15.5.tar.xz}"
OSXCROSS_COMMIT="${ALTBASE_OSXCROSS_COMMIT:-b406d657b933f40a4961cc253bcb8e549f041218}"
MACOS_MIN_VERSION="${ALTBASE_MACOS_MIN_VERSION:-12.0}"
IMAGE_NAME="${ALTBASE_MACOS_IMAGE:-altbase-wallet-builder:macos-universal}"
CONTAINER_NAME="${ALTBASE_MACOS_CONTAINER:-altbase-wallet-build-macos-universal}"
ARTIFACT_NAME="${ALTBASE_MACOS_ARTIFACT:-Altbase-Wallet-macOS-universal.zip}"
LEGACY_ARTIFACT_NAME="${ALTBASE_MACOS_LEGACY_ARTIFACT:-Altbase-Wallet-macOS-x64.zip}"
BUILD_JOBS="${ALTBASE_BUILD_JOBS:-2}"
REFRESH_DEPENDENCIES="${ALTBASE_REFRESH_MACOS_DEPS:-0}"
CACHE_DIR="${ALTBASE_MACOS_CACHE_DIR:-$ROOT_DIR/cache/macos}"
ZANO_DEPS_DIR="${ALTBASE_ZANO_MACOS_DEPS_DIR:-$ROOT_DIR/dependencies/zano-macosx}"

if ! [[ "$BUILD_JOBS" =~ ^[12]$ ]]; then
  echo "ALTBASE_BUILD_JOBS must be 1 or 2: $BUILD_JOBS" >&2
  exit 1
fi
if ! [[ "$REFRESH_DEPENDENCIES" =~ ^[01]$ ]]; then
  echo "ALTBASE_REFRESH_MACOS_DEPS must be 0 or 1: $REFRESH_DEPENDENCIES" >&2
  exit 1
fi

mkdir -p "$DOCKER_DIR" "$SDK_DIR" "$OSXCROSS_DIR" "$DOWNLOADS_DIR" \
  "$CACHE_DIR/npm" "$CACHE_DIR/cargo-registry" "$CACHE_DIR/cargo-git" \
  "$CACHE_DIR/dependencies" "$ZANO_DEPS_DIR"

test -f "$SOURCE_DIR/package.json"
for dependency in \
  libzano-plain-wallet.xcframework/macos-arm64_x86_64/libzano-plain-wallet.a \
  libboost.xcframework/macos-arm64_x86_64/libboost.a \
  libopenssl.xcframework/macos-arm64_x86_64/libopenssl.a \
  libiconv.xcframework/macos-arm64_x86_64/libiconv.a; do
  test -f "$ZANO_DEPS_DIR/$dependency"
done

SDK_ARCHIVE_NAME="$(basename "$SDK_URL")"
SDK_BUNDLE_NAME="${SDK_ARCHIVE_NAME%.tar.xz}.sdk"
if [[ ! -f "$SDK_DIR/$SDK_ARCHIVE_NAME" ]]; then
  curl -L --fail --retry 20 --retry-delay 5 --continue-at - \
    -o "$SDK_DIR/$SDK_ARCHIVE_NAME" "$SDK_URL"
fi

cat > "$DOCKER_DIR/Dockerfile.macos-universal" <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH="${CARGO_HOME}/bin:/opt/osxcross/target/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash bzip2 ca-certificates clang cmake cpio curl file g++ gcc git git-lfs gnupg \
  libbz2-dev liblzma-dev libssl-dev libxml2-dev llvm-dev make patch python3 rsync unzip \
  uuid-dev xz-utils zlib1g-dev \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["/bin/bash"]
DOCKER

docker_build_args=(--pull)
if [[ "$REFRESH_DEPENDENCIES" == "1" ]]; then
  docker_build_args+=(--no-cache)
fi
docker build "${docker_build_args[@]}" -t "$IMAGE_NAME" \
  -f "$DOCKER_DIR/Dockerfile.macos-universal" "$DOCKER_DIR"

for stale_container in "$CONTAINER_NAME" altbase-wallet-build-macos-x64; do
  if docker inspect "$stale_container" >/dev/null 2>&1; then
    docker rm -f "$stale_container" >/dev/null
  fi
done

docker create -it --name "$CONTAINER_NAME" \
  -e ALTBASE_BUILD_JOBS="$BUILD_JOBS" \
  -e JOBS="$BUILD_JOBS" \
  -e MAKEFLAGS="-j$BUILD_JOBS" \
  -e CMAKE_BUILD_PARALLEL_LEVEL="$BUILD_JOBS" \
  -e CARGO_BUILD_JOBS="$BUILD_JOBS" \
  -e ALTBASE_REFRESH_MACOS_DEPS="$REFRESH_DEPENDENCIES" \
  -e CARGO_NET_RETRY=100 -e CARGO_HTTP_TIMEOUT=600 \
  -e CARGO_HTTP_LOW_SPEED_LIMIT=1 -e CARGO_HTTP_MULTIPLEXING=false \
  -e ALTBASE_DEPENDENCY_CACHE_DIR=/dependencies \
  -v "$SOURCE_DIR:/workspace" -v "$SDK_DIR:/sdk" \
  -v "$OSXCROSS_DIR:/opt/osxcross" -v "$DOWNLOADS_DIR:/out" \
  -v "$ZANO_DEPS_DIR:/dependencies/zano-macosx:ro" \
  -v "$CACHE_DIR/npm:/root/.npm" \
  -v "$CACHE_DIR/cargo-registry:/usr/local/cargo/registry" \
  -v "$CACHE_DIR/cargo-git:/usr/local/cargo/git" \
  -v "$CACHE_DIR/dependencies:/dependencies" \
  "$IMAGE_NAME" /bin/bash >/dev/null

docker start "$CONTAINER_NAME" >/dev/null
docker exec \
  -e SDK_ARCHIVE_NAME="$SDK_ARCHIVE_NAME" \
  -e SDK_BUNDLE_NAME="$SDK_BUNDLE_NAME" \
  -e OSXCROSS_COMMIT="$OSXCROSS_COMMIT" \
  -e MACOS_MIN_VERSION="$MACOS_MIN_VERSION" \
  -e ARTIFACT_NAME="$ARTIFACT_NAME" \
  -e LEGACY_ARTIFACT_NAME="$LEGACY_ARTIFACT_NAME" \
  "$CONTAINER_NAME" bash -lc '
    set -euo pipefail
    cd /workspace
    export JOBS="$ALTBASE_BUILD_JOBS"
    export MAKEFLAGS="-j$ALTBASE_BUILD_JOBS"
    export CMAKE_BUILD_PARALLEL_LEVEL="$ALTBASE_BUILD_JOBS"
    export CARGO_BUILD_JOBS="$ALTBASE_BUILD_JOBS"

    installed_commit="$(git -C /opt/osxcross rev-parse HEAD 2>/dev/null || true)"
    rebuild_osxcross=0
    [[ "$ALTBASE_REFRESH_MACOS_DEPS" == "1" ]] && rebuild_osxcross=1
    [[ "$installed_commit" != "$OSXCROSS_COMMIT" ]] && rebuild_osxcross=1
    [[ ! -x /opt/osxcross/target/bin/o64-clang++ ]] && rebuild_osxcross=1
    [[ -z "$(find /opt/osxcross/target/bin -maxdepth 1 -name "aarch64-apple-darwin*-clang++" -print -quit 2>/dev/null)" ]] && rebuild_osxcross=1
    [[ ! -d "/opt/osxcross/target/SDK/$SDK_BUNDLE_NAME" ]] && rebuild_osxcross=1

    if [[ "$rebuild_osxcross" == "1" ]]; then
      rm -rf /tmp/osxcross-src
      git clone https://github.com/tpoechtrager/osxcross.git /tmp/osxcross-src
      git -C /tmp/osxcross-src checkout --detach "$OSXCROSS_COMMIT"
      find /opt/osxcross -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      cp -a /tmp/osxcross-src/. /opt/osxcross/
      mkdir -p /opt/osxcross/tarballs
      cp "/sdk/$SDK_ARCHIVE_NAME" /opt/osxcross/tarballs/
      (
        cd /opt/osxcross
        UNATTENDED=1 OSX_VERSION_MIN="$MACOS_MIN_VERSION" ./build.sh
      )
    fi

    export PATH="/usr/local/cargo/bin:/opt/osxcross/target/bin:$PATH"
    export SDK_PATH="/opt/osxcross/target/SDK/$SDK_BUNDLE_NAME"
    export SDKROOT="$SDK_PATH"
    export CMAKE_OSX_SYSROOT="$SDK_PATH"
    export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION"
    test -d "$SDK_PATH"

    find_tool() {
      local result
      result="$(find /opt/osxcross/target/bin -maxdepth 1 -name "$1" | sort | head -n 1)"
      test -n "$result"
      printf "%s" "$result"
    }
    X64_CC="$(find_tool "x86_64-apple-darwin*-clang")"
    X64_CXX="$(find_tool "x86_64-apple-darwin*-clang++")"
    X64_LD="$(find_tool "x86_64-apple-darwin*-ld")"
    X64_AR="$(find_tool "x86_64-apple-darwin*-ar")"
    X64_RANLIB="$(find_tool "x86_64-apple-darwin*-ranlib")"
    ARM64_CC="$(find_tool "aarch64-apple-darwin*-clang")"
    ARM64_CXX="$(find_tool "aarch64-apple-darwin*-clang++")"
    ARM64_LD="$(find_tool "aarch64-apple-darwin*-ld")"
    ARM64_AR="$(find_tool "aarch64-apple-darwin*-ar")"
    ARM64_RANLIB="$(find_tool "aarch64-apple-darwin*-ranlib")"
    INSTALL_NAME_TOOL="$(find_tool "*install_name_tool")"
    LIPO="$(find_tool "*-lipo")"

    zano_macos_root=native/vendor/zano_native_lib/_install_macosx
    rm -rf "$zano_macos_root"
    mkdir -p "$zano_macos_root"
    rsync -a /dependencies/zano-macosx/ "$zano_macos_root/"
    for library in \
      "$zano_macos_root/libzano-plain-wallet.xcframework/macos-arm64_x86_64/libzano-plain-wallet.a" \
      "$zano_macos_root/libboost.xcframework/macos-arm64_x86_64/libboost.a" \
      "$zano_macos_root/libopenssl.xcframework/macos-arm64_x86_64/libopenssl.a" \
      "$zano_macos_root/libiconv.xcframework/macos-arm64_x86_64/libiconv.a"; do
      "$LIPO" "$library" -verify_arch x86_64 arm64
    done
    test -f "$zano_macos_root/libboost.xcframework/macos-arm64_x86_64/Headers/boost/version.hpp"

    rustup target add x86_64-apple-darwin aarch64-apple-darwin
    export CC_x86_64_apple_darwin="$X64_CC"
    export CXX_x86_64_apple_darwin="$X64_CXX"
    export AR_x86_64_apple_darwin="$X64_AR"
    export CARGO_TARGET_X86_64_APPLE_DARWIN_LINKER="$X64_CC"
    export CC_aarch64_apple_darwin="$ARM64_CC"
    export CXX_aarch64_apple_darwin="$ARM64_CXX"
    export AR_aarch64_apple_darwin="$ARM64_AR"
    export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$ARM64_CC"

    rm -rf dist release native-core native-core-x64 native-core-arm64 \
      native/core/build/macos-x64-release native/core/build/macos-arm64-release \
      native/epic_core/target/x86_64-apple-darwin/release \
      native/epic_core/target/aarch64-apple-darwin/release

    bash scripts/build-kaspa-wallet-wasm.sh
    npm ci --prefer-offline --no-audit --no-fund

    # @electron/universal only uses portable filesystem/ASAR logic plus lipo,
    # but rejects non-Darwin hosts before that work starts. osxcross provides
    # the required lipo implementation for this cross-build container.
    for universal_impl in \
      node_modules/@electron/universal/dist/cjs/index.js \
      node_modules/@electron/universal/dist/esm/index.js; do
      test -f "$universal_impl"
      sed -i "/if (process.platform !== '\''darwin'\'')/,+1d" "$universal_impl"
      if grep -q "only supported on darwin platforms" "$universal_impl"; then
        echo "Unable to enable universal packaging in the cross-build container: $universal_impl" >&2
        exit 1
      fi
    done
    ln -sf "$LIPO" /usr/local/bin/lipo

    build_native_arch() {
      local arch="$1" rust_target="$2" cc="$3" cxx="$4" ld="$5" ar="$6" ranlib="$7"
      local epic_target="native/target-epic-modular-macos-$arch"
      local epic_release="$epic_target/$rust_target/release"
      local build_dir="native/core/build/macos-$arch-release"
      local cmake_arch="$arch"
      [[ "$cmake_arch" == "x64" ]] && cmake_arch="x86_64"

      CFLAGS="-fuse-ld=$ld" CXXFLAGS="-fuse-ld=$ld" \
        cargo build --release --locked --target "$rust_target" --manifest-path native/epic_transport/Cargo.toml --target-dir "$epic_target" -j "$ALTBASE_BUILD_JOBS"
      "$INSTALL_NAME_TOOL" -id "@loader_path/libaltbase_epic_transport.dylib" "$epic_release/libaltbase_epic_transport.dylib"
      export ALTBASE_EPIC_TRANSPORT_LIB_DIR="$PWD/$epic_release"
      CFLAGS="-fuse-ld=$ld" CXXFLAGS="-fuse-ld=$ld" \
        cargo build --release --locked --target "$rust_target" --manifest-path native/epic_state/Cargo.toml --target-dir "$epic_target" -j "$ALTBASE_BUILD_JOBS"
      CFLAGS="-fuse-ld=$ld" CXXFLAGS="-fuse-ld=$ld" \
        cargo build --release --locked --target "$rust_target" --manifest-path native/epic_sender/Cargo.toml --target-dir "$epic_target" -j "$ALTBASE_BUILD_JOBS"
      mkdir -p "native/epic_core/target/$rust_target/release"
      for module in state sender transport; do
        "$INSTALL_NAME_TOOL" -id "@loader_path/libaltbase_epic_$module.dylib" "$epic_release/libaltbase_epic_$module.dylib"
        cp "$epic_release/libaltbase_epic_$module.dylib" "native/epic_core/target/$rust_target/release/"
      done

      cmake -S native/core -B "$build_dir" -G "Unix Makefiles" \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=Darwin \
        -DCMAKE_OSX_SYSROOT="$SDK_PATH" -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION" \
        -DCMAKE_OSX_ARCHITECTURES="$cmake_arch" -DCMAKE_C_COMPILER="$cc" \
        -DCMAKE_CXX_COMPILER="$cxx" -DCMAKE_LINKER="$ld" \
        -DCMAKE_AR="$ar" -DCMAKE_RANLIB="$ranlib" \
        -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=$ld" -DCMAKE_SHARED_LINKER_FLAGS="-fuse-ld=$ld" \
        -DCMAKE_FIND_ROOT_PATH="$SDK_PATH;/opt/osxcross/target" \
        -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER \
        -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY \
        -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY \
        -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH
      cmake --build "$build_dir" --parallel "$ALTBASE_BUILD_JOBS"

      rm -rf native-core
      ALTBASE_TARGET_PLATFORM=darwin ALTBASE_TARGET_ARCH="$arch" node scripts/copy-native-core.cjs
      for module in state sender transport; do
        "$INSTALL_NAME_TOOL" -id "@loader_path/libaltbase_epic_$module.dylib" "native-core/libaltbase_epic_$module.dylib"
      done
      mv native-core "native-core-$arch"
    }

    build_native_arch x64 x86_64-apple-darwin "$X64_CC" "$X64_CXX" "$X64_LD" "$X64_AR" "$X64_RANLIB"
    build_native_arch arm64 aarch64-apple-darwin "$ARM64_CC" "$ARM64_CXX" "$ARM64_LD" "$ARM64_AR" "$ARM64_RANLIB"

    x64_files="$(cd native-core-x64 && find . -maxdepth 1 -type f -printf "%f\n" | sort)"
    arm64_files="$(cd native-core-arm64 && find . -maxdepth 1 -type f -printf "%f\n" | sort)"
    [[ "$x64_files" == "$arm64_files" ]]
    mkdir -p native-core
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      if "$LIPO" "native-core-x64/$name" -info >/dev/null 2>&1 && \
         "$LIPO" "native-core-arm64/$name" -info >/dev/null 2>&1; then
        "$LIPO" -create "native-core-x64/$name" "native-core-arm64/$name" -output "native-core/$name"
        "$LIPO" "native-core/$name" -verify_arch x86_64 arm64
        chmod 0755 "native-core/$name"
      else
        cmp "native-core-x64/$name" "native-core-arm64/$name"
        cp "native-core-x64/$name" "native-core/$name"
      fi
    done <<< "$x64_files"

    npm test
    npm run build:release
    package_attempt=0
    while true; do
      rm -rf release/mac-universal release/mac-universal-x64-temp release/mac-universal-arm64-temp
      rm -f release/Altbase-Wallet-macOS-universal.zip
      if CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac zip --universal --config.mac.identity=null --publish never; then
        break
      fi
      package_attempt=$((package_attempt + 1))
      if [[ "$package_attempt" -ge 3 ]]; then
        echo "macOS universal packaging failed after $package_attempt attempts" >&2
        exit 1
      fi
      echo "macOS packaging interrupted; retrying with preserved downloads in 30 seconds"
      sleep 30
    done

    zip_path="$(find release -maxdepth 1 -type f -name "*macOS*universal*.zip" | head -n 1)"
    test -n "$zip_path"
    install -m 0644 "$zip_path" "/out/$ARTIFACT_NAME"
    rm -f "/out/$LEGACY_ARTIFACT_NAME"
    ln "/out/$ARTIFACT_NAME" "/out/$LEGACY_ARTIFACT_NAME"

    verify_root="$(mktemp -d)"
    trap '\''rm -rf "$verify_root"'\'' EXIT
    unzip -q "/out/$ARTIFACT_NAME" -d "$verify_root"
    app_path="$(find "$verify_root" -maxdepth 2 -type d -name "*.app" | head -n 1)"
    test -n "$app_path"
    macho_count=0
    while IFS= read -r binary; do
      if file "$binary" | grep -q "Mach-O"; then
        "$LIPO" "$binary" -verify_arch x86_64 arm64
        macho_count=$((macho_count + 1))
      fi
    done < <(find "$app_path" -type f)
    [[ "$macho_count" -gt 20 ]]

    APP_PATH="$app_path" python3 - <<'PY'
import json
import os
import plistlib
from pathlib import Path

app = Path(os.environ["APP_PATH"])
with (app / "Contents" / "Info.plist").open("rb") as handle:
    info = plistlib.load(handle)
assert info["CFBundleShortVersionString"] == "0.1.6", info
assert info.get("LSMinimumSystemVersion") == "12.0", info
assert info.get("LSArchitecturePriority", [None])[0] == "arm64", info
module_root = app / "Contents" / "Resources" / "modules" / "mining"
descriptor = json.loads((module_root / "module.json").read_text())
manifest = json.loads((module_root / "package.manifest.json").read_text())
assert descriptor["updates"]["repository"] == "AltbaseWallet/module-mining"
assert "macos-arm64" in descriptor["platforms"]
assert manifest["version"] == "0.1.6"
assert manifest["releaseEpoch"] == 2
assert manifest["signature"]["algorithm"] == "ed25519"
PY

    (cd /out && sha256sum "$ARTIFACT_NAME" "$LEGACY_ARTIFACT_NAME" > macos-checksums.txt)
    echo "Verified $macho_count universal Mach-O files."
    node --version
    npm --version
    rustc --version
    cmake --version | head -n 1
    git -C /opt/osxcross rev-parse HEAD
  '

ls -lh "$DOWNLOADS_DIR/$ARTIFACT_NAME" \
  "$DOWNLOADS_DIR/$LEGACY_ARTIFACT_NAME" "$DOWNLOADS_DIR/macos-checksums.txt"
