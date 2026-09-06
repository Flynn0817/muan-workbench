#!/usr/bin/env bash
# =====================================================
#  muan-workbench  one-click launcher (macOS / Linux)
#  Usage:  chmod +x start-muan.sh && ./start-muan.sh
# =====================================================
cd "$(dirname "$0")/app" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Please install Node.js >=18 from https://nodejs.org then retry."
  exit 1
fi

echo "Starting muan-workbench server..."
echo "The console will print the real address (localhost:PORT). Press Ctrl+C to stop."
node server.js &
NODE_PID=$!
sleep 2

if command -v open >/dev/null 2>&1; then
  open "http://localhost:8765/"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:8765/"
fi

wait $NODE_PID
