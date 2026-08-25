#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ALTBASE_ROOT:-$SCRIPT_DIR}"
export ALTBASE_ROOT="$ROOT"

"$SCRIPT_DIR/build-windows.sh"
"$SCRIPT_DIR/build-linux.sh"
"$SCRIPT_DIR/build-macos.sh"

cd "$ROOT"
version="$(node -p "require('./package.json').version")"
checksum_tmp="$(mktemp "${TMPDIR:-/tmp}/altbase-sha256.XXXXXX")"
trap 'if [[ -f "$checksum_tmp" ]]; then find "$checksum_tmp" -delete; fi' EXIT

files=(
  "artifacts/Altbase-Wallet-Linux-x86_64-v${version}.AppImage"
  "artifacts/Altbase-Wallet-Windows-portable-v${version}.zip"
  "artifacts/Altbase-Wallet-Windows-v${version}.msi"
  "artifacts/Altbase-Wallet-macOS-universal-v${version}.zip"
  "artifacts/altbase_monero_wallet-windows-v${version}.dll"
)
for file in "${files[@]}"; do
  [[ -s "$file" ]] || { printf 'All-platform build failed: missing %s\n' "$file" >&2; exit 1; }
done

sha256sum "${files[@]}" | sed 's#  artifacts/#  #' >"$checksum_tmp"
mv "$checksum_tmp" "artifacts/SHA256SUMS-${version}"
trap - EXIT

printf 'All Altbase Wallet %s builds passed.\n' "$version"
cat "artifacts/SHA256SUMS-${version}"
