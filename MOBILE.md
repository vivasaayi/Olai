# Mobile Testing - BookForge

BookForge now uses Expo for the first iPhone/iPad reader app. This matches the existing AruviStudio mobile workflow and avoids making Tauri Mobile the first shipping path.

## iPhone/iPad Reader

```bash
cd mobile
npm install
npm run ios
```

The reader currently supports:

- bundled sample book for immediate reading
- section-by-section navigation
- light, sepia, and night reading themes
- font size controls
- BookForge JSON import from the desktop authoring export
- arXiv/open-journal URL import
- in-app source/PDF viewing
- LLM assist panel for summaries, kid-friendly explanations, methods, critique, and custom questions
- offline local storage for imported books

## Research Paper Flow

1. Tap **Add**.
2. Choose **Paper**.
3. Paste an arXiv ID/URL or open-journal article URL.
4. Read the imported overview.
5. Use **Sources** to open the original page or PDF inside the app.
6. Tap **Assist** to ask for summaries, methods, limitations, or custom explanations.

The Assist panel accepts an OpenAI-compatible endpoint. For local servers such as LM Studio or an Ollama gateway, use a LAN URL from a physical iPhone, for example `http://192.168.1.15:1234/v1`.

## iOS Release

```bash
cd mobile
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform ios --profile production
```

Before App Store submission:

- Create the App Store Connect app for `com.bookforge.reader`.
- Replace `REPLACE_WITH_APP_STORE_CONNECT_APP_ID` in `mobile/eas.json`.
- Add iOS icon assets, screenshots, privacy answers, and listing metadata.
- Sign in to Expo locally and run the first interactive EAS build from the Mac.

## Android

The same Expo app can target Android after the iPhone reader flow is stable:

```bash
cd mobile
npm run android
```

## Tauri Mobile

Tauri Mobile remains an experimental option for later. The desktop app stays Tauri/Rust; the mobile reader ships through Expo/React Native first.
