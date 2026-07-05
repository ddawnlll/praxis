#!/usr/bin/env bash
set -Eeuo pipefail
# PRAXIS Desktop Mission Control
#   Starts the backend server, builds the renderer, launches Electron
#   Usage: ./scripts/praxis-desktop.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cleanup() { [ -n "${SERVER_PID-}" ] && kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "=== PRAXIS Mission Control ==="
echo ""

# 1) Start server in background
echo "[1/3] Starting server on http://127.0.0.1:3457 ..."
ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-http://localhost:3456}" \
ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-unused}" \
bun run "$ROOT/packages/server/launch.ts" &
SERVER_PID=$!
sleep 1

# 2) Build renderer
echo "[2/3] Building renderer..."
cd "$ROOT/packages/desktop" && bun run build 2>/dev/null

# 3) Launch Electron
echo "[3/3] Launching PRAXIS Mission Control..."
echo ""
# Use local electron from workspace (not required globally)
"$ROOT/packages/desktop/node_modules/.bin/electron" "$ROOT/packages/desktop"
