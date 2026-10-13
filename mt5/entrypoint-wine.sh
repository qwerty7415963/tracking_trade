#!/usr/bin/env bash
# MT5 Wine entrypoint (spike). Secrets come from env at RUNTIME, never baked in.
# Required env: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, BACKEND_URL, BRIDGE_API_KEY
set -euo pipefail

: "${MT5_LOGIN:?MT5_LOGIN missing}"
: "${MT5_PASSWORD:?MT5_PASSWORD missing}"
: "${MT5_SERVER:?MT5_SERVER missing}"
: "${BACKEND_URL:?BACKEND_URL missing}"
: "${BRIDGE_API_KEY:?BRIDGE_API_KEY missing}"

MT5_DIR="$HOME/.wine/drive_c/Program Files/MetaTrader 5"
TERMINAL_EXE="$MT5_DIR/terminal64.exe"

if [ ! -f "$TERMINAL_EXE" ]; then
  echo "[entrypoint] installing MT5 terminal (MetaQuotes generic)..."
  wget -q https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe -O /tmp/mt5setup.exe
  wine /tmp/mt5setup.exe /auto || true
  rm -f /tmp/mt5setup.exe
fi

if [ ! -f "$TERMINAL_EXE" ]; then
  echo "[entrypoint] FATAL: terminal64.exe not found after install"
  exit 1
fi

# Seed login (terminal reads common.ini on start).
# Password stays in the container filesystem, never in the image.
mkdir -p "$MT5_DIR/config"
printf '[Login]\nLogin=%s\nPassword=%s\nServer=%s\n' "$MT5_LOGIN" "$MT5_PASSWORD" "$MT5_SERVER" \
  > "$MT5_DIR/config/accounts.ini"

# Allow-list backend URL for EA WebRequest (written at runtime).
echo "[entrypoint] backend=$BACKEND_URL account=$MT5_LOGIN"

# EA Bridge.ex5 must be placed at MQL5/Experts/Bridge.ex5 (compiled separately).
# Xvfb provides the virtual display Wine needs.
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x800x24 &
sleep 2

echo "[entrypoint] starting terminal..."
exec wine "$TERMINAL_EXE" /portable
