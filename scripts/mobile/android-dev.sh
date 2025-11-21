#!/usr/bin/env bash
set -euo pipefail
# Android dev helper for BookForge
ROOT_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
WEB_DIR="$ROOT_DIR/web"
TAURI_DIR="$ROOT_DIR/src-tauri"

# Start dev server (if not running)
if ! lsof -i :5173 >/dev/null 2>&1; then
  echo "Starting vite dev server (host mode) in background..."
  (cd "$WEB_DIR" && npm run dev:host) &
  sleep 2
else
  echo "Dev server already running on :5173"
fi

# Ensure Android emulator is running (fallback to user prompt)
if ! adb devices | grep -v "List" | grep -q device; then
  echo "No Android devices/emulators detected. Please start an emulator or connect a device."
  echo "You can use Android Studio - AVD Manager to start a device, or run:"
  echo "    # list devices\nadb devices"
fi

# Init the Android scaffolding if it doesn't exist
if [[ ! -d "$TAURI_DIR/gen/android" ]]; then
  echo "Initializing Tauri Android scaffold..."
  (cd "$TAURI_DIR" && cargo tauri android init)
fi

# Run Android dev
cd "$TAURI_DIR"
cargo tauri android dev
