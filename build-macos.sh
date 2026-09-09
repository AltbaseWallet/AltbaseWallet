#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${ALTBASE_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
cd "$ROOT"

export npm_config_prefer_offline=true
export npm_config_audit=false
export npm_config_fund=false

fail() {
  printf 'macOS build failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

for command_name in node npm cmake ninja unzip sha256sum; do
  require_command "$command_name"
done

[[ -f package.json && -f scripts/stage-macos-universal-native.cjs ]] || fail "run this script from the Altbase repository"
bash scripts/build-nonsense-wallet-wasm.sh
if [[ ! -x node_modules/.bin/electron-builder ]]; then
  npm ci --prefer-offline --no-audit --no-fund
fi

version="$(node -p "require('./package.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "invalid package version: $version"

npm test
node scripts/build-macos-native-incremental.cjs
npm run dist:mac:zip

archive="$ROOT/release/Altbase-Wallet-macOS-universal.zip"
app_dir="$ROOT/release/mac-universal/Altbase Wallet.app"
dll="$app_dir/Contents/Resources/native-core/altbase_monero_wallet.dylib"
xgr_node="$app_dir/Contents/Resources/native-core/altbase_xgr_node.dylib"
nonsense_node="$app_dir/Contents/Resources/native-core/altbase_nonsense_node.dylib"
asar="$app_dir/Contents/Resources/app.asar"
plist="$app_dir/Contents/Info.plist"
for required_file in "$archive" "$dll" "$xgr_node" "$nonsense_node" "$asar" "$plist"; do
  [[ -s "$required_file" ]] || fail "missing build output: $required_file"
done

unzip -tq "$archive" >/dev/null
packaged_version="$(node -e "const a=require('@electron/asar'); console.log(JSON.parse(a.extractFile(process.argv[1],'package.json')).version)" "$asar")"
[[ "$packaged_version" == "$version" ]] || fail "packaged version is $packaged_version, expected $version"
plist_version="$(sed -n '/<key>CFBundleShortVersionString<\/key>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;q;}' "$plist")"
[[ "$plist_version" == "$version" ]] || fail "Info.plist version is $plist_version, expected $version"

lipo_tool="${ALTBASE_LIPO:-}"
if [[ -z "$lipo_tool" ]] && command -v llvm-lipo >/dev/null 2>&1; then lipo_tool="$(command -v llvm-lipo)"; fi
if [[ -z "$lipo_tool" ]] && command -v lipo >/dev/null 2>&1; then lipo_tool="$(command -v lipo)"; fi
if [[ -z "$lipo_tool" ]]; then
  candidate="$HOME/.cache/altbase/monero/source-build/macos-x64/source/contrib/depends/x86_64-apple-darwin11/native/bin/x86_64-apple-darwin11-lipo"
  [[ -x "$candidate" ]] && lipo_tool="$candidate"
fi
[[ -x "$lipo_tool" ]] || fail "lipo or llvm-lipo is required"
"$lipo_tool" "$dll" -verify_arch x86_64 arm64
"$lipo_tool" "$xgr_node" -verify_arch x86_64 arm64
"$lipo_tool" "$nonsense_node" -verify_arch x86_64 arm64

embedded_hash="$(unzip -p "$archive" 'Altbase Wallet.app/Contents/Resources/native-core/altbase_monero_wallet.dylib' | sha256sum | awk '{print $1}')"
[[ "$embedded_hash" == "$(sha256sum "$dll" | awk '{print $1}')" ]] \
  || fail "macOS ZIP contains a different Monero wallet module"
embedded_xgr_hash="$(unzip -p "$archive" 'Altbase Wallet.app/Contents/Resources/native-core/altbase_xgr_node.dylib' | sha256sum | awk '{print $1}')"
[[ "$embedded_xgr_hash" == "$(sha256sum "$xgr_node" | awk '{print $1}')" ]] \
  || fail "macOS ZIP contains a different XGR node module"
embedded_nonsense_hash="$(unzip -p "$archive" 'Altbase Wallet.app/Contents/Resources/native-core/altbase_nonsense_node.dylib' | sha256sum | awk '{print $1}')"
[[ "$embedded_nonsense_hash" == "$(sha256sum "$nonsense_node" | awk '{print $1}')" ]] \
  || fail "macOS ZIP contains a different Nonsense node module"

mkdir -p artifacts
install -m 0644 "$archive" "artifacts/Altbase-Wallet-macOS-universal-v${version}.zip"

printf 'macOS %s universal build passed.\n' "$version"
sha256sum "artifacts/Altbase-Wallet-macOS-universal-v${version}.zip" "$dll" "$xgr_node" "$nonsense_node"
