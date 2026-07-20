#!/usr/bin/env bash
set -euo pipefail

native_core="${1:-native-core}"
zano_build="${2:-native/vendor/zano_native_lib/Zano/build/altbase-linux-x64}"

fail() {
  echo "Linux native verification failed: $*" >&2
  exit 1
}

wallet_count="$(find "$native_core" -maxdepth 1 -type f \( -name 'altbase_*_wallet.so' -o -name 'libaltbase_*_wallet.so' \) | wc -l)"
node_count="$(find "$native_core" -maxdepth 1 -type f -name 'altbase_*_node.so' | wc -l)"
[[ "$wallet_count" -eq 19 ]] || fail "expected 19 wallet modules, found $wallet_count"
[[ "$node_count" -eq 23 ]] || fail "expected 23 node modules, found $node_count"

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
  exports="$(nm -D --defined-only "$module" | awk '{print $3}' | sort -u)"
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
