# BookForge Reader Mobile

Expo iPhone/iPad reader for BookForge books.

## Development

```bash
cd mobile
npm install
npm run ios
```

The app starts with a bundled sample book and supports two import paths:

- arXiv IDs/URLs and open-journal URLs through **Add > Paper**
- JSON exported from the desktop authoring app through **Add > JSON**

Imported papers are stored offline as reader entries with abstract/metadata, source links, and PDF links where available.

## Research Reading

Use **Add > Paper** with examples like:

```text
1706.03762
https://arxiv.org/abs/1706.03762
https://arxiv.org/pdf/1706.03762
```

For arXiv, the app fetches metadata from the arXiv API, builds a readable paper overview, and attaches the source/PDF for in-app viewing.

For other open journals, the app reads common citation metadata from the page and attaches the original source. Sites that do not expose article text still open inside the app through the source viewer.

## LLM Assist

Tap **Assist** while reading a section. The panel can:

- summarize the current section
- explain it for kids
- extract method/assumptions/evidence/results
- critique limitations
- answer a custom question

Leave the endpoint blank to generate a ready-to-send prompt. Set an OpenAI-compatible endpoint to call a local or remote LLM directly, for example:

```text
http://192.168.1.15:1234/v1
```

For a physical iPhone, use your Mac/server LAN IP instead of `localhost`.

## iOS Release

This follows the same shape as the AruviStudio Expo app:

```bash
cd mobile
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform ios --profile production
```

Before App Store submission:

- Create an App Store Connect record for `com.bookforge.reader`.
- Replace `REPLACE_WITH_APP_STORE_CONNECT_APP_ID` in `eas.json`.
- Add icons, screenshots, privacy answers, and listing metadata.
