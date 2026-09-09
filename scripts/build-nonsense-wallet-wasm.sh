#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${ALTBASE_DEPENDENCY_CACHE_DIR:-$(dirname "$ROOT_DIR")/.downloads}"
BASE_SOURCE="${ALTBASE_KASPA_SOURCE_DIR:-$CACHE_DIR/rusty-kaspa-v2.0.1}"
PATCHED_SOURCE="$CACHE_DIR/rusty-kaspa-v2.0.1-nonsense"
PATCH_FILE="$ROOT_DIR/modules/nonsense/rust-wallet-wasm/patches/nonsense-address-prefix.patch"
BINDGEN_NAME="wasm-bindgen-0.2.100-x86_64-unknown-linux-musl"
BINDGEN_ROOT="$CACHE_DIR/$BINDGEN_NAME"
CRATE_ROOT="$ROOT_DIR/modules/nonsense/rust-wallet-wasm"
GENERATED_DIR="$CRATE_ROOT/generated"
VENDOR_DIR="$ROOT_DIR/vendor/nonsense-wasm-v0.1.7"
BUILD_JOBS="${ALTBASE_BUILD_JOBS:-7}"

[[ -f "$BASE_SOURCE/Cargo.toml" ]] || {
  echo "Nonsense wallet build requires the cached Karlsen-compatible base source at $BASE_SOURCE" >&2
  exit 1
}
[[ -x "$BINDGEN_ROOT/wasm-bindgen" ]] || {
  echo "Nonsense wallet build requires wasm-bindgen 0.2.100 at $BINDGEN_ROOT" >&2
  exit 1
}

patch_digest="$(sha256sum "$PATCH_FILE" | awk '{print $1}')"
if [[ ! -f "$PATCHED_SOURCE/.altbase-nonsense-patch" ]] \
  || [[ "$(cat "$PATCHED_SOURCE/.altbase-nonsense-patch")" != "$patch_digest" ]]; then
  rm -rf "$PATCHED_SOURCE"
  cp -a "$BASE_SOURCE" "$PATCHED_SOURCE"
  patch --directory "$PATCHED_SOURCE" --strip=1 --forward < "$PATCH_FILE"
  printf '%s\n' "$patch_digest" > "$PATCHED_SOURCE/.altbase-nonsense-patch"
fi

"$BINDGEN_ROOT/wasm-bindgen" --version | grep -F '0.2.100' >/dev/null
if ! rustup toolchain list | grep -Eq '^1\.97\.0(-|[[:space:]])'; then
  rustup toolchain install 1.97.0 --profile minimal
fi
if ! rustup target list --installed --toolchain 1.97.0 | grep -Fxq wasm32-unknown-unknown; then
  rustup target add wasm32-unknown-unknown --toolchain 1.97.0
fi

escaped_source="${PATCHED_SOURCE//&/\\&}"
sed "s|__KASPA_SOURCE__|$escaped_source|g" "$CRATE_ROOT/Cargo.toml.template" > "$CRATE_ROOT/Cargo.toml"

export RUSTFLAGS='--cfg getrandom_backend="wasm_js"'
export CARGO_NET_RETRY="${CARGO_NET_RETRY:-100}"
export CARGO_HTTP_TIMEOUT="${CARGO_HTTP_TIMEOUT:-600}"
if ! cargo +1.97.0 fetch --offline --locked --manifest-path "$CRATE_ROOT/Cargo.toml"; then
  cargo +1.97.0 fetch --locked --manifest-path "$CRATE_ROOT/Cargo.toml"
fi
(
  # Never let the host C/C++ toolchain leak into cc-rs for the WASM target.
  # In particular, build-all may select GCC for native code through CC/CXX.
  unset CC CXX CPP AR CFLAGS CPPFLAGS CXXFLAGS LDFLAGS
  cargo +1.97.0 build --offline --locked \
    --manifest-path "$CRATE_ROOT/Cargo.toml" \
    --target wasm32-unknown-unknown \
    --release \
    -j "$BUILD_JOBS"
)

rm -rf "$GENERATED_DIR"
mkdir -p "$GENERATED_DIR" "$VENDOR_DIR"
"$BINDGEN_ROOT/wasm-bindgen" \
  "$CRATE_ROOT/target/wasm32-unknown-unknown/release/altbase_nonsense_wallet_wasm.wasm" \
  --target web \
  --out-dir "$GENERATED_DIR" \
  --out-name nonsense

node - "$GENERATED_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const jsPath = path.join(root, 'nonsense.js')
const needle = "module_or_path = new URL('nonsense_bg.wasm', import.meta.url);"
let js = fs.readFileSync(jsPath, 'utf8')
if (!js.includes(needle)) throw new Error('Unable to disable the Nonsense file URL fallback')
js = js.replace(needle, "throw new Error('Nonsense WASM bytes are required');")
fs.writeFileSync(jsPath, js)
const wasm = fs.readFileSync(path.join(root, 'nonsense_bg.wasm')).toString('base64')
fs.writeFileSync(path.join(root, 'nonsense_bg.base64.js'), `const nonsenseWasmBase64 = '${wasm}';\nexport default nonsenseWasmBase64;\n`)
fs.writeFileSync(path.join(root, 'nonsense_bg.base64.d.ts'), 'declare const nonsenseWasmBase64: string;\nexport default nonsenseWasmBase64;\n')
NODE

for file in nonsense.js nonsense.d.ts nonsense_bg.wasm nonsense_bg.base64.js nonsense_bg.base64.d.ts; do
  install -m 0644 "$GENERATED_DIR/$file" "$VENDOR_DIR/$file"
done
if [[ -f "$GENERATED_DIR/nonsense_bg.wasm.d.ts" ]]; then
  install -m 0644 "$GENERATED_DIR/nonsense_bg.wasm.d.ts" "$VENDOR_DIR/nonsense_bg.wasm.d.ts"
fi

if grep -aEiq 'MiningManager|getBlockTemplate|submitBlock|estimateNetworkHashesPerSecond|consensus/pow|kaspa-pow|staking' "$VENDOR_DIR/nonsense_bg.wasm"; then
  echo 'Nonsense wallet-only WASM contains a mining, staking or node RPC marker.' >&2
  exit 1
fi

echo "Nonsense wallet-only WASM built: $(stat -c %s "$VENDOR_DIR/nonsense_bg.wasm") bytes"
