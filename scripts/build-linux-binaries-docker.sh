#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ALTBASE_LINUX_BUILD_ROOT:-/opt/altbase-wallet-build}"
SOURCE_DIR="${ALTBASE_LINUX_SOURCE_DIR:-$ROOT_DIR/source}"
DOCKER_DIR="$ROOT_DIR/docker"
DOWNLOADS_DIR="${ALTBASE_DOWNLOADS_DIR:-/var/www/altbase.io/downloads}"
DISTROS="${ALTBASE_LINUX_DISTROS:-debian ubuntu24 fedora}"
BUILD_JOBS="${ALTBASE_BUILD_JOBS:-2}"
CACHE_DIR="${ALTBASE_LINUX_CACHE_DIR:-$ROOT_DIR/cache/linux}"

if ! [[ "$BUILD_JOBS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ALTBASE_BUILD_JOBS must be a positive integer: $BUILD_JOBS" >&2
  exit 1
fi

mkdir -p \
  "$DOCKER_DIR" \
  "$DOWNLOADS_DIR" \
  "$CACHE_DIR/npm" \
  "$CACHE_DIR/cargo-registry" \
  "$CACHE_DIR/cargo-git" \
  "$CACHE_DIR/dependencies"

write_dockerfiles() {
  cat > "$DOCKER_DIR/Dockerfile.debian" <<'DOCKER'
FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git git-lfs python3 make g++ cmake pkg-config fakeroot rpm xz-utils file \
  clang libclang-dev \
  libboost-system-dev libboost-filesystem-dev libboost-locale-dev libboost-thread-dev \
  libboost-timer-dev libboost-date-time-dev libboost-chrono-dev libboost-regex-dev \
  libboost-serialization-dev libboost-atomic-dev libboost-program-options-dev libboost-log-dev \
  libssl-dev libcurl4-openssl-dev libsqlite3-dev \
  libarchive-tools libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libsecret-1-dev \
  libatk-bridge2.0-0 libdrm2 libxdamage1 libxrandr2 libxcomposite1 libxkbcommon0 \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
CMD ["/bin/bash"]
DOCKER

  cat > "$DOCKER_DIR/Dockerfile.ubuntu24" <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git git-lfs python3 make g++ cmake pkg-config fakeroot rpm xz-utils file gnupg \
  clang libclang-dev \
  libboost-system-dev libboost-filesystem-dev libboost-locale-dev libboost-thread-dev \
  libboost-timer-dev libboost-date-time-dev libboost-chrono-dev libboost-regex-dev \
  libboost-serialization-dev libboost-atomic-dev libboost-program-options-dev libboost-log-dev \
  libssl-dev libcurl4-openssl-dev libsqlite3-dev \
  libarchive-tools libgtk-3-0 libnss3 libxss1 libasound2t64 libgbm1 libsecret-1-dev \
  libatk-bridge2.0-0 libdrm2 libxdamage1 libxrandr2 libxcomposite1 libxkbcommon0 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
DOCKER

  cat > "$DOCKER_DIR/Dockerfile.fedora" <<'DOCKER'
FROM fedora:42
RUN dnf install -y \
  nodejs npm git git-lfs python3 make gcc gcc-c++ cmake pkgconf-pkg-config openssl-devel libcurl-devel sqlite-devel libxcrypt-compat \
  clang clang-devel boost-devel \
  rpm-build rpmdevtools xz file bsdtar \
  gtk3 nss libXScrnSaver alsa-lib libsecret atk at-spi2-atk libdrm libXdamage \
  libXrandr libXcomposite libxkbcommon \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && dnf clean all
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
CMD ["/bin/bash"]
DOCKER
}

build_privacy_native() {
  cat <<'SCRIPT'
    for manifest in native/epic_transport/Cargo.toml native/epic_state/Cargo.toml native/epic_sender/Cargo.toml; do
      if [ ! -f "$manifest" ]; then
        echo "Epic native source is missing: $manifest" >&2
        exit 1
      fi
    done
    if [ ! -d native/vendor/zano_native_lib/Zano ]; then
      echo "Zano native source is missing: native/vendor/zano_native_lib/Zano" >&2
      exit 1
    fi

    for required in \
      native/vendor/zano_native_lib/Zano/contrib/miniupnp/miniupnpc/CMakeLists.txt \
      native/vendor/zano_native_lib/Zano/contrib/bitcoin-secp256k1/CMakeLists.txt \
      native/vendor/zano_native_lib/Zano/src/wallet/wallet2.cpp; do
      if [ ! -f "$required" ]; then
        echo "Required Zano source is missing from the Windows snapshot: $required" >&2
        exit 1
      fi
    done

    epic_target=native/target-epic-modular-linux
    if [ "${ALTBASE_INCREMENTAL_BUILD:-0}" != "1" ]; then
      rm -rf "$epic_target" native/epic_core/target/release
    fi
    cargo build --release --locked --manifest-path native/epic_transport/Cargo.toml --target-dir "$epic_target" -j "${ALTBASE_BUILD_JOBS:-2}"
    export ALTBASE_EPIC_TRANSPORT_LIB_DIR="$PWD/$epic_target/release"
    cargo build --release --locked --manifest-path native/epic_state/Cargo.toml --target-dir "$epic_target" -j "${ALTBASE_BUILD_JOBS:-2}"
    cargo build --release --locked --manifest-path native/epic_sender/Cargo.toml --target-dir "$epic_target" -j "${ALTBASE_BUILD_JOBS:-2}"
    mkdir -p native/epic_core/target/release
    for module in state sender transport; do
      cp "$epic_target/release/libaltbase_epic_${module}.so" native/epic_core/target/release/
    done

    export ZANO_USE_SYSTEM_BOOST=1
    zano_build=native/vendor/zano_native_lib/Zano/build/altbase-linux-x64
    cmake \
      -S native/vendor/zano_native_lib/Zano \
      -B "$zano_build" \
      -DBUILD_GUI=OFF \
      -DDISABLE_TOR=ON \
      -DMOBILE_WALLET_BUILD=ON \
      -DALTBASE_NATIVE_HARDENED_RELEASE=ON \
      -DSTATIC=OFF \
      -DCOMMIT_ID_IN_VERSION=OFF \
      -DGIT=FALSE \
      -DBoost_NO_SYSTEM_PATHS=OFF \
      -DBoost_NO_WARN_NEW_VERSIONS=ON
    for target in common crypto currency_core rpc zlibstatic libminiupnpc-static wallet; do
      cmake --build "$zano_build" --target "$target" --parallel "${ALTBASE_BUILD_JOBS:-2}"
    done
SCRIPT
}

build_image() {
  local distro="$1"
  docker build -t "altbase-wallet-builder:$distro" -f "$DOCKER_DIR/Dockerfile.$distro" "$DOCKER_DIR"
}

ensure_container() {
  local distro="$1"
  local name="altbase-wallet-build-$distro"
  if docker inspect "$name" >/dev/null 2>&1; then
    docker rm -f "$name" >/dev/null
  fi
  docker create -it \
    --name "$name" \
    -e ALTBASE_BUILD_JOBS="$BUILD_JOBS" \
    -e ALTBASE_INCREMENTAL_BUILD="${ALTBASE_INCREMENTAL_BUILD:-0}" \
    -e CARGO_NET_RETRY=100 \
    -e CARGO_HTTP_TIMEOUT=600 \
    -e CARGO_HTTP_LOW_SPEED_LIMIT=1 \
    -e CARGO_HTTP_MULTIPLEXING=false \
    -e ALTBASE_DEPENDENCY_CACHE_DIR=/dependencies \
    -v "$SOURCE_DIR:/workspace" \
    -v "$DOWNLOADS_DIR:/out" \
    -v "$CACHE_DIR/npm:/root/.npm" \
    -v "$CACHE_DIR/cargo-registry:/root/.cargo/registry" \
    -v "$CACHE_DIR/cargo-git:/root/.cargo/git" \
    -v "$CACHE_DIR/dependencies:/dependencies" \
    "altbase-wallet-builder:$distro" \
    /bin/bash >/dev/null
}

build_in_container() {
  local distro="$1"
  local appimage_name="$2"
  local name="altbase-wallet-build-$distro"

  docker start "$name" >/dev/null
  docker exec "$name" bash -lc "
    set -euo pipefail
    cd /workspace
    if [ "${ALTBASE_INCREMENTAL_BUILD:-0}" != "1" ]; then
      rm -rf node_modules dist release native-core native/core/build/linux-x64-release native/epic_core/target/release native/target-epic-modular-linux native/vendor/zano_native_lib/Zano/build/altbase-linux-x64
    fi
    bash scripts/build-kaspa-wallet-wasm.sh
    npm ci --prefer-offline --no-audit --no-fund
$(build_privacy_native)
    cmake --preset linux-x64-release -S native/core
    cmake --build native/core/build/linux-x64-release --parallel "${ALTBASE_BUILD_JOBS:-2}"
    ctest --test-dir native/core/build/linux-x64-release --output-on-failure
    node scripts/copy-native-core.cjs
    ALTBASE_STRIP_NATIVE=1 bash scripts/verify-linux-native.sh native-core "\$zano_build"
    npm test
    npm run build
    npx electron-builder --linux AppImage --x64 --publish never
    appimage=\$(find release -maxdepth 1 -type f -name '*.AppImage' | head -n 1)
    test -n \"\$appimage\"
    install -m 0755 \"\$appimage\" \"/out/$appimage_name\"
    file native-core/altbase_core_bridge
    test \"\$(find native-core -maxdepth 1 -type f \( -name 'altbase_*_wallet.so' -o -name 'libaltbase_*_wallet.so' \) | wc -l)\" -eq 19
    test \"\$(find native-core -maxdepth 1 -type f -name 'altbase_*_node.so' | wc -l)\" -eq 23
  "
}

write_checksums() {
  (
    cd "$DOWNLOADS_DIR"
    local files=()
    for file in \
      Altbase-Wallet-Windows.msi \
      Altbase-Wallet-Ubuntu24.AppImage \
      Altbase-Wallet-Debian.AppImage \
      Altbase-Wallet-Fedora.AppImage \
      Altbase-Wallet.AppImage \
      Altbase-Wallet-macOS-universal.zip \
      Altbase-Wallet-macOS-x64.zip
    do
      [[ -f "$file" ]] && files+=("$file")
    done
    if [[ "${#files[@]}" -gt 0 ]]; then
      sha256sum "${files[@]}" > checksums.txt
    else
      : > checksums.txt
    fi
  )
}

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "Source directory is missing package.json: $SOURCE_DIR" >&2
  exit 1
fi

write_dockerfiles

for distro in $DISTROS; do
  build_image "$distro"
  ensure_container "$distro"
done

if [[ " $DISTROS " == *" ubuntu24 "* ]]; then
  build_in_container ubuntu24 "Altbase-Wallet-Ubuntu24.AppImage"
  install -m 0755 "$DOWNLOADS_DIR/Altbase-Wallet-Ubuntu24.AppImage" "$DOWNLOADS_DIR/Altbase-Wallet.AppImage"
fi
if [[ " $DISTROS " == *" debian "* ]]; then
  build_in_container debian "Altbase-Wallet-Debian.AppImage"
fi
if [[ " $DISTROS " == *" fedora "* ]]; then
  build_in_container fedora "Altbase-Wallet-Fedora.AppImage"
fi
write_checksums

ls -lh "$DOWNLOADS_DIR"/Altbase-Wallet-* "$DOWNLOADS_DIR/checksums.txt"
