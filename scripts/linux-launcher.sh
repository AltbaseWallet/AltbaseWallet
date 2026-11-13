#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
runtime="$app_dir/altcoinwallet-bin"

# This path is also used to run packaged, offline Node verification scripts.
if [ "${ELECTRON_RUN_AS_NODE:-}" = "1" ]; then
  exec "$runtime" "$@"
fi

trusted_helper() {
  [ -n "$1" ] && [ -f "$1" ] && [ -x "$1" ] || return 1
  case "$(stat -Lc '%u:%a' -- "$1" 2>/dev/null || true)" in
    0:4755|0:4555|0:4711|0:4511) return 0 ;;
    *) return 1 ;;
  esac
}

if trusted_helper "$app_dir/chrome-sandbox"; then
  exec "$runtime" "$@"
fi

# Release Electron ignores CHROME_DEVEL_SANDBOX. Point its adjacent helper at an
# already installed, root-owned SUID helper instead. Never chmod a user binary
# SUID or silently disable Chromium's sandbox.
for helper in "${CHROME_DEVEL_SANDBOX:-}" \
  /opt/google/chrome/chrome-sandbox \
  /opt/brave.com/brave/chrome-sandbox \
  /opt/microsoft/msedge/chrome-sandbox \
  /usr/lib/chromium/chrome-sandbox \
  /usr/lib/chromium-browser/chrome-sandbox \
  /usr/lib/electron/chrome-sandbox; do
  if trusted_helper "$helper"; then
    temporary="$app_dir/.chrome-sandbox-link-$$"
    trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
    if ln -s -- "$helper" "$temporary" && mv -fT -- "$temporary" "$app_dir/chrome-sandbox"; then
      trap - EXIT HUP INT TERM
      exec "$runtime" "$@"
    fi
    rm -f -- "$temporary"
    trap - EXIT HUP INT TERM
  fi
done

# Modern kernels can sandbox without a SUID helper. Skip only the invalid SUID
# helper; leave the namespace and seccomp sandbox enabled. Restricted hosts need
# the administrator setup described in LINUX-SANDBOX.txt, not --no-sandbox.
exec "$runtime" --disable-setuid-sandbox "$@"
