#!/usr/bin/env bash
set -euo pipefail
# iOS dev helper for BookForge
# 1. Make sure `npm run dev:host` is running in web/ (or start it in background)
# 2. Init the Tauri iOS scaffold (if not already) and run the iOS dev target

ROOT_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
WEB_DIR="$ROOT_DIR/web"
TAURI_DIR="$ROOT_DIR/src-tauri"

# Check for Xcode
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode not found. Install Xcode from the App Store before running this script."
  exit 1
fi

# Start dev server (if it's not running) in the background
if ! lsof -i :5173 >/dev/null 2>&1; then
  echo "Starting vite dev server (host mode) in background..."
  (cd "$WEB_DIR" && npm run dev:host) &
  sleep 2
else
  echo "Dev server already running on :5173"
fi

# Init the iOS scaffolding if it doesn't exist
if [[ ! -d "$TAURI_DIR/gen/apple" ]]; then
  echo "Initializing Tauri iOS scaffold..."
  (cd "$TAURI_DIR" && cargo tauri ios init)
fi

# Open Simulator app (ensure there is a simulator)
open -a Simulator || true

if [[ ! -d "$TAURI_DIR/gen/apple" ]]; then
  echo "Initializing Tauri iOS scaffold..."
  (cd "$TAURI_DIR" && cargo tauri ios init) || true
fi

# Run iOS dev
# CocoaPods is required; try installing via Homebrew if not present
if ! command -v pod >/dev/null 2>&1; then
  echo "CocoaPods not found. Attempting 'brew install cocoapods' (may require Homebrew)."
  if command -v brew >/dev/null 2>&1; then
    brew install cocoapods || true
  else
    echo "Homebrew not found. Install CocoaPods via 'sudo gem install cocoapods' or install Homebrew first." >&2
  fi
fi

cd "$TAURI_DIR"
# cargo tauri ios dev will open Xcode if necessary and deploy to simulator; it is interactive.
cargo tauri ios dev
if [[ ! -d "$TAURI_DIR/gen/apple" ]]; then
  echo "iOS scaffold not found after initial attempt. This may be because CocoaPods is missing."
  if ! command -v pod >/dev/null 2>&1; then
    echo "Trying to install CocoaPods automatically using Homebrew. If you prefer, run 'sudo gem install cocoapods'."
    if command -v brew >/dev/null 2>&1; then
      brew install cocoapods || true
    else
      echo "Homebrew not found. Please run 'sudo gem install cocoapods' and re-run this script." >&2
      exit 1
    fi
  fi

  echo "Retrying to initialize the Tauri iOS scaffold..."
  (cd "$TAURI_DIR" && cargo tauri ios init) || true

  if [[ ! -d "$TAURI_DIR/gen/apple" ]]; then
    echo "Still couldn't find iOS scaffold at '$TAURI_DIR/gen/apple'. Run 'cargo tauri ios init' manually and paste the error here." >&2
    exit 1
  fi
fi

(
  set -x
  # ensure CocoaPods dependencies are installed in the generated workspace
  if [[ -d "$TAURI_DIR/gen/apple" ]]; then
    pushd "$TAURI_DIR/gen/apple" >/dev/null
    if [[ -f "Podfile" ]]; then
      pod install --repo-update || pod install || true
    fi
    popd >/dev/null
  fi
  cargo tauri ios dev
)
