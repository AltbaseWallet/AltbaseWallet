#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${ALTBASE_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
cd "$ROOT"

export npm_config_prefer_offline=true
export npm_config_audit=false
export npm_config_fund=false

fail() {
  printf 'Linux build failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

authorize_sudo() {
  sudo -n true 2>/dev/null && return 0

  local sudo_password="${ALTBASE_SUDO_PASSWORD:-}"
  [[ -n "$sudo_password" ]] \
    || fail "sudo authentication is required; configure passwordless sudo or set ALTBASE_SUDO_PASSWORD"
  printf '%s\n' "$sudo_password" | sudo -S -p '' -v \
    || fail "sudo authentication failed; set ALTBASE_SUDO_PASSWORD"
  unset sudo_password
}

for command_name in node npm cargo cmake ninja sha256sum readelf find nm; do
  require_command "$command_name"
done

[[ -f package.json && -f scripts/verify-linux-native.sh ]] || fail "run this script from the Altbase repository"
if [[ ! -x node_modules/.bin/electron-builder ]]; then
  npm ci --prefer-offline --no-audit --no-fund
fi

version="$(node -p "require('./package.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "invalid package version: $version"

npm test

epic_target="$ROOT/native/target-epic-modular-linux"
for epic_manifest in transport state sender; do
  [[ -f "$ROOT/native/epic_${epic_manifest}/Cargo.toml" ]] \
    || fail "Epic ${epic_manifest} source is missing"
done
cargo build --release --locked \
  --manifest-path "$ROOT/native/epic_transport/Cargo.toml" \
  --target-dir "$epic_target" -j "${ALTBASE_BUILD_JOBS:-2}"
export ALTBASE_EPIC_TRANSPORT_LIB_DIR="$epic_target/release"
cargo build --release --locked \
  --manifest-path "$ROOT/native/epic_state/Cargo.toml" \
  --target-dir "$epic_target" -j "${ALTBASE_BUILD_JOBS:-2}"
cargo build --release --locked \
  --manifest-path "$ROOT/native/epic_sender/Cargo.toml" \
  --target-dir "$epic_target" -j "${ALTBASE_BUILD_JOBS:-2}"
mkdir -p "$ROOT/native/epic_core/target/release"
for epic_module in transport state sender; do
  epic_library="$epic_target/release/libaltbase_epic_${epic_module}.so"
  [[ -s "$epic_library" ]] || fail "Epic ${epic_module} build output is missing"
  cp "$epic_library" "$ROOT/native/epic_core/target/release/"
done

linux_native_build="${ALTBASE_LINUX_NATIVE_BUILD_DIR:-}"
if [[ -z "$linux_native_build" ]]; then
  preferred_native_build="$ROOT/native/core/build/linux-x64-release-gcc13-boost183"
  if [[ -f "$preferred_native_build/CMakeCache.txt" ]]; then
    linux_native_build="$preferred_native_build"
  else
    linux_native_build="$ROOT/native/core/build/linux-x64-release"
  fi
fi
export ALTBASE_LINUX_NATIVE_BUILD_DIR="$linux_native_build"
cmake -S "$ROOT/native/core" -B "$linux_native_build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$linux_native_build" --target altbase_core_bridge --parallel "${ALTBASE_BUILD_JOBS:-4}"
node scripts/build-linux-native-incremental.cjs
npm run dist:linux:appimage

appimage="$ROOT/release/Altbase-Wallet-Linux-x86_64.AppImage"
app_dir="$ROOT/release/linux-unpacked"
sandbox="$app_dir/chrome-sandbox"
dll="$app_dir/resources/native-core/altbase_monero_wallet.so"
xgr_node="$app_dir/resources/native-core/altbase_xgr_node.so"
epic_transport="$app_dir/resources/native-core/libaltbase_epic_transport.so"
epic_state="$app_dir/resources/native-core/libaltbase_epic_state.so"
epic_sender="$app_dir/resources/native-core/libaltbase_epic_sender.so"
asar="$app_dir/resources/app.asar"
for required_file in "$appimage" "$sandbox" "$dll" "$xgr_node" "$epic_transport" "$epic_state" "$epic_sender" "$asar"; do
  [[ -s "$required_file" ]] || fail "missing build output: $required_file"
done

if [[ "$(id -u)" -eq 0 ]]; then
  chown root:root "$sandbox"
  chmod 4755 "$sandbox"
else
  require_command sudo
  authorize_sudo
  sudo -n chown root:root "$sandbox"
  sudo -n chmod 4755 "$sandbox"
fi

[[ "$(stat -c '%u:%g:%a' "$sandbox")" == "0:0:4755" ]] || fail "chrome-sandbox must be root:root mode 4755"
packaged_version="$(node -e "const a=require('@electron/asar'); console.log(JSON.parse(a.extractFile(process.argv[1],'package.json')).version)" "$asar")"
[[ "$packaged_version" == "$version" ]] || fail "packaged version is $packaged_version, expected $version"

verify_root="$(mktemp -d "${TMPDIR:-/tmp}/altbase-appimage-verify.XXXXXX")"
cleanup() {
  find "$verify_root" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

(cd "$verify_root" && "$appimage" --appimage-extract >/dev/null)
extracted="$verify_root/squashfs-root"
embedded_dll="$extracted/resources/native-core/altbase_monero_wallet.so"
embedded_xgr_node="$extracted/resources/native-core/altbase_xgr_node.so"
embedded_epic_transport="$extracted/resources/native-core/libaltbase_epic_transport.so"
embedded_epic_state="$extracted/resources/native-core/libaltbase_epic_state.so"
embedded_epic_sender="$extracted/resources/native-core/libaltbase_epic_sender.so"
[[ -s "$embedded_dll" ]] || fail "AppImage does not contain the Monero wallet module"
[[ -s "$embedded_xgr_node" ]] || fail "AppImage does not contain the XGR node module"
[[ "$(sha256sum "$embedded_dll" | awk '{print $1}')" == "$(sha256sum "$dll" | awk '{print $1}')" ]] \
  || fail "AppImage contains a different Monero wallet module"
[[ "$(sha256sum "$embedded_xgr_node" | awk '{print $1}')" == "$(sha256sum "$xgr_node" | awk '{print $1}')" ]] \
  || fail "AppImage contains a different XGR node module"
for epic_module in transport state sender; do
  packaged_epic_var="embedded_epic_${epic_module}"
  staged_epic_var="epic_${epic_module}"
  [[ "$(sha256sum "${!packaged_epic_var}" | awk '{print $1}')" == "$(sha256sum "${!staged_epic_var}" | awk '{print $1}')" ]] \
    || fail "AppImage contains a different Epic ${epic_module} module"
done
xgr_exports="$(nm -D --defined-only "$xgr_node" | awk '{print $3}' | grep -E '^altbase_xgr_node_(free|request)$' | sort -u)"
expected_xgr_exports=$'altbase_xgr_node_free\naltbase_xgr_node_request'
[[ "$xgr_exports" == "$expected_xgr_exports" ]] || fail "XGR node module does not have the exact two-function ABI"
bash scripts/verify-linux-native.sh \
  "$extracted/resources/native-core" \
  native/vendor/zano_native_lib/Zano/build/altbase-linux-x64

mkdir -p artifacts
install -m 0755 "$appimage" "artifacts/Altbase-Wallet-Linux-x86_64-v${version}.AppImage"

printf 'Linux %s build passed.\n' "$version"
sha256sum "artifacts/Altbase-Wallet-Linux-x86_64-v${version}.AppImage" "$dll" "$xgr_node"
