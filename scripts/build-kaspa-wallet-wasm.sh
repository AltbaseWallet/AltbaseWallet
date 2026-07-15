#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${ALTBASE_DEPENDENCY_CACHE_DIR:-$(dirname "$ROOT_DIR")/.downloads}"
SOURCE_ROOT="${ALTBASE_KASPA_SOURCE_DIR:-$CACHE_DIR/rusty-kaspa-v2.0.1}"
SOURCE_ARCHIVE="$CACHE_DIR/rusty-kaspa-v2.0.1.tar.gz"
BINDGEN_NAME="wasm-bindgen-0.2.100-x86_64-unknown-linux-musl"
BINDGEN_ROOT="$CACHE_DIR/$BINDGEN_NAME"
BINDGEN_ARCHIVE="$CACHE_DIR/$BINDGEN_NAME.tar.gz"
CRATE_ROOT="$ROOT_DIR/native/kaspa_wallet_wasm"
GENERATED_DIR="$CRATE_ROOT/generated"
VENDOR_DIR="$ROOT_DIR/vendor/kaspa-wasm-v2.0.1"
BUILD_JOBS="${ALTBASE_BUILD_JOBS:-7}"

mkdir -p "$CACHE_DIR" "$SOURCE_ROOT" "$VENDOR_DIR"

if [[ ! -f "$SOURCE_ROOT/Cargo.toml" ]]; then
  curl -L -C - --fail --retry 100 --retry-all-errors --retry-delay 3 --connect-timeout 20 \
    -o "$SOURCE_ARCHIVE" \
    https://api.github.com/repos/kaspanet/rusty-kaspa/tarball/v2.0.1
  rm -rf "$SOURCE_ROOT"
  mkdir -p "$SOURCE_ROOT"
  tar -xzf "$SOURCE_ARCHIVE" -C "$SOURCE_ROOT" --strip-components=1
fi

if [[ ! -x "$BINDGEN_ROOT/wasm-bindgen" ]]; then
  curl -L -C - --fail --retry 100 --retry-all-errors --retry-delay 3 --connect-timeout 20 \
    -o "$BINDGEN_ARCHIVE" \
    "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.100/$BINDGEN_NAME.tar.gz"
  tar -xzf "$BINDGEN_ARCHIVE" -C "$CACHE_DIR"
fi

"$BINDGEN_ROOT/wasm-bindgen" --version | grep -F '0.2.100' >/dev/null
rustup toolchain install 1.97.0 --profile minimal
rustup target add wasm32-unknown-unknown --toolchain 1.97.0

escaped_source="${SOURCE_ROOT//&/\\&}"
sed "s|__KASPA_SOURCE__|$escaped_source|g" "$CRATE_ROOT/Cargo.toml.template" > "$CRATE_ROOT/Cargo.toml"

export RUSTFLAGS='--cfg getrandom_backend="wasm_js"'
export CARGO_NET_RETRY="${CARGO_NET_RETRY:-100}"
export CARGO_HTTP_TIMEOUT="${CARGO_HTTP_TIMEOUT:-600}"
cargo +1.97.0 fetch --locked --manifest-path "$CRATE_ROOT/Cargo.toml"
cargo +1.97.0 build --offline --locked \
  --manifest-path "$CRATE_ROOT/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release \
  -j "$BUILD_JOBS"

rm -rf "$GENERATED_DIR"
mkdir -p "$GENERATED_DIR"
"$BINDGEN_ROOT/wasm-bindgen" \
  "$CRATE_ROOT/target/wasm32-unknown-unknown/release/altbase_kaspa_wallet_wasm.wasm" \
  --target web \
  --out-dir "$GENERATED_DIR" \
  --out-name kaspa

node - "$GENERATED_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const jsPath = path.join(root, 'kaspa.js')
const needle = "module_or_path = new URL('kaspa_bg.wasm', import.meta.url);"
let js = fs.readFileSync(jsPath, 'utf8')
if (!js.includes(needle)) throw new Error('Unable to disable the Kaspa file URL fallback')
js = js.replace(needle, "throw new Error('Kaspa WASM bytes are required');")
fs.writeFileSync(jsPath, js)
const wasm = fs.readFileSync(path.join(root, 'kaspa_bg.wasm')).toString('base64')
fs.writeFileSync(path.join(root, 'kaspa_bg.base64.js'), `const kaspaWasmBase64 = '${wasm}';\nexport default kaspaWasmBase64;\n`)
fs.writeFileSync(path.join(root, 'kaspa_bg.base64.d.ts'), 'declare const kaspaWasmBase64: string;\nexport default kaspaWasmBase64;\n')
NODE

for file in kaspa.js kaspa.d.ts kaspa_bg.wasm kaspa_bg.base64.js kaspa_bg.base64.d.ts; do
  install -m 0644 "$GENERATED_DIR/$file" "$VENDOR_DIR/$file"
done
if [[ -f "$GENERATED_DIR/kaspa_bg.wasm.d.ts" ]]; then
  install -m 0644 "$GENERATED_DIR/kaspa_bg.wasm.d.ts" "$VENDOR_DIR/kaspa_bg.wasm.d.ts"
fi

if grep -aEiq 'MiningManager|getBlockTemplate|submitBlock|estimateNetworkHashesPerSecond|consensus/pow|kaspa-pow|staking' "$VENDOR_DIR/kaspa_bg.wasm"; then
  echo 'Kaspa wallet-only WASM contains a forbidden mining, staking or node RPC marker.' >&2
  exit 1
fi

echo "Kaspa wallet-only WASM built: $(stat -c %s "$VENDOR_DIR/kaspa_bg.wasm") bytes"
