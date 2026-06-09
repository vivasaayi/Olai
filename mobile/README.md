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

Imported papers are stored offline as reader entries with abstract/metadata, source links, a readable text/HTML snapshot, and a downloaded PDF when the source allows it.

## Research Reading

Use **Add > Paper** with examples like:

```text
1706.03762
https://arxiv.org/abs/1706.03762
https://arxiv.org/pdf/1706.03762
```

For arXiv, the app fetches metadata from the arXiv API, builds a readable paper overview, downloads the PDF, and tries to save a readable HTML/text snapshot from ar5iv. If the full HTML snapshot is unavailable, it still saves the abstract as the local text context.

For other open journals, the app reads common citation metadata from the page, saves a readable text/HTML snapshot from the fetched page, and downloads the PDF when the page exposes `citation_pdf_url`. Sites that do not expose article text still open inside the app through the source viewer.

## LLM Assist

Tap **Assist** while reading a section. The panel can:

- explain the whole paper
- explain a concept or topic in context
- augment the paper into detailed study notes
- summarize the current section
- explain it for kids
- extract method/assumptions/evidence/results
- critique limitations
- answer a custom question

Assist uses the saved paper text snapshot when available, so LM Studio sees more than the abstract. Tap **Save Note** after a response to store the generated explanation in the paper notebook.

Tap **Notes** to review saved paper explanations, concept explanations, questions, critiques, and references. Notes are saved inside the imported book JSON, so they stay attached to that paper.

The default endpoint is the Mac Tailscale address for LM Studio:

```text
http://100.66.32.111:1235/v1
```

The default model is:

```text
google/gemma-4-12b-qat
```

The Assist screen starts with these defaults, but both fields are editable. Changes are saved locally after you run Assist.

If LM Studio only listens on `127.0.0.1:1234`, run the proxy on the Mac:

```bash
npm run lmstudio:proxy
```

That exposes `http://100.66.32.111:1235/v1` over Tailscale and forwards requests to LM Studio at `http://127.0.0.1:1234/v1`.

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
