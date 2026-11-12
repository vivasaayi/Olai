# Olai web workspace

Authoring and translation now run in a browser, served by a Rust/Axum API. SQLite stores books, translation variants, PDFs, page snapshots, and generated exports in one persistent database. The existing React frontend is reused. The original desktop and mobile sources remain in this repository.

## Development on the Mac

Install Docker Desktop and Node.js. A host Rust installation is optional because the container builds the server.

```sh
git switch -c your-feature
bash scripts/env worktree up
python3 scripts/endpoint
```

Open the printed URL. Each checkout/worktree has an independent Compose project, dynamic loopback port, and library volume. The initial library includes a disposable authoring sample.

```sh
npm ci
npm --prefix web ci
npx playwright install chromium
bash scripts/test unit
bash scripts/test integration
bash scripts/test ui
bash scripts/test isolation
```

The isolation check starts two disposable Git worktrees and verifies separate authoring books, translations, PDF assets, ports, and volumes. It also exercises the staging Compose configuration in an ephemeral rehearsal project, checking image identity and data persistence across replacement. Actual staging deployment follows review and merge.

For frontend hot reload, keep the worktree API running and set `OLAI_API_URL` to its printed URL when running `npm --prefix web run dev`. For a native Rust development server, run `cargo run --manifest-path server/Cargo.toml` after building `web/`. Override `OLAI_DATA_DIR`, `OLAI_BIND`, and `OLAI_WEB_DIR` as needed.

The server forwards model listing and generation to `OLAI_LLM_URL`, defaulting to `http://host.docker.internal:1235/v1` in Docker. Configure the existing LLM router on the Mac with the desired local or remote provider. API keys stay in that router. An unavailable provider produces an explicit error.

## Existing desktop data

Use the Rust importer with a copy of the desktop `bookforge` directory. It reads authoring JSON, translation SQLite records, source PDFs, and page snapshots. Imports run transactionally and skip already imported books on retry.

```sh
OLAI_DATA_DIR=./data cargo run --manifest-path server/Cargo.toml -- import-desktop /path/to/bookforge
```

For a container deployment, run the same image with its library volume and mount the copied desktop directory read-only at `/legacy`, passing `import-desktop /legacy`. The importer requires referenced PDF and snapshot files to be present. The Translation Lab also has an **Import Browser Drafts** action for IndexedDB drafts saved at the same browser origin.

## Review and promotion

Development is performed on a feature branch. The actual default branch is `main`. After review and merge, build from its clean checkout and deploy staging on the Mac.

```sh
bash scripts/build staging
bash scripts/deploy staging
bash scripts/test staging
```

Staging reserves `127.0.0.1:20480`. Production reserves port `30480` on the remote host and consumes an explicit tested image through `bash scripts/deploy production --image <tested-image>`. Transfer the tested platform-compatible image using a registry or Docker save/load. Environment configuration lives outside the checkout under `~/.local/share/work-environments/`.

This first web version is a private authoring workspace with loopback bindings. Team identities, permissions, public catalog publishing, and reader synchronization are subsequent product work. Bulk translation retains its page-by-page checkpoint/resume workflow and needs the workspace open while processing. Reloading allows it to resume saved work. Revision checks reject conflicting saves.

The shared environment contract is at `~/work/.org/environments.md`. Stop a worktree with `bash scripts/env worktree stop`, or remove its disposable data with `bash scripts/env worktree destroy` after merge or abandonment.

---

## Original desktop product documentation

# BookForge – AI-Guided Education App

## Current Implementation Status

**🚧 Work in Progress**: Tauri desktop authoring shell plus an Expo iPhone/iPad reader. Core AI features are still planned.

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Mobile**: Expo SDK 53 + React Native for iPhone/iPad reading
- **Backend**: Rust + Tauri 2.0
- **Platform**: Desktop (macOS, Windows, Linux) + iOS/iPadOS reader
- **Build Tool**: Cargo + npm

### What's Built
- ✅ Tauri application shell
- ✅ React UI framework setup
- ✅ Development environment
- ✅ macOS desktop build
- ✅ Expo iPhone/iPad reader app
- ✅ Offline sample book and imported JSON storage on device
- ✅ arXiv/open-journal import with in-app source/PDF viewing
- ✅ LLM assist panel wired for OpenAI-compatible local or remote endpoints
- 🔄 Windows cross-compilation support
- ❌ AI/LLM integration
- 🔄 Content management
- ❌ PDF export
- 🔄 Android reader app

## Getting Started

### Prerequisites
- Rust (installed via rustup)
- Node.js 18+ and npm
- For macOS development: Xcode Command Line Tools

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd book-reader

# Install frontend dependencies
cd web
npm install
cd ..

# Build and run in development mode
cargo tauri dev

# Run the iPhone/iPad reader
cd mobile
npm install
npm run ios
```

### Development
```bash
# Start development server with hot reload
cargo tauri dev

# Build for production
cargo tauri build

# Start the Expo reader
cd mobile
npm run ios
```

## 1. Product Vision
- Help authors turn loose outlines and vocab lists into polished learning experiences.
- Keep humans in control of intent/structure while local LLMs expand sections on demand.
- Output should be consumable online (rich reader) and offline (PDF export).

## 2. Core Roles
| Role | Key Actions |
| --- | --- |
| Author | Define book shell (title, synopsis, outline, tone), seed keywords/vocab, review AI drafts, publish versions. |
| Learner | Browse catalog, choose learning mode (kids, formal, college, etc.), read generated chapters, download PDF. |

## 3. Content Lifecycle
1. **Ideation** – Author creates project, target audience, learning objectives.
2. **Outline** – Chapters/sections + bullet-level intents, vocab, keywords, reading level hints.
3. **Generation** – Local LLM expands each section using prompt templates + retrieval from author assets.
4. **Review** – Side-by-side diff, quick tweaks, mark “ready”.
5. **Publish & Export** – Store approved version, render to PDF/HTML.

## 4. Experience Outline
### Author Workspace
- Outline builder with drag/drop sections, attach metadata (tone, complexity, examples, visuals).
- Vocabulary & glossary manager with term definitions and usage notes.
- Prompt lab to preview generation per section before committing.
- Version timeline so authors can roll back.

### Learner View
- Adaptive reading panel (font, theme, language).
- Mode switcher (Kids, Beginner, Formal, College Grad) triggers on-the-fly regeneration via cached LLM outputs.
- Inline glossary popovers, quick quizzes generated from section content.
- Export options: PDF (printable layout), “Lite PDF” (text-heavy), maybe ePub later.

## 5. System Architecture
```
┌─────────────────┐        ┌─────────────────────┐
│  Tauri Desktop  │ <----> │  Rust Backend       │
│  (React UI)     │        │  (Tauri Commands)  │
└─────────────────┘        ├─────────────────────┤
                           │  Content Service    │
                           │  Generation Service │
                           │  Asset Service      │
                           │  Export Service     │
                           │  LLM Gateway        │
                           └─────────────────────┘
                                  │
                ┌─────────────────┴───────────────────────────┐
                │                                             │
         ┌─────────────┐                               ┌───────────────┐
         │ Vector DB   │                               │ Remote LLM(s) │
         └─────────────┘                               └───────────────┘
                │                                             ▲
         ┌─────────────┐                           ┌──────────┴──────────┐
         │ SQL/NoSQL DB│<──────────────────────────┤ Local LLM Runtime   │
         └─────────────┘                           └─────────────────────┘
```
```
┌──────────────┐        ┌─────────────────────┐
│  Web Client  │ <----> │  API + Orchestration│
└──────────────┘        ├─────────────────────┤
                        │  Content Service    │
                        │  Generation Service │
                        │  Asset Service      │
                        │  Export Service     │
                        │  LLM Gateway        │
                        └─────────────────────┘
                               │
             ┌─────────────────┴───────────────────────────┐
             │                                             │
      ┌─────────────┐                               ┌───────────────┐
      │ Vector DB   │                               │ Remote LLM(s) │
      └─────────────┘                               └───────────────┘
             │                                             ▲
      ┌─────────────┐                           ┌──────────┴──────────┐
      │ SQL/NoSQL DB│<──────────────────────────┤ Local LLM Runtime   │
      └─────────────┘                           └─────────────────────┘
```

### Current Stack (Implemented)
- **Frontend**: React 18 + TypeScript + Vite (bundled in Tauri)
- **Backend**: Rust + Tauri 2.0 (native desktop app with web UI)
- **Platform**: Tauri for cross-platform desktop (macOS, Windows, Linux)
- **LLM Layer**: Planned - Ollama/llama.cpp integration
- **Storage**: Planned - SQLite/PostgreSQL + vector database
- **PDF**: Planned - React-pdf or native Rust PDF generation

### Suggested Stack (Future Enhancements)
- **Frontend**: React/Next.js + Tailwind for the browser; Tauri + React/Vite shell for desktop/mobile wrappers if you need native packaging.
- **Backend**: NestJS (TypeScript) or FastAPI (Python) for modular services; Rust + Axum/Tonic works well too if you want a single-language story with the Tauri host. Rust gives strong performance for generation orchestration, and you can share crates (prompt templates, PDF assembly, LLM adapters) between the desktop shell and the server.
- **LLM Layer**: Local models via Ollama/llama.cpp (Mistral, Llama3, Phi), orchestrated with LangChain or LlamaIndex.
- **Storage**: PostgreSQL for structured book data, S3-compatible bucket for assets, Milvus/Weaviate for embeddings.
- **PDF**: React-pdf/Playwright pipeline or server-side PrinceXML if available.

## 6. Data Model Sketch
- `projects`: metadata, status, default tone, target level.
- `chapters` (FK project): order, title, description, constraints.
- `sections` (FK chapter): outline text, prompt overrides, generated variants.
- `assets`: keyword sets, vocab entries, reference docs.
- `generations`: raw AI output, settings, approval state.
- `exports`: format, download URL, version hash.

## 7. Generation Flow
1. Gather context: outline chunk + keywords + vocab definitions + sample passages.
2. Format prompt template that includes target persona (Kids/Formal/etc.).
3. Call local LLM via generation service; store raw text plus metadata (model, temperature).
4. Run quality passes (length, banned words, vocabulary coverage).
5. Present to author for edits; when accepted, flag as canonical for that audience profile.

### Retrieval-Augmented Tricks
- Embed glossary/keyword descriptions; pull top-k entries per section.
- Allow authors to upload reference PDFs → chunk + embed for retrieval.
- Cache generated outputs keyed by (section, persona, vocab version) to avoid regen storms.

## 8. Export Pipeline
1. Assemble approved sections into AST representing the book.
2. Apply persona-specific styling (kids: larger fonts, more spacing).
3. Render to HTML, then:
   - Client trigger: send HTML → headless Chromium (Playwright) → PDF.
   - Backend trigger: puppeteer/prince to produce final PDF stored in S3 bucket.
4. Include appendix for vocabulary + generated quizzes/glossary.

## 9. Local LLM Ops
- Run Ollama server with curated model set; allow hot-swapping without code changes.
- Maintain prompt templates + guardrails (length limits, RLHF policies).
- Track GPU/CPU utilization; queue jobs with priority for active editors.
- Provide a fallback path through the LLM gateway: if the local runtime is unavailable, proxy prompt requests to approved remote APIs (OpenAI, Anthropic, Azure) while preserving the same prompt contract. Cache which sections were generated remotely so authors can decide if they need a re-run locally later.

## 11. Cross-Platform Delivery

### Current Implementation
- **Desktop**: Tauri 2.0 provides native desktop apps for macOS, Windows, and Linux
- **iPhone/iPad**: Expo SDK 53 reader app under `mobile/`

### Desktop Status
- ✅ **macOS**: Fully working (Intel/Apple Silicon)
- 🔄 **Windows**: Cross-compilation supported from macOS
- 🔄 **Linux**: Cross-compilation supported

### Mobile Strategy
- **iOS/iPadOS**: Expo/React Native is the primary mobile path because it matches the existing AruviStudio release workflow.
- **Android**: Use the same Expo app once the iOS reader flow is stable.
- **Tauri Mobile**: Keep as an experimental option, but do not make it the first shipping path.

### Development Commands
```bash
# Development
cargo tauri dev

# Build for current platform
cargo tauri build

# Build for specific targets
cargo tauri build --target x86_64-pc-windows-msvc  # Windows
cargo tauri build --target x86_64-unknown-linux-gnu  # Linux

# iPhone/iPad reader
cd mobile
npm run ios
```

## Project Structure
```
book-reader/
├── README.md                 # This file
├── web/                      # React frontend
│   ├── src/
│   │   ├── App.tsx          # Main React component
│   │   ├── main.tsx         # React entry point
│   │   └── index.css        # Global styles
│   ├── package.json         # Frontend dependencies
│   ├── vite.config.ts       # Vite configuration
│   └── index.html           # HTML template
├── mobile/                   # Expo iPhone/iPad reader
│   ├── App.tsx              # Reader app entry point
│   ├── app.json             # Expo app configuration
│   ├── eas.json             # EAS build profiles
│   └── src/                 # Book types, sample content, local storage
└── src-tauri/               # Rust backend
    ├── src/
    │   └── main.rs          # Tauri application entry
    ├── Cargo.toml           # Rust dependencies
    ├── tauri.conf.json      # Tauri configuration
    └── icons/               # App icons
```

## Packaging Guides

> 💡 Use `.github/workflows/tauri-build.yml` to generate macOS, Windows, and Linux bundles automatically on GitHub Actions.

### macOS (local machine)
```bash
# Build universal bundle (Intel + Apple Silicon)
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cargo tauri build
# Bundles appear under src-tauri/target/release/bundle/macos
```

> ⚠️ macOS Gatekeeper flags unsigned DMGs as “damaged”. For local testing run:
> `xattr -cr /Applications/BookForge.app` (after copying) or ad-hoc sign via
> `codesign --force --deep --sign - /path/to/BookForge.app`. Production builds
> should be signed and notarized with an Apple Developer ID before distribution.

### Windows (via GitHub Actions or Windows host)
```powershell
# Run on Windows or inside the CI workflow
rustup target add x86_64-pc-windows-msvc
cargo tauri build
# Output: src-tauri/target/release/bundle/msi + exe
```
> The WebView2 runtime is required. Our CI installs it via `winget install --id
> Microsoft.EdgeWebView2Runtime --silent`. For manual installs download the
> evergreen installer from Microsoft.

### Linux (Ubuntu example)
```bash
# Install GTK/WebKit dependencies once per machine
sudo apt-get update && sudo apt-get install -y \
       build-essential pkg-config libssl-dev \
       libgtk-3-dev libayatana-appindicator3-dev \
       libwebkit2gtk-4.1-dev libwebkit2gtk-4.1-0 \
       librsvg2-dev libxdo-dev
cargo tauri build
# Output: src-tauri/target/release/bundle/appimage|deb
```

### iOS Reader (Expo, requires Xcode)
```bash
cd mobile
npm install
npm run ios

# EAS preview or production build
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform ios --profile production
```

### Android Reader (Expo)
```bash
cd mobile
npm install
npm run android
```

## 10. Roadmap

### ✅ Completed
1. **Tauri + React Setup**: Scaffold Tauri 2.0 app with React + TypeScript frontend
2. **Cross-platform Desktop**: macOS app working, Windows/Linux cross-compilation ready
3. **Expo iOS Reader**: iPhone/iPad reader with sample book, section navigation, themes, font sizing, BookForge JSON import, arXiv/open-journal import, in-app PDF/source viewing, and LLM assist

### 🔄 In Progress
4. **AI Integration**: Add LLM gateway and local model support
5. **Content Management**: Implement project/chapter/section data models

### 📋 Planned
6. **Author Workspace**: Outline builder, glossary manager, prompt lab
7. **Learner View**: Adaptive reading panel, persona switching, export options
8. **PDF/HTML Export**: Generation and download functionality
9. **Quizzing Extension**: Auto-generated quizzes and analytics

### Next Steps
- Integrate Ollama for local LLM support
- Add SQLite/PostgreSQL for data persistence
- Implement basic content creation UI
- Add direct mobile sync so iPhone can pull books without paste/import
- Add vector database for semantic search

This outline should give enough structure to start coding while leaving room to iterate on UX and LLM prompt strategies.
