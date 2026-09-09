#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${ALTBASE_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
cd "$ROOT"

export npm_config_prefer_offline=true
export npm_config_audit=false
export npm_config_fund=false

fail() {
  printf 'Windows build failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

for command_name in cmp curl find grep node npm ps sha256sum sort unzip x86_64-w64-mingw32-objdump xargs zip; do
  require_command "$command_name"
done

# WiX produces a ~500 MiB database plus three compressed cabinets before the
# final MSI is assembled. A typical tmpfs can run out of space mid-update while
# gcab/msibuild still report success, leaving a truncated MSI. Keep all Windows
# packaging scratch data in the disk-backed build cache unless explicitly
# overridden by the caller.
cache_base="${XDG_CACHE_HOME:-$(node -p "require('node:os').homedir()")/.cache}"
export TMPDIR="${ALTBASE_BUILD_TMPDIR:-$cache_base/altbase-build/tmp}"
mkdir -p "$TMPDIR"

[[ -f package.json && -f scripts/build-native-installer.cjs ]] || fail "run this script from the Altbase repository"
bash scripts/build-nonsense-wallet-wasm.sh
if [[ ! -x node_modules/.bin/electron-builder ]]; then
  npm ci --prefer-offline --no-audit --no-fund
fi

version="$(node -p "require('./package.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "invalid package version: $version"

npm test
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]; then
  npm run build:core
else
  for command_name in cargo clang-cl-19 lld-link-19 llvm-dlltool-19 llvm-lib-19 llvm-rc-19 rustup; do
    require_command "$command_name"
  done
  node scripts/build-windows-epic-sender.cjs
  node scripts/build-windows-native-incremental.cjs
fi
npm run dist:win:dir

if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]; then
  node scripts/build-native-installer.cjs
else
  for command_name in cc gcab msibuild msiinfo msiextract pkg-config timeout; do
    require_command "$command_name"
  done
  if [[ "${ALTBASE_SKIP_WINE_ACCEPTANCE:-0}" != "1" ]]; then
    for command_name in wine winepath wineserver xvfb-run xwininfo; do
      require_command "$command_name"
    done
  fi
  cross_root="${ALTBASE_CROSS_MSI_TOOLS:-/}"
  # electron-builder's WiX tools share the default Wine server. A server left
  # by an earlier run can keep a duplicate light.exe alive and race the next
  # build while it moves the generated MSI into place.
  WINEDEBUG=-all wineserver -k >/dev/null 2>&1 || true
  timeout 15s env WINEDEBUG=-all wineserver -w >/dev/null 2>&1 || true
  ALTBASE_CROSS_MSI_TOOLS="$cross_root" node scripts/build-native-installer.cjs
  WINEDEBUG=-all wineserver -k >/dev/null 2>&1 || true
  timeout 15s env WINEDEBUG=-all wineserver -w >/dev/null 2>&1 || true
fi

app_dir="$ROOT/release/win-unpacked"
msi="$ROOT/release/Altbase-Wallet-Windows.msi"
dll="$app_dir/resources/native-core/altbase_monero_wallet.dll"
xgr_node="$app_dir/resources/native-core/altbase_xgr_node.dll"
nonsense_node="$app_dir/resources/native-core/altbase_nonsense_node.dll"
bridge="$app_dir/resources/native-core/altbase_core_bridge.exe"
asar="$app_dir/resources/app.asar"
for required_file in "$msi" "$dll" "$xgr_node" "$nonsense_node" "$bridge" "$asar"; do
  [[ -s "$required_file" ]] || fail "missing build output: $required_file"
done

packaged_version="$(node -e "const a=require('@electron/asar'); console.log(JSON.parse(a.extractFile(process.argv[1],'package.json')).version)" "$asar")"
[[ "$packaged_version" == "$version" ]] || fail "packaged version is $packaged_version, expected $version"

pe_report="$(x86_64-w64-mingw32-objdump -p "$dll")"
imports="$(printf '%s\n' "$pe_report" | sed -n 's/^[[:space:]]*DLL Name:[[:space:]]*//p' | tr '[:upper:]' '[:lower:]' | sort -u)"
expected_imports=$'altbase_net_core.dll\nbcrypt.dll\nkernel32.dll'
[[ "$imports" == "$expected_imports" ]] || fail "unexpected DLL imports: ${imports//$'\n'/, }"
exports="$(printf '%s\n' "$pe_report" | sed -n '/\[Ordinal\/Name Pointer\] Table/,/The Function Table/p' | sed -n 's/.*altbase_monero_wallet_\(free\|request\)$/altbase_monero_wallet_\1/p' | sort -u)"
expected_exports=$'altbase_monero_wallet_free\naltbase_monero_wallet_request'
[[ "$exports" == "$expected_exports" ]] || fail "wallet DLL does not have the exact two-function ABI"

xgr_exports="$(x86_64-w64-mingw32-objdump -p "$xgr_node" | sed -n '/\[Ordinal\/Name Pointer\] Table/,/The Function Table/p' | sed -n 's/.*altbase_xgr_node_\(free\|request\)$/altbase_xgr_node_\1/p' | sort -u)"
expected_xgr_exports=$'altbase_xgr_node_free\naltbase_xgr_node_request'
[[ "$xgr_exports" == "$expected_xgr_exports" ]] || fail "XGR node DLL does not have the exact two-function ABI"
nonsense_exports="$(x86_64-w64-mingw32-objdump -p "$nonsense_node" | sed -n '/\[Ordinal\/Name Pointer\] Table/,/The Function Table/p' | sed -n 's/.*altbase_nonsense_node_\(free\|request\)$/altbase_nonsense_node_\1/p' | sort -u)"
expected_nonsense_exports=$'altbase_nonsense_node_free\naltbase_nonsense_node_request'
[[ "$nonsense_exports" == "$expected_nonsense_exports" ]] || fail "Nonsense node DLL does not have the exact two-function ABI"

bridge_imports="$(x86_64-w64-mingw32-objdump -p "$bridge" | sed -n 's/^[[:space:]]*DLL Name:[[:space:]]*//p' | tr '[:upper:]' '[:lower:]' | sort -u)"
expected_bridge_imports=$'altbase_bitcoin2_node.dll\naltbase_bitcoin2_wallet.dll\naltbase_bitcoin_node.dll\naltbase_bitcoin_wallet.dll\naltbase_bitcoincashii_node.dll\naltbase_bitcoincashii_wallet.dll\naltbase_btgs_node.dll\naltbase_btgs_wallet.dll\naltbase_capstash_node.dll\naltbase_capstash_wallet.dll\naltbase_ckb_node.dll\naltbase_epic_node.dll\naltbase_epic_wallet.dll\naltbase_firo_node.dll\naltbase_firo_wallet.dll\naltbase_hypercoin_node.dll\naltbase_hypercoin_wallet.dll\naltbase_junkcoin_node.dll\naltbase_junkcoin_wallet.dll\naltbase_kaspa_node.dll\naltbase_kerrigan_node.dll\naltbase_kerrigan_wallet.dll\naltbase_litecoinii_node.dll\naltbase_litecoinii_wallet.dll\naltbase_mydogecoin_node.dll\naltbase_mydogecoin_wallet.dll\naltbase_neoxa_node.dll\naltbase_neoxa_wallet.dll\naltbase_nonsense_node.dll\naltbase_pearl_node.dll\naltbase_pearl_wallet.dll\naltbase_pepecoin_node.dll\naltbase_pepecoin_wallet.dll\naltbase_quai_node.dll\naltbase_qubic_node.dll\naltbase_raptoreum_node.dll\naltbase_raptoreum_wallet.dll\naltbase_scash_node.dll\naltbase_scash_wallet.dll\naltbase_terracoin_node.dll\naltbase_terracoin_wallet.dll\naltbase_utxo_address.dll\naltbase_utxo_derivation.dll\naltbase_utxo_planner.dll\naltbase_utxo_signer.dll\naltbase_wallet_vault.dll\naltbase_xgr_node.dll\naltbase_zano_node.dll\naltbase_zano_wallet.dll\nkernel32.dll\nuser32.dll'
[[ "$bridge_imports" == "$expected_bridge_imports" ]] \
  || fail "native bridge imports differ from the official modular ABI: ${bridge_imports//$'\n'/, }"

verify_root="$(mktemp -d "${TMPDIR:-/tmp}/altbase-msi-verify.XXXXXX")"
artifact_tmp="$(mktemp -d "${TMPDIR:-/tmp}/altbase-win-artifacts.XXXXXX")"
cleanup_paths=("$verify_root" "$artifact_tmp")
cleanup() {
  # Stop the disposable prefix before deleting it. If a later verification
  # fails, leaving its Wine server alive keeps Electron's debugging socket
  # and makes the next otherwise-clean build fail for an unrelated reason.
  if [[ -n "${wine_prefix:-}" && -d "$wine_prefix" ]]; then
    WINEPREFIX="$wine_prefix" WINEDEBUG=-all wineserver -k >/dev/null 2>&1 || true
    timeout 15s env WINEPREFIX="$wine_prefix" WINEDEBUG=-all wineserver -w >/dev/null 2>&1 || true
  fi
  find "${cleanup_paths[@]}" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

msiextract -C "$verify_root" "$msi" >/dev/null
extracted_dll="$(find "$verify_root" -type f -name altbase_monero_wallet.dll -print -quit)"
extracted_xgr_node="$(find "$verify_root" -type f -name altbase_xgr_node.dll -print -quit)"
extracted_nonsense_node="$(find "$verify_root" -type f -name altbase_nonsense_node.dll -print -quit)"
[[ -n "$extracted_dll" ]] || fail "MSI does not contain the Monero wallet DLL"
[[ -n "$extracted_xgr_node" ]] || fail "MSI does not contain the XGR node DLL"
[[ -n "$extracted_nonsense_node" ]] || fail "MSI does not contain the Nonsense node DLL"
[[ "$(sha256sum "$extracted_dll" | awk '{print $1}')" == "$(sha256sum "$dll" | awk '{print $1}')" ]] \
  || fail "MSI contains a different Monero wallet DLL"
[[ "$(sha256sum "$extracted_xgr_node" | awk '{print $1}')" == "$(sha256sum "$xgr_node" | awk '{print $1}')" ]] \
  || fail "MSI contains a different XGR node DLL"
[[ "$(sha256sum "$extracted_nonsense_node" | awk '{print $1}')" == "$(sha256sum "$nonsense_node" | awk '{print $1}')" ]] \
  || fail "MSI contains a different Nonsense node DLL"

if [[ "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* && "${OSTYPE:-}" != win32* ]]; then
  summary="$(msiinfo suminfo "$msi")"
  [[ "$summary" == *'Version: 500'* ]] || fail "MSI does not target Windows Installer 5.0"
  [[ "$summary" == *'Source: 2 (2)'* ]] || fail "MSI does not declare its embedded payload as compressed"
  expected_msi_version="$(node -p "require('./package.json').version.split('-')[0]")"
  msi_version="$(msiinfo export "$msi" Property | tr -d '\r' | awk -F '\t' '$1 == "ProductVersion" { print $2; exit }')"
  [[ "$msi_version" == "$expected_msi_version" || "$msi_version" == "${expected_msi_version}.0" ]] \
    || fail "MSI ProductVersion is $msi_version, expected $expected_msi_version or ${expected_msi_version}.0"
  msi_reinstall_mode="$(msiinfo export "$msi" Property | tr -d '\r' | awk -F '\t' '$1 == "REINSTALLMODE" { print $2; exit }')"
  [[ "$msi_reinstall_mode" == "amus" ]] \
    || fail "MSI does not force exact payload replacement during major upgrades"

  if [[ "${ALTBASE_SKIP_WINE_ACCEPTANCE:-0}" != "1" ]]; then
  user_cache_root="${XDG_CACHE_HOME:-$(node -p "require('node:os').homedir()")/.cache}"
  wine_test_root="${ALTBASE_WINE_TEST_ROOT:-$user_cache_root/altbase-build}"
  mkdir -p "$wine_test_root"
  # A same-version Electron upgrade briefly needs more space than a small
  # tmpfs can provide. Keep the disposable prefix on the disk-backed cache;
  # it is still removed by the EXIT cleanup below.
  wine_prefix="$(mktemp -d "$wine_test_root/altbase-msi-wine.XXXXXX")"
  cleanup_paths+=("$wine_prefix")
  WINEPREFIX="$wine_prefix" WINEDEBUG=-all xvfb-run -a wineboot -u >/dev/null 2>&1
  wine_desktop="$wine_prefix/drive_c/users/$(id -un)/Desktop"
  if [[ -L "$wine_desktop" ]]; then find "$wine_desktop" -delete; fi
  mkdir -p "$wine_desktop"

  reset_wine_server() {
    WINEPREFIX="$wine_prefix" WINEDEBUG=-all wineserver -k >/dev/null 2>&1 || true
    timeout 15s env WINEPREFIX="$wine_prefix" WINEDEBUG=-all wineserver -w >/dev/null 2>&1 || true
  }

  install_with_wine() {
    local package="$1"
    local label="$2"
    local package_windows_path log_path log_windows_path
    # Each xvfb-run owns a short-lived X server. Reusing a Wine server from
    # the preceding invocation leaves it bound to a dead DISPLAY and makes
    # the next msiexec fail before it can write its log (exit code 31).
    reset_wine_server
    package_windows_path="$(WINEPREFIX="$wine_prefix" WINEDEBUG=-all winepath -w "$package")"
    log_path="$verify_root/install-${label}.log"
    log_windows_path="$(WINEPREFIX="$wine_prefix" WINEDEBUG=-all winepath -w "$log_path")"
    if ! WINEPREFIX="$wine_prefix" WINEDEBUG=-all xvfb-run -a wine msiexec \
      /i "$package_windows_path" /qn /norestart '/l*v' "$log_windows_path"; then
      tail -n 100 "$log_path" >&2 || true
      fail "Windows Installer rejected the $label MSI"
    fi
  }

  previous_msi="$ROOT/artifacts/Altbase-Wallet-Windows-v${version}.msi"
  if [[ -s "$previous_msi" ]] \
    && [[ "$(sha256sum "$previous_msi" | awk '{print $1}')" != "$(sha256sum "$msi" | awk '{print $1}')" ]]; then
    install_with_wine "$previous_msi" previous-release
  fi
  install_with_wine "$msi" current-release
  # A same-version maintenance install must leave the application launchable.
  install_with_wine "$msi" current-release-reinstall

  installed_exe="$(find "$wine_prefix/drive_c" -type f -iname 'Altbase Wallet.exe' -print -quit)"
  [[ -s "$installed_exe" ]] || fail "MSI completed without installing Altbase Wallet.exe"
  [[ "$(sha256sum "$installed_exe" | awk '{print $1}')" == "$(sha256sum "$app_dir/Altbase Wallet.exe" | awk '{print $1}')" ]] \
    || fail "MSI installed a different Altbase Wallet.exe"

  source_manifest="$verify_root/source-tree.sha256"
  installed_manifest="$verify_root/installed-tree.sha256"
  (cd "$app_dir" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$source_manifest"
  (cd "$(dirname "$installed_exe")" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$installed_manifest"
  cmp -s "$source_manifest" "$installed_manifest" \
    || fail "MSI-installed application tree differs from release/win-unpacked"

  installed_native_dir="$(dirname "$installed_exe")/resources/native-core"
  installed_bridge="$installed_native_dir/altbase_core_bridge.exe"
  [[ -s "$installed_bridge" ]] || fail "MSI completed without installing the native bridge"
  bridge_windows_path="$(WINEPREFIX="$wine_prefix" WINEDEBUG=-all winepath -w "$installed_bridge")"
  bridge_manual_log="$verify_root/bridge-manual.log"
  bridge_manual_windows="$verify_root/bridge-manual-windows.txt"
  reset_wine_server
  if ! timeout --foreground 20s env WINEPREFIX="$wine_prefix" WINEDEBUG=-all \
    ALTBASE_BRIDGE_WINDOWS="$bridge_windows_path" ALTBASE_BRIDGE_LOG="$bridge_manual_log" \
    ALTBASE_BRIDGE_WINDOW_TREE="$bridge_manual_windows" xvfb-run -a bash -c '
      wine "$ALTBASE_BRIDGE_WINDOWS" >"$ALTBASE_BRIDGE_LOG" 2>&1 &
      bridge_pid=$!
      for attempt in $(seq 1 15); do
        xwininfo -root -tree >"$ALTBASE_BRIDGE_WINDOW_TREE" 2>&1 || true
        if grep -Eqi '\''"Altbase Core Bridge": \("altbase_core_bridge\.exe" "altbase_core_bridge\.exe"\)'\'' "$ALTBASE_BRIDGE_WINDOW_TREE"; then
          wine taskkill /f /im altbase_core_bridge.exe >/dev/null 2>&1 || true
          wait "$bridge_pid" >/dev/null 2>&1 || true
          exit 0
        fi
        kill -0 "$bridge_pid" 2>/dev/null || {
          wait "$bridge_pid"
          exit $?
        }
        sleep 1
      done
      exit 1
    '; then
    tail -n 80 "$bridge_manual_log" >&2 || true
    tail -n 80 "$bridge_manual_windows" >&2 || true
    fail "manual native bridge launch did not create its diagnostic window"
  fi

  isolated_native_dir="$verify_root/isolated-native-core"
  mkdir -p "$isolated_native_dir"
  # The release bridge uses the official modular ABI through ordinary PE
  # imports, so Windows resolves every native module before main() runs. Copy
  # that complete dependency set for the vault smoke test; a directory with
  # only the vault DLL merely tests ERROR_MOD_NOT_FOUND and can never exercise
  # create/restore.
  while IFS= read -r -d '' native_dll; do
    install -m 0644 "$native_dll" "$isolated_native_dir/$(basename "$native_dll")"
  done < <(find "$installed_native_dir" -maxdepth 1 -type f -iname '*.dll' -print0)
  install -m 0755 "$installed_bridge" "$isolated_native_dir/altbase_core_bridge.exe"
  isolated_bridge_windows="$(WINEPREFIX="$wine_prefix" WINEDEBUG=-all winepath -w "$isolated_native_dir/altbase_core_bridge.exe")"
  bridge_requests="$verify_root/bridge-vault-requests.jsonl"
  bridge_responses="$verify_root/bridge-vault-responses.jsonl"
  node -e '
    const fs = require("node:fs")
    const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    const rows = [
      { id: "health", method: "health", params: {} },
      { id: "validate", method: "validatePhrase", params: { phrase } },
      { id: "create", method: "createWalletSecret", params: {
        phrase,
        password: "Altbase-Test-Password-2026!",
        requirePhraseAcknowledgement: "true",
        phraseAcknowledged: "true",
      } },
      { id: "after", method: "generatePhrase", params: {} },
    ]
    fs.writeFileSync(process.argv[1], `${rows.map(JSON.stringify).join("\n")}\n`)
  ' "$bridge_requests"
  reset_wine_server
  if ! timeout --foreground 40s env WINEPREFIX="$wine_prefix" WINEDEBUG=-all \
    xvfb-run -a wine "$isolated_bridge_windows" --altbase-wallet-bridge \
    <"$bridge_requests" >"$bridge_responses"; then
    tail -n 80 "$bridge_responses" >&2 || true
    fail "isolated native bridge exited during vault verification"
  fi
  node -e '
    const fs = require("node:fs")
    const rows = fs.readFileSync(process.argv[1], "utf8").trim().split(/\r?\n/).map(JSON.parse)
    const byId = new Map(rows.map((row) => [row.id, row]))
    if (byId.get("health")?.result?.status !== "ok") process.exit(1)
    if (byId.get("validate")?.result?.isValid !== "true") process.exit(2)
    const created = byId.get("create")?.result
    if (!created?.cipherText || !created?.verifyHash || !created?.verifySalt) process.exit(3)
    if ((byId.get("after")?.result?.phrase || "").trim().split(/\s+/).length !== 12) process.exit(4)
  ' "$bridge_responses" || fail "native vault did not survive an unrelated missing module"

  app_log="$verify_root/application-start.log"
  window_tree="$verify_root/application-window-tree.txt"
  installed_shortcut="$(find "$wine_desktop" "$wine_prefix/drive_c/users" -type f -iname 'Altbase Wallet.lnk' -print -quit)"
  [[ -s "$installed_shortcut" ]] || fail "MSI completed without installing an Altbase Wallet shortcut"
  shortcut_windows_path="$(WINEPREFIX="$wine_prefix" WINEDEBUG=-all winepath -w "$installed_shortcut")"
  # Variables expand inside the child shell from its explicit environment.
  # shellcheck disable=SC2016
  reset_wine_server
  if ! timeout --foreground 60s env WINEPREFIX="$wine_prefix" WINEDEBUG=-all \
    ALTBASE_SHORTCUT_WINDOWS="$shortcut_windows_path" ALTBASE_START_LOG="$app_log" \
    ALTBASE_WINDOW_TREE="$window_tree" xvfb-run -a bash -c '
      wine cmd /d /s /c start '\''""'\'' "\"$ALTBASE_SHORTCUT_WINDOWS\"" >"$ALTBASE_START_LOG" 2>&1
      for attempt in $(seq 1 30); do
        xwininfo -root -tree >"$ALTBASE_WINDOW_TREE" 2>&1 || true
        if grep -Eqi "Program Error|Internal Error|parameter is incorrect|Wine Debugger" "$ALTBASE_WINDOW_TREE"; then
          exit 2
        fi
        if grep -Eqi '\''"Altbase Wallet": \("altbase wallet\.exe" "altbase wallet\.exe"\)[[:space:]]+[0-9]{3,}x[0-9]{3,}'\'' "$ALTBASE_WINDOW_TREE"; then
          # A brand-new Wine/Windows profile can need roughly 20 seconds to
          # initialize Electron storage before native-core is spawned.
          for process_attempt in $(seq 1 30); do
            renderer_found=0
            bridge_found=0
            process_list="$(ps -eo comm=,args=)"
            if grep -Eqi "^[[:space:]]*CrRendererMain[[:space:]]+.*Altbase Wallet\.exe.*--type=renderer" <<<"$process_list"; then
              renderer_found=1
            fi
            if grep -Eqi "^[[:space:]]*altbase_core_br[^[:space:]]*[[:space:]]+.*altbase_core_bridge\.exe.*--altbase-wallet-bridge" <<<"$process_list"; then
              bridge_found=1
            fi
            if [[ "$renderer_found" -eq 1 && "$bridge_found" -eq 1 ]]; then exit 0; fi
            sleep 1
          done
          exit 3
        fi
        sleep 1
      done
      exit 1
    '; then
    tail -n 100 "$app_log" >&2 || true
    tail -n 100 "$window_tree" >&2 || true
    fail "installed Altbase Wallet shortcut did not create the real application window"
  fi
  reset_wine_server
  WINEPREFIX="$wine_prefix" WINEDEBUG=-all xvfb-run -a wineboot -u >/dev/null 2>&1
  reset_wine_server
  installed_exe_windows="$(WINEPREFIX="$wine_prefix" WINEDEBUG=-all winepath -w "$installed_exe")"
  ui_e2e_log="$verify_root/windows-wallet-ui-e2e.log"
  cdp_port="$(node -e '
    const net = require("node:net")
    const server = net.createServer()
    server.unref()
    server.on("error", () => process.exit(1))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => process.stdout.write(String(port)))
    })
  ')"
  [[ "$cdp_port" =~ ^[1-9][0-9]{3,4}$ ]] || fail "could not allocate a free CDP port"
  if ! timeout --foreground 90s env WINEPREFIX="$wine_prefix" WINEDEBUG=-all \
    ALTBASE_INSTALLED_EXE_WINDOWS="$installed_exe_windows" ALTBASE_CDP_PORT="$cdp_port" \
    ALTBASE_E2E_DISPOSABLE_PROFILE=1 \
    ALTBASE_UI_E2E_SCRIPT="$ROOT/scripts/test-windows-wallet-ui.cjs" ALTBASE_UI_E2E_LOG="$ui_e2e_log" \
    xvfb-run -a bash -c '
      wine "$ALTBASE_INSTALLED_EXE_WINDOWS" --remote-debugging-port="$ALTBASE_CDP_PORT" >"$ALTBASE_UI_E2E_LOG" 2>&1 &
      app_pid=$!
      ready=0
      for attempt in $(seq 1 80); do
        if curl -fsS "http://127.0.0.1:$ALTBASE_CDP_PORT/json/list" >/dev/null 2>&1; then
          ready=1
          break
        fi
        kill -0 "$app_pid" 2>/dev/null || {
          wait "$app_pid"
          exit $?
        }
        sleep 0.25
      done
      [[ "$ready" -eq 1 ]] || exit 4
      node "$ALTBASE_UI_E2E_SCRIPT" "$ALTBASE_CDP_PORT"
      status=$?
      wine taskkill /f /im "Altbase Wallet.exe" >/dev/null 2>&1 || true
      wait "$app_pid" >/dev/null 2>&1 || true
      exit "$status"
    '; then
    tail -n 120 "$ui_e2e_log" >&2 || true
    fail "installed Windows wallet failed create/restore UI verification"
  fi
  reset_wine_server
  fi
fi

mkdir -p artifacts
(cd "$app_dir" && zip -q -r -9 "$artifact_tmp/Altbase-Wallet-Windows-portable-v${version}.zip" .)
unzip -tq "$artifact_tmp/Altbase-Wallet-Windows-portable-v${version}.zip" >/dev/null

install -m 0644 "$msi" "artifacts/Altbase-Wallet-Windows-v${version}.msi"
install -m 0644 "$dll" "artifacts/altbase_monero_wallet-windows-v${version}.dll"
mv "$artifact_tmp/Altbase-Wallet-Windows-portable-v${version}.zip" "artifacts/"

printf 'Windows %s build passed.\n' "$version"
sha256sum \
  "artifacts/Altbase-Wallet-Windows-v${version}.msi" \
  "artifacts/Altbase-Wallet-Windows-portable-v${version}.zip" \
  "artifacts/altbase_monero_wallet-windows-v${version}.dll"
