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

If LM Studio only listens on `127.0.0.1:1234`, run the LLM router on the Mac:

```bash
npm run llm:router
```

That exposes `http://100.66.32.111:1235/v1` over Tailscale and forwards requests to LM Studio at `http://127.0.0.1:1234/v1`. The old command still works too:

```bash
npm run lmstudio:proxy
```

The router writes JSONL request traces to `mobile/logs/llm-router-traces.jsonl` and keeps recent traces in memory. Prompt body text is not logged unless you start it with `LLM_ROUTER_TRACE_BODY=1`.

Useful debug endpoints:

```text
http://100.66.32.111:1235/health
http://100.66.32.111:1235/routes
http://100.66.32.111:1235/registry
http://100.66.32.111:1235/v1/models
http://100.66.32.111:1235/debug/traces?limit=25
```

Built-in providers:

- `lmstudio`: local OpenAI-compatible LM Studio, default `http://127.0.0.1:1234/v1`
- `openai`: OpenAI, default `https://api.openai.com/v1`
- `deepseek`: DeepSeek, default `https://api.deepseek.com`
- `xai`: xAI Grok, default `https://api.x.ai/v1`
- `anthropic`: Claude through an Anthropic Messages adapter, default `https://api.anthropic.com/v1`

Provider API keys stay on the Mac:

```bash
OPENAI_API_KEY=... \
DEEPSEEK_API_KEY=... \
XAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
npm run llm:router
```

The router also reads API keys from:

```text
~/.aruvistudio/llm-config.json
```

Expected shape:

```json
{
  "api_keys": {
    "openai": "...",
    "deepseek": "...",
    "xai": "...",
    "anthropic": "..."
  }
}
```

Aliases are supported for `grok`/`xai` and `claude`/`anthropic`. After changing that file while the router is running:

```bash
curl -X POST http://100.66.32.111:1235/config/reload
```

Routing order:

- `x-llm-provider` request header
- `provider` field in the JSON request body
- model prefix, for example `anthropic:claude-sonnet-4-5`
- registered model id or alias
- provider model patterns like `gpt-*`, `o1*`, `deepseek-*`, `grok-*`, and `claude-*`
- default provider, currently `lmstudio`

Register a model alias:

```bash
curl -X POST http://100.66.32.111:1235/registry/models \
  -H "Content-Type: application/json" \
  -d '{"id":"paper-fast","provider":"deepseek","upstreamId":"deepseek-v4-flash","aliases":["fast-paper"]}'
```

Register another OpenAI-compatible provider:

```bash
curl -X POST http://100.66.32.111:1235/registry/providers \
  -H "Content-Type: application/json" \
  -d '{"id":"office","label":"Office LM Studio","adapter":"openai-compatible","baseUrl":"http://office-mac:1234/v1","models":["office/*"]}'
```

Registered providers and models are stored in `mobile/config/llm-router.local.json`, which is intentionally ignored by git. Use `mobile/config/llm-router.example.json` as the non-secret template.

The mobile Assist screen calls `http://100.66.32.111:1235/v1/models`, but only exposes these approved choices:

- `google/gemma-4-12b-qat` through local LM Studio
- `deepseek-v4-flash` through DeepSeek
- `gpt-5.4-nano` through OpenAI
- `gpt-5.4-mini` through OpenAI

The selected model is sent in each `/chat/completions` request. The router then forwards to the right upstream provider. The router also registers `deepseek-v4-pro` for non-mobile callers.

Assist responses are rendered as markdown in the app and are also stored locally with the paper as notebook notes. When the same section, mode, question, and model are selected again, the saved note is loaded from local storage instead of calling the LLM again. The Assist markdown source editor supports selecting generated text and asking quick follow-up actions such as Explain, Summarize, and Define. Saved notes also expose selectable note text with the same quick actions.

For paper passages, open **Sources > Paper Text**, select a block from the saved extracted text, then tap **Explain**, **Summarize**, or **Define**. The app sends that selected passage through the same Assist flow and stores the response as a local paper note.

The app does not send the full PDF to the LLM. It sends the current section plus up to 48,000 characters from the saved extracted paper text snapshot. If the router/upstream provider returns token usage, the Assist screen shows input, output, and total tokens, and the same usage metadata is stored with the saved note.

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
