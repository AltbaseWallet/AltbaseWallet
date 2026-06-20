#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ALTBASE_MACOS_BUILD_ROOT:-$HOME/altbase-wallet-build}"
SOURCE_DIR="${ALTBASE_MACOS_SOURCE_DIR:-$ROOT_DIR/source}"
DOCKER_DIR="$ROOT_DIR/docker"
SDK_DIR="${ALTBASE_MACOS_SDK_DIR:-$ROOT_DIR/macos-sdk}"
OSXCROSS_DIR="${ALTBASE_OSXCROSS_DIR:-$ROOT_DIR/osxcross}"
DOWNLOADS_DIR="${ALTBASE_DOWNLOADS_DIR:-$ROOT_DIR/downloads}"
SDK_URL="${ALTBASE_MACOS_SDK_URL:-https://github.com/alexey-lysiuk/macos-sdk/releases/download/15.5/MacOSX15.5.tar.xz}"
MACOS_MIN_VERSION="${ALTBASE_MACOS_MIN_VERSION:-12.0}"
IMAGE_NAME="${ALTBASE_MACOS_IMAGE:-altbase-wallet-builder:macos-x64}"
CONTAINER_NAME="${ALTBASE_MACOS_CONTAINER:-altbase-wallet-build-macos-x64}"
ARTIFACT_NAME="${ALTBASE_MACOS_ARTIFACT:-Altbase-Wallet-macOS-x64.zip}"

mkdir -p "$DOCKER_DIR" "$SDK_DIR" "$OSXCROSS_DIR" "$DOWNLOADS_DIR"

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "Source directory is missing package.json: $SOURCE_DIR" >&2
  exit 1
fi

SDK_ARCHIVE_NAME="$(basename "$SDK_URL")"
if [[ ! -f "$SDK_DIR/$SDK_ARCHIVE_NAME" ]]; then
  curl -L --fail --retry 5 --retry-delay 3 -o "$SDK_DIR/$SDK_ARCHIVE_NAME" "$SDK_URL"
fi

cat > "$DOCKER_DIR/Dockerfile.macos-x64" <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash bzip2 ca-certificates clang cmake cpio curl file g++ gcc git git-lfs gnupg \
  libbz2-dev liblzma-dev libssl-dev libxml2-dev llvm-dev make patch python3 rsync unzip \
  uuid-dev xz-utils zlib1g-dev \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rm -rf /var/lib/apt/lists/*
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH="${CARGO_HOME}/bin:/opt/osxcross/target/bin:${PATH}"
WORKDIR /workspace
CMD ["/bin/bash"]
DOCKER

docker build -t "$IMAGE_NAME" -f "$DOCKER_DIR/Dockerfile.macos-x64" "$DOCKER_DIR"

if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker create -it \
  --name "$CONTAINER_NAME" \
  -v "$SOURCE_DIR:/workspace" \
  -v "$SDK_DIR:/sdk" \
  -v "$OSXCROSS_DIR:/opt/osxcross" \
  -v "$DOWNLOADS_DIR:/out" \
  "$IMAGE_NAME" \
  /bin/bash >/dev/null

docker start "$CONTAINER_NAME" >/dev/null
docker exec \
  -e SDK_ARCHIVE_NAME="$SDK_ARCHIVE_NAME" \
  -e MACOS_MIN_VERSION="$MACOS_MIN_VERSION" \
  -e ARTIFACT_NAME="$ARTIFACT_NAME" \
  "$CONTAINER_NAME" bash -lc '
    set -euo pipefail
    cd /workspace

    if [ ! -x /opt/osxcross/target/bin/o64-clang++ ]; then
      rm -rf /tmp/osxcross-src
      git clone --depth 1 https://github.com/tpoechtrager/osxcross.git /tmp/osxcross-src
      find /opt/osxcross -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      cp -a /tmp/osxcross-src/. /opt/osxcross/
      mkdir -p /opt/osxcross/tarballs
      cp "/sdk/$SDK_ARCHIVE_NAME" /opt/osxcross/tarballs/
      cd /opt/osxcross
      UNATTENDED=1 OSX_VERSION_MIN="$MACOS_MIN_VERSION" ./build.sh
      cd /workspace
    fi

    export PATH="/usr/local/cargo/bin:/opt/osxcross/target/bin:$PATH"
    export SDK_PATH="$(find /opt/osxcross/target/SDK -maxdepth 1 -type d -name '\''MacOSX*.sdk'\'' | sort | tail -n 1)"
    test -n "$SDK_PATH"
    export DARWIN_CC="$(find /opt/osxcross/target/bin -maxdepth 1 -name '\''x86_64-apple-darwin*-clang'\'' | sort | tail -n 1)"
    export DARWIN_CXX="$(find /opt/osxcross/target/bin -maxdepth 1 -name '\''x86_64-apple-darwin*-clang++'\'' | sort | tail -n 1)"
    export LD_BIN="$(find /opt/osxcross/target/bin -maxdepth 1 -name '\''x86_64-apple-darwin*-ld'\'' | sort | tail -n 1)"
    export AR_BIN="$(find /opt/osxcross/target/bin -maxdepth 1 -name '\''x86_64-apple-darwin*-ar'\'' | sort | tail -n 1)"
    export RANLIB_BIN="$(find /opt/osxcross/target/bin -maxdepth 1 -name '\''x86_64-apple-darwin*-ranlib'\'' | sort | tail -n 1)"
    export INSTALL_NAME_TOOL="$(find /opt/osxcross/target/bin -maxdepth 1 -name '\''*install_name_tool'\'' | sort | tail -n 1)"
    test -n "$DARWIN_CC"
    test -n "$DARWIN_CXX"
    test -n "$LD_BIN"
    test -n "$AR_BIN"
    test -n "$RANLIB_BIN"
    test -n "$INSTALL_NAME_TOOL"

    rustup target add x86_64-apple-darwin
    export CC_x86_64_apple_darwin="$DARWIN_CC"
    export CXX_x86_64_apple_darwin="$DARWIN_CXX"
    export AR_x86_64_apple_darwin="$AR_BIN"
    export CARGO_TARGET_X86_64_APPLE_DARWIN_LINKER="$DARWIN_CC"
    export SDKROOT="$SDK_PATH"
    export CMAKE_OSX_SYSROOT="$SDK_PATH"
    export CFLAGS="-fuse-ld=$LD_BIN"
    export CXXFLAGS="-fuse-ld=$LD_BIN"
    export CFLAGS_x86_64_apple_darwin="-fuse-ld=$LD_BIN"
    export CXXFLAGS_x86_64_apple_darwin="-fuse-ld=$LD_BIN"
    export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION"

    rm -rf \
      dist \
      release \
      native-core \
      native/core/build/macos-x64-release \
      native/epic_core/target/x86_64-apple-darwin/release

    npm install --no-audit --no-fund
    cargo build --release --target x86_64-apple-darwin --manifest-path native/epic_core/Cargo.toml
    "$INSTALL_NAME_TOOL" -id "@loader_path/libaltbase_epic_core.dylib" \
      native/epic_core/target/x86_64-apple-darwin/release/libaltbase_epic_core.dylib

    cmake \
      -S native/core \
      -B native/core/build/macos-x64-release \
      -G "Unix Makefiles" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_SYSTEM_NAME=Darwin \
      -DCMAKE_OSX_SYSROOT="$SDK_PATH" \
      -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION" \
      -DCMAKE_OSX_ARCHITECTURES=x86_64 \
      -DCMAKE_C_COMPILER="$DARWIN_CC" \
      -DCMAKE_CXX_COMPILER="$DARWIN_CXX" \
      -DCMAKE_LINKER="$LD_BIN" \
      -DCMAKE_AR="$AR_BIN" \
      -DCMAKE_RANLIB="$RANLIB_BIN" \
      -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=$LD_BIN" \
      -DCMAKE_FIND_ROOT_PATH="$SDK_PATH;/opt/osxcross/target" \
      -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER \
      -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY \
      -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY \
      -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH
    cmake --build native/core/build/macos-x64-release --parallel 2

    ALTBASE_TARGET_PLATFORM=darwin node scripts/copy-native-core.cjs
    "$INSTALL_NAME_TOOL" -id "@loader_path/libaltbase_epic_core.dylib" native-core/libaltbase_epic_core.dylib
    npm run build
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac zip --x64 --config.mac.identity=null --publish never

    zip_path="$(find release -maxdepth 1 -type f -name '\''*.zip'\'' | head -n 1)"
    test -n "$zip_path"
    install -m 0644 "$zip_path" "/out/$ARTIFACT_NAME"
    file native-core/altbase_core_bridge
    file native-core/libaltbase_epic_core.dylib
    unzip -l "/out/$ARTIFACT_NAME" | grep -F "native-core/altbase_core_bridge" >/dev/null
    unzip -l "/out/$ARTIFACT_NAME" | grep -F "native-core/libaltbase_epic_core.dylib" >/dev/null
    (cd /out && sha256sum "$ARTIFACT_NAME" > "${ARTIFACT_NAME}.sha256")
  '

ls -lh "$DOWNLOADS_DIR/$ARTIFACT_NAME" "$DOWNLOADS_DIR/$ARTIFACT_NAME.sha256"
