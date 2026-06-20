#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ALTBASE_LINUX_BUILD_ROOT:-$HOME/altbase-wallet-build}"
SOURCE_DIR="${ALTBASE_LINUX_SOURCE_DIR:-$ROOT_DIR/source}"
DOCKER_DIR="$ROOT_DIR/docker"
DOWNLOADS_DIR="${ALTBASE_DOWNLOADS_DIR:-$ROOT_DIR/downloads}"

mkdir -p "$DOCKER_DIR" "$DOWNLOADS_DIR"

write_dockerfiles() {
  cat > "$DOCKER_DIR/Dockerfile.debian" <<'DOCKER'
FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git python3 make g++ cmake pkg-config fakeroot rpm xz-utils file \
  libssl-dev libcurl4-openssl-dev \
  libarchive-tools libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libsecret-1-dev \
  libatk-bridge2.0-0 libdrm2 libxdamage1 libxrandr2 libxcomposite1 libxkbcommon0 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["/bin/bash"]
DOCKER

  cat > "$DOCKER_DIR/Dockerfile.ubuntu24" <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git python3 make g++ cmake pkg-config fakeroot rpm xz-utils file gnupg \
  libssl-dev libcurl4-openssl-dev \
  libarchive-tools libgtk-3-0 libnss3 libxss1 libasound2t64 libgbm1 libsecret-1-dev \
  libatk-bridge2.0-0 libdrm2 libxdamage1 libxrandr2 libxcomposite1 libxkbcommon0 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
DOCKER

  cat > "$DOCKER_DIR/Dockerfile.fedora" <<'DOCKER'
FROM fedora:42
RUN dnf install -y \
  nodejs npm git python3 make gcc gcc-c++ cmake pkgconf-pkg-config openssl-devel libcurl-devel libxcrypt-compat \
  rpm-build rpmdevtools xz file bsdtar \
  gtk3 nss libXScrnSaver alsa-lib libsecret atk at-spi2-atk libdrm libXdamage \
  libXrandr libXcomposite libxkbcommon \
  && dnf clean all
WORKDIR /workspace
CMD ["/bin/bash"]
DOCKER
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
  local package_target="$3"
  local package_name="$4"
  local name="altbase-wallet-build-$distro"

  docker start "$name" >/dev/null
  docker exec "$name" bash -lc "
    set -euo pipefail
    cd /workspace
    rm -rf node_modules dist release native-core native/core/build/linux-x64-release
    npm install --no-audit --no-fund
    cmake --preset linux-x64-release -S native/core
    cmake --build native/core/build/linux-x64-release --parallel 2
    node scripts/copy-native-core.cjs
    npm run build
    npx electron-builder --linux AppImage $package_target --x64
    appimage=\$(find release -maxdepth 1 -type f -name '*.AppImage' | head -n 1)
    test -n \"\$appimage\"
    install -m 0755 \"\$appimage\" \"/out/$appimage_name\"
    package=\$(find release -maxdepth 1 -type f -name '*.$package_target' | head -n 1)
    test -n \"\$package\"
    install -m 0644 \"\$package\" \"/out/$package_name\"
    file native-core/altbase_core_bridge
  "
}

write_checksums() {
  (
    cd "$DOWNLOADS_DIR"
    sha256sum \
      Altbase-Wallet-Windows.exe \
      Altbase-Wallet-Ubuntu24.AppImage \
      Altbase-Wallet-Ubuntu24.deb \
      Altbase-Wallet-Debian.AppImage \
      Altbase-Wallet-Debian.deb \
      Altbase-Wallet-Fedora.AppImage \
      Altbase-Wallet-Fedora.rpm \
      2>/dev/null > checksums.txt
  )
}

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "Source directory is missing package.json: $SOURCE_DIR" >&2
  exit 1
fi

write_dockerfiles

for distro in debian ubuntu24 fedora; do
  build_image "$distro"
  ensure_container "$distro"
done

build_in_container ubuntu24 "Altbase-Wallet-Ubuntu24.AppImage" "deb" "Altbase-Wallet-Ubuntu24.deb"
build_in_container debian "Altbase-Wallet-Debian.AppImage" "deb" "Altbase-Wallet-Debian.deb"
build_in_container fedora "Altbase-Wallet-Fedora.AppImage" "rpm" "Altbase-Wallet-Fedora.rpm"
write_checksums

ls -lh "$DOWNLOADS_DIR"/Altbase-Wallet-* "$DOWNLOADS_DIR/checksums.txt"
