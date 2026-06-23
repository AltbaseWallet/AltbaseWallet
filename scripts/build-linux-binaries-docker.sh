#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ALTBASE_LINUX_BUILD_ROOT:-/opt/altbase-wallet-build}"
SOURCE_DIR="${ALTBASE_LINUX_SOURCE_DIR:-$ROOT_DIR/source}"
DOCKER_DIR="$ROOT_DIR/docker"
DOWNLOADS_DIR="${ALTBASE_DOWNLOADS_DIR:-/var/www/altbase.io/downloads}"
DISTROS="${ALTBASE_LINUX_DISTROS:-debian ubuntu24 fedora}"

mkdir -p "$DOCKER_DIR" "$DOWNLOADS_DIR"

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
  libssl-dev libcurl4-openssl-dev \
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
  libssl-dev libcurl4-openssl-dev \
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
  nodejs npm git git-lfs python3 make gcc gcc-c++ cmake pkgconf-pkg-config openssl-devel libcurl-devel libxcrypt-compat \
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
    if [ ! -f native/epic_core/Cargo.toml ]; then
      echo "Epic native source is missing: native/epic_core/Cargo.toml" >&2
      exit 1
    fi
    if [ ! -d native/vendor/zano_native_lib/Zano ]; then
      echo "Zano native source is missing: native/vendor/zano_native_lib/Zano" >&2
      exit 1
    fi

    if git -C native/vendor/zano_native_lib rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C native/vendor/zano_native_lib submodule update --init --depth 1 Zano || true
    fi
    if git -C native/vendor/zano_native_lib/Zano rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C native/vendor/zano_native_lib/Zano submodule update --init --depth 1 contrib/miniupnp contrib/jwt-cpp contrib/bitcoin-secp256k1 contrib/tor-connect || true
    fi

    cargo build --release --manifest-path native/epic_core/Cargo.toml

    export ZANO_USE_SYSTEM_BOOST=1
    zano_build=native/vendor/zano_native_lib/Zano/build/altbase-linux-x64
    cmake \
      -S native/vendor/zano_native_lib/Zano \
      -B "$zano_build" \
      -DBUILD_GUI=OFF \
      -DDISABLE_TOR=ON \
      -DSTATIC=OFF \
      -DBoost_NO_SYSTEM_PATHS=OFF \
      -DBoost_NO_WARN_NEW_VERSIONS=ON
    for target in common crypto currency_core rpc zlibstatic ethash libminiupnpc-static wallet; do
      cmake --build "$zano_build" --target "$target" --parallel 2
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
    -v "$SOURCE_DIR:/workspace" \
    -v "$DOWNLOADS_DIR:/out" \
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
    rm -rf node_modules dist release native-core native/core/build/linux-x64-release native/epic_core/target/release native/vendor/zano_native_lib/Zano/build/altbase-linux-x64
    npm install --no-audit --no-fund
$(build_privacy_native)
    cmake --preset linux-x64-release -S native/core
    cmake --build native/core/build/linux-x64-release --parallel 2
    node scripts/copy-native-core.cjs
    npm run build
    npx electron-builder --linux AppImage --x64
    appimage=\$(find release -maxdepth 1 -type f -name '*.AppImage' | head -n 1)
    test -n \"\$appimage\"
    install -m 0755 \"\$appimage\" \"/out/$appimage_name\"
    file native-core/altbase_core_bridge
  "
}

write_checksums() {
  (
    cd "$DOWNLOADS_DIR"
    local files=()
    for file in \
      Altbase-Wallet-Windows.exe \
      Altbase-Wallet-Ubuntu24.AppImage \
      Altbase-Wallet-Debian.AppImage \
      Altbase-Wallet-Fedora.AppImage
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
fi
if [[ " $DISTROS " == *" debian "* ]]; then
  build_in_container debian "Altbase-Wallet-Debian.AppImage"
fi
if [[ " $DISTROS " == *" fedora "* ]]; then
  build_in_container fedora "Altbase-Wallet-Fedora.AppImage"
fi
write_checksums

ls -lh "$DOWNLOADS_DIR"/Altbase-Wallet-* "$DOWNLOADS_DIR/checksums.txt"
