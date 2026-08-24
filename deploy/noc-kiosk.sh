#!/usr/bin/env bash
set -euo pipefail

dashboard_url="${NOC_DASHBOARD_URL:-http://127.0.0.1:3100}"

if command -v chromium >/dev/null 2>&1; then
  exec chromium --kiosk --no-first-run --disable-session-crashed-bubble "$dashboard_url"
fi

if command -v chromium-browser >/dev/null 2>&1; then
  exec chromium-browser --kiosk --no-first-run --disable-session-crashed-bubble "$dashboard_url"
fi

if command -v google-chrome >/dev/null 2>&1; then
  exec google-chrome --kiosk --no-first-run "$dashboard_url"
fi

if command -v firefox >/dev/null 2>&1; then
  exec firefox --kiosk "$dashboard_url"
fi

echo "Installez Chromium, Google Chrome ou Firefox pour le mode kiosque." >&2
exit 1
