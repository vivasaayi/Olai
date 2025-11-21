# Mobile Testing — BookForge

This guide helps you test the BookForge UI inside mobile shells (iOS and Android) using Tauri Mobile. Tauri Mobile is experimental — expect longer build times.

Prerequisites
- Rust (installed with rustup)
- Node.js + npm
- Vite dev server starts from `web/` directory

Recommended quick scripts (run from `web/`):

```bash
# Start the front-end with network host so emulators can access the dev server
npm run dev:host
```

iOS — macOS host required
-------------------------
1. Install Xcode 15+ and the Command Line Tools:

```bash
xcode-select --install
```

2. Install CocoaPods:

```bash
sudo gem install cocoapods
```

3. Add iOS Rust target (one-time):

```bash
rustup target add aarch64-apple-ios
```

4. Create mobile iOS scaffolding (one-time):

```bash
cd src-tauri
cargo tauri ios init
```

5. Launch the iOS dev shell (ensure frontend is served via `npm run dev:host`):

```bash
# run this from web/ or the project root
npm run tauri:ios:dev
# or
cd .. && cargo tauri ios dev
```

Alternative helper script (macOS only):

```bash
# Run this script from project root. It will try to start Vite, init iOS scaffold and open the simulator.
scripts/mobile/ios-dev.sh
```

6. Open the generated Xcode workspace under `src-tauri/gen/apple` and choose a simulator or a connected device. Use Xcode to attach the debugger.

Quick Xcode steps (after `cargo tauri ios init` succeeds):

1. Open the workspace (not the `.xcodeproj`) in Xcode:

```bash
open src-tauri/gen/apple/*.xcworkspace
```

2. In Xcode: Select the desired **Simulator** (e.g., iPhone 15) and press Run (▶).

3. If you need to sign builds for a real device, set your `Development Team` in the `Signing & Capabilities` section or set `APPLE_DEVELOPMENT_TEAM` env var before building.

Notes & Troubleshooting (iOS)
- For a physical device, you need Apple Developer credentials and proper signing.
- If the WebView can't see the dev server, ensure `vite` is started with `--host` and that your firewall allows the connection.
	- If `cargo tauri ios init` fails during `pod install` it may be because CocoaPods is missing. Try:

```bash
brew install cocoapods
# or (if you prefer Ruby gems):
sudo gem install cocoapods
```
	- Add your Apple development team to the Tauri config by setting `bundle.ios.developmentTeam` in `src-tauri/tauri.conf.json` or by setting the environment variable `APPLE_DEVELOPMENT_TEAM`.

Android
-------
1. Install Android Studio and the SDK (API 33+ recommended). Install NDK (for some Rust crates) too.
2. Set environment variables:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
```

3. Add Rust targets (one-time):

```bash
rustup target add aarch64-linux-android x86_64-linux-android
```

4. Create Android scaffolding (one-time):

```bash
cd src-tauri
cargo tauri android init
```

5. Launch your emulator or connect device with USB debugging; ensure `npm run dev:host` is running and the device can access your machine.

6. Start the Android shell from web/:

```bash
npm run tauri:android:dev
# or
cd .. && cargo tauri android dev
```

Notes & Troubleshooting (Android)
- The Android emulator can connect to host `10.0.2.2` or your machine's network IP address. Make sure Vite uses `--host`.
- If Gradle fails due to missing NDK or SDK, open Android Studio → SDK Tools and install the required items.

Next steps
- If the shell boots but the UI is missing features, implement native Tauri plugin bridges to expose device features (camera, share sheet). If you need deeper mobile experience (camera, offline caching, native video pickers), consider React Native/Expo.
- For signing and Play Store / App Store distribution, you will need to generate keystores, configure `build.gradle`/Xcode signing, and set secrets in your CI.

This should let you test the BookForge UI on mobile quickly. If you’d like, I can scaffold a small Tauri Mobile plugin for local image generation and upload or add an example to trigger LLM-based image generation from the mobile UI.