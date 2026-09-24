#!/usr/bin/env bash

set -u

readonly GATEWAY_URL="http://127.0.0.1:36681/api/v1"
readonly STATE_DIR="/run/altbase-node-health"
readonly FAILURE_LIMIT=3
readonly STARTUP_GRACE_SECONDS=1800
readonly REQUEST_TIMEOUT_SECONDS=20

declare -Ar COIN_SERVICES=(
  [zano]="coin-zano.service"
  [epic]="coin-epic.service"
  [terracoin]="coin-terracoin.service"
  [raptoreum]="coin-raptoreum.service"
  [junkcoin]="coin-junkcoin.service"
  [neoxa]="coin-neoxa.service"
)

declare -Ar UTXO_CLIS=(
  [terracoin]="/opt/coin-sync/bin/terracoin-cli"
  [raptoreum]="/opt/coin-sync/bin/raptoreum-cli"
  [junkcoin]="/opt/coin-sync/bin/junkcoin-cli"
  [neoxa]="/opt/coin-sync/bin/neoxa-cli"
)

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/health.lock"
flock -n 9 || exit 0

log() {
  printf 'altbase-node-health: %s\n' "$*"
}

counter_value() {
  local file="$1"
  local value=0
  if [[ -r "$file" ]]; then read -r value <"$file" || value=0; fi
  [[ "$value" =~ ^[0-9]+$ ]] || value=0
  printf '%s' "$value"
}

increment_counter() {
  local file="$1"
  local value
  value=$(counter_value "$file")
  value=$((value + 1))
  printf '%s\n' "$value" >"$file"
  printf '%s' "$value"
}

reset_counter() {
  printf '0\n' >"$1"
}

service_age_seconds() {
  local unit="$1"
  local active_usec uptime_seconds now_usec
  active_usec=$(systemctl show "$unit" -p ActiveEnterTimestampMonotonic --value 2>/dev/null)
  uptime_seconds=$(cut -d' ' -f1 /proc/uptime)
  now_usec=$(awk -v uptime="$uptime_seconds" 'BEGIN { printf "%.0f", uptime * 1000000 }')
  if [[ "$active_usec" =~ ^[0-9]+$ ]] && ((active_usec > 0 && now_usec >= active_usec)); then
    printf '%s' $(((now_usec - active_usec) / 1000000))
  else
    printf '0'
  fi
}

check_utxo_node() {
  local coin="$1"
  local cli="${UTXO_CLIS[$coin]}"
  local datadir="/opt/coin-sync/data/$coin"
  local conf="$datadir/$coin.conf"
  local output

  if output=$(timeout "$REQUEST_TIMEOUT_SECONDS" "$cli" \
      -datadir="$datadir" -conf="$conf" getblockchaininfo 2>&1); then
    grep -q '"blocks"' <<<"$output"
    return
  fi

  # Core RPC -28 proves the daemon is alive but still loading local chain data.
  grep -Eq 'error code:[[:space:]]*-28|Rewinding blocks|Loading block index|Verifying blocks' <<<"$output"
}

check_coin() {
  local coin="$1"
  case "$coin" in
    zano)
      curl --fail --silent --show-error --max-time "$REQUEST_TIMEOUT_SECONDS" \
        http://127.0.0.1:11211/getheight \
        | grep -q '"status"[[:space:]]*:[[:space:]]*"OK"'
      ;;
    epic)
      curl --fail --silent --show-error --max-time "$REQUEST_TIMEOUT_SECONDS" \
        http://127.0.0.1:3413/v1/status \
        | grep -q '"tip"'
      ;;
    terracoin|raptoreum|junkcoin|neoxa)
      check_utxo_node "$coin"
      ;;
    *)
      return 1
      ;;
  esac
}

gateway_file="$STATE_DIR/gateway.response"
if curl --fail --silent --show-error --max-time "$REQUEST_TIMEOUT_SECONDS" \
    "$GATEWAY_URL/prices" --output "$gateway_file"; then
  reset_counter "$STATE_DIR/gateway.failures"
else
  gateway_failures=$(increment_counter "$STATE_DIR/gateway.failures")
  log "gateway check failed $gateway_failures/$FAILURE_LIMIT"
  if ((gateway_failures >= FAILURE_LIMIT)); then
    log "restarting altbase-api-node2.service after repeated local gateway failures"
    systemctl restart --no-block altbase-api-node2.service
    reset_counter "$STATE_DIR/gateway.failures"
  fi
fi

for coin in "${!COIN_SERVICES[@]}"; do
  unit="${COIN_SERVICES[$coin]}"
  failure_file="$STATE_DIR/$coin.failures"

  # Zano uses the configured remote source on this host. Do not probe an
  # intentionally disabled and inactive local daemon as a failed service.
  if [[ "$coin" == "zano" ]] \
      && [[ "$(systemctl is-enabled "$unit" 2>/dev/null)" == "disabled" ]] \
      && [[ "$(systemctl is-active "$unit" 2>/dev/null)" == "inactive" ]]; then
    reset_counter "$failure_file"
    continue
  fi

  if check_coin "$coin"; then
    reset_counter "$failure_file"
    continue
  fi

  if [[ "$(systemctl is-active "$unit" 2>/dev/null)" != "active" ]]; then
    log "$coin local check failed while $unit is not active; systemd owns recovery"
    continue
  fi

  age=$(service_age_seconds "$unit")
  if ((age < STARTUP_GRACE_SECONDS)); then
    log "$coin local check failed during startup grace (${age}s/${STARTUP_GRACE_SECONDS}s)"
    reset_counter "$failure_file"
    continue
  fi

  failures=$(increment_counter "$failure_file")
  log "$coin local RPC check failed $failures/$FAILURE_LIMIT"
  if ((failures >= FAILURE_LIMIT)); then
    log "restarting $unit after repeated local RPC failures"
    systemctl restart --no-block "$unit"
    reset_counter "$failure_file"
  fi
done
