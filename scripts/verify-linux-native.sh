#!/usr/bin/env bash
set -euo pipefail

native_core="${1:-native-core}"
zano_build="${2:-native/vendor/zano_native_lib/Zano/build/altbase-linux-x64}"

fail() {
  echo "Linux native verification failed: $*" >&2
  exit 1
}

expected_wallet_modules=(
  altbase_bitcoin_wallet.so altbase_bitcoin2_wallet.so altbase_bitcoincashii_wallet.so
  altbase_firo_wallet.so altbase_btgs_wallet.so altbase_capstash_wallet.so
  altbase_hypercoin_wallet.so altbase_mydogecoin_wallet.so altbase_pepecoin_wallet.so
  altbase_kerrigan_wallet.so altbase_scash_wallet.so altbase_litecoinii_wallet.so
  altbase_neoxa_wallet.so altbase_terracoin_wallet.so altbase_junkcoin_wallet.so
  altbase_raptoreum_wallet.so altbase_pearl_wallet.so altbase_monero_wallet.so
  libaltbase_zano_wallet.so libaltbase_epic_wallet.so
)
expected_node_modules=(
  altbase_bitcoin_node.so altbase_bitcoin2_node.so altbase_bitcoincashii_node.so
  altbase_firo_node.so altbase_btgs_node.so altbase_capstash_node.so
  altbase_hypercoin_node.so altbase_mydogecoin_node.so altbase_pepecoin_node.so
  altbase_kerrigan_node.so altbase_scash_node.so altbase_litecoinii_node.so
  altbase_neoxa_node.so altbase_terracoin_node.so altbase_junkcoin_node.so
  altbase_raptoreum_node.so altbase_pearl_node.so altbase_zano_node.so
  altbase_epic_node.so altbase_quai_node.so altbase_xgr_node.so
  altbase_qubic_node.so altbase_kaspa_node.so altbase_ckb_node.so
)

actual_wallet_modules="$(
  find "$native_core" -maxdepth 1 -type f \
    \( -name 'altbase_*_wallet.so' -o -name 'libaltbase_*_wallet.so' \) \
    -printf '%f\n' | sort
)"
actual_node_modules="$(
  find "$native_core" -maxdepth 1 -type f -name 'altbase_*_node.so' \
    -printf '%f\n' | sort
)"
expected_wallet_list="$(printf '%s\n' "${expected_wallet_modules[@]}" | sort)"
expected_node_list="$(printf '%s\n' "${expected_node_modules[@]}" | sort)"

[[ "$actual_wallet_modules" == "$expected_wallet_list" ]] \
  || fail "wallet module set differs from the release manifest:$'\n'$(diff -u <(printf '%s\n' "$expected_wallet_list") <(printf '%s\n' "$actual_wallet_modules") || true)"
[[ "$actual_node_modules" == "$expected_node_list" ]] \
  || fail "node module set differs from the release manifest:$'\n'$(diff -u <(printf '%s\n' "$expected_node_list") <(printf '%s\n' "$actual_node_modules") || true)"

wallet_count="${#expected_wallet_modules[@]}"
node_count="${#expected_node_modules[@]}"

stale_mining_objects="$(
  find "$zano_build" -type f \
    \( -iname 'miner.cpp.o' -o -iname 'pos_mining.cpp.o' -o -iname 'libethash*' \) \
    -print
)"
[[ -z "$stale_mining_objects" ]] || fail "mining objects were produced:$'\n'$stale_mining_objects"

mining_pattern='start_(pos_)?mining|stop_(pos_)?mining|toggle_pos_mining|do_pos_mining|pos_mining_context|miner::|ethash::|progpow::|stratum'
for module in "$native_core/libaltbase_zano_core.so" "$native_core/libaltbase_zano_wallet.so"; do
  [[ -f "$module" ]] || fail "missing Zano module: $module"
  if nm -C "$module" 2>/dev/null | grep -Eiq "$mining_pattern"; then
    fail "mining symbol remained in $(basename "$module")"
  fi
  if strings -a "$module" | grep -Eiq "$mining_pattern"; then
    fail "mining string remained in $(basename "$module")"
  fi
done

assert_exports() {
  local module="$1"
  shift
  local exports
  exports="$(nm -D -g --defined-only "$module" | awk '{print $3}' | sort -u)"
  for required in "$@"; do
    grep -Fxq "$required" <<<"$exports" || fail "missing export $required in $(basename "$module")"
  done
  local allowed
  allowed="$(printf '%s\n' "$@" | sort -u)"
  local unexpected
  unexpected="$(comm -13 <(printf '%s\n' "$allowed") <(printf '%s\n' "$exports"))"
  [[ -z "$unexpected" ]] || fail "unexpected exports in $(basename "$module"):$'\n'$unexpected"
}

assert_exports "$native_core/libaltbase_zano_core.so" altbase_zano_free altbase_zano_request
assert_exports "$native_core/libaltbase_zano_wallet.so" altbase_zano_wallet_free altbase_zano_wallet_request
assert_exports "$native_core/libaltbase_utxo_address.so" altbase_utxo_address_free altbase_utxo_address_request
assert_exports "$native_core/libaltbase_utxo_derivation.so" altbase_utxo_derivation_free altbase_utxo_derivation_request
assert_exports "$native_core/libaltbase_utxo_signer.so" altbase_utxo_signer_free altbase_utxo_signer_request
assert_exports "$native_core/libaltbase_utxo_planner.so" altbase_utxo_planner_free altbase_utxo_planner_request
assert_exports "$native_core/libaltbase_wallet_vault.so" altbase_wallet_vault_free altbase_wallet_vault_request

bridge_derivation_smoke="$({
  printf '%s\n' '{"id":"derive-smoke","method":"deriveAddress","params":{"coin":"bitcoin","phrase":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about","derivationPath":"m/84'\''/0'\''/0'\''/0/0","p2pkhPrefix":0,"wifPrefix":128,"bech32Hrp":"bc","addressType":"p2wpkh"}}'
} | ALTBASE_CORE_BRIDGE=1 "$native_core/altbase_core_bridge")"
grep -Fq '"id":"derive-smoke","ok":true' <<<"$bridge_derivation_smoke" \
  || fail "coin wallet module could not derive an address through the Linux bridge: $bridge_derivation_smoke"
grep -Fq '"address":"bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"' <<<"$bridge_derivation_smoke" \
  || fail "Linux bridge returned the wrong BIP84 derivation vector: $bridge_derivation_smoke"

missing_dependencies=()
while IFS= read -r binary; do
  readelf -h "$binary" >/dev/null 2>&1 || continue
  while IFS= read -r needed; do
    case "$needed" in
      libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|ld-linux-*.so.*)
        continue
        ;;
    esac
    [[ -f "$native_core/$needed" ]] ||
      missing_dependencies+=("$(basename "$binary") -> $needed")
  done < <(readelf -d "$binary" | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p')
done < <(find "$native_core" -maxdepth 1 -type f -print)

if [[ "${#missing_dependencies[@]}" -gt 0 ]]; then
  printf 'Missing bundled dependencies:\n%s\n' "${missing_dependencies[@]}" >&2
  exit 1
fi

if [[ "${ALTBASE_STRIP_NATIVE:-0}" == "1" ]]; then
  while IFS= read -r binary; do
    strip --strip-unneeded "$binary"
  done < <(
    find "$native_core" -maxdepth 1 -type f \
      \( -name 'altbase_core_bridge' -o -name 'altbase_*.so' -o -name 'libaltbase_*.so' \) \
      -print
  )
fi

echo "Linux native verification passed: $wallet_count wallet modules, $node_count node modules"
