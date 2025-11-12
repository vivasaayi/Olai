# BookForge – AI-Guided Education App

## Current Implementation Status

**🚧 Work in Progress**: Basic Tauri desktop application with React frontend and Rust backend. Core AI features not yet implemented.

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust + Tauri 2.0
- **Platform**: Desktop (macOS, Windows, Linux) - Mobile support planned
- **Build Tool**: Cargo + npm

### What's Built
- ✅ Tauri application shell
- ✅ React UI framework setup
- ✅ Development environment
- ✅ macOS desktop build
- 🔄 Windows cross-compilation support
- ❌ AI/LLM integration
- ❌ Content management
- ❌ PDF export
- ❌ Mobile platforms

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
```

### Development
```bash
# Start development server with hot reload
cargo tauri dev

# Build for production
cargo tauri build
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
- **Mobile**: Not yet implemented - requires additional setup

### Desktop Status
- ✅ **macOS**: Fully working (Intel/Apple Silicon)
- 🔄 **Windows**: Cross-compilation supported from macOS
- 🔄 **Linux**: Cross-compilation supported

### Mobile Strategy (Planned)
- **iOS/iPadOS**: Tauri Mobile (experimental) or React Native
- **Android**: Tauri Mobile (experimental) or React Native
- Mobile apps will reuse React UI with native wrappers

### Development Commands
```bash
# Development
cargo tauri dev

# Build for current platform
cargo tauri build

# Build for specific targets
cargo tauri build --target x86_64-pc-windows-msvc  # Windows
cargo tauri build --target x86_64-unknown-linux-gnu  # Linux
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
└── src-tauri/               # Rust backend
    ├── src/
    │   └── main.rs          # Tauri application entry
    ├── Cargo.toml           # Rust dependencies
    ├── tauri.conf.json      # Tauri configuration
    └── icons/               # App icons
```

## 10. Roadmap

### ✅ Completed
1. **Tauri + React Setup**: Scaffold Tauri 2.0 app with React + TypeScript frontend
2. **Cross-platform Desktop**: macOS app working, Windows/Linux cross-compilation ready

### 🔄 In Progress
3. **AI Integration**: Add LLM gateway and local model support
4. **Content Management**: Implement project/chapter/section data models

### 📋 Planned
5. **Author Workspace**: Outline builder, glossary manager, prompt lab
6. **Learner View**: Adaptive reading panel, persona switching, export options
7. **PDF/HTML Export**: Generation and download functionality
8. **Quizzing Extension**: Auto-generated quizzes and analytics

### Next Steps
- Integrate Ollama for local LLM support
- Add SQLite/PostgreSQL for data persistence
- Implement basic content creation UI
- Add vector database for semantic search

This outline should give enough structure to start coding while leaving room to iterate on UX and LLM prompt strategies.
