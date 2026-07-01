# Portable Book Package

Book Reader should export a generic, versioned book package. TamilSteam, an iPhone/iPad reader, or another publisher-owned website should all be consumers of the same package format.

TamilSteam should be the public publishing platform. Book Reader should remain a private translation and preparation tool. The connection between them should be an explicit export/import contract, not shared UI state or a merged application.

## System Boundary

Book Reader owns:

- PDF import and page snapshot generation.
- Source transcription and translation workflows.
- Translation variants by language and reading level.
- Glossary and translation-memory review.
- Local draft storage.
- Export of reviewed, publishable book packages.

Publisher platforms such as TamilSteam own:

- Public URLs, SEO, language routing, and static rendering.
- Public reader UI.
- Books, blog posts, people, categories, missions, and future content types.
- Admin import/review/publish workflows.
- Asset hosting for covers, page scans, PDFs, and generated pages.

Consumers should not depend on Tauri, IndexedDB, PDF.js internals, or the local LLM workflow. They should receive reviewed content in the package.

## First Contract: `.bookpkg`

The package is a ZIP-compatible archive with a domain-specific `.bookpkg` extension. It is written without compression so web servers, mobile apps, and backend importers can inspect it with standard ZIP tooling.

Initial layout:

```text
my-book-tamil.bookpkg
  manifest.json
  content/
    book.json
    pages.json
    glossary.json
    translations.en.json
    translations.ta.json
  assets/
    pages/
      page-0001-snapshot-id.png
      page-0002-snapshot-id.png
  source/
    original.pdf
```

`manifest.json` carries package identity, schema compatibility, publisher revision metadata, content hash, and a per-file hash manifest.

```ts
type PortableBookPackage = {
  schemaVersion: '1.0.0'
  packageType: 'portable-translation-book'
  packageId: string
  bookId: string
  version: string
  revision: number
  defaultLanguage: string
  contentHash?: string
  exportedAt: string
  source: {
    app: 'book-reader'
    appBookId: string
  }
  files: PortablePackageFileManifest[]
  book: PortableBookMetadata
}

type PortablePackageFileManifest = {
  path: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

type PortableBookMetadata = {
  slug: string
  title: string
  subtitle?: string
  author?: string
  originalLanguage?: string
  dateLabel?: string
  description?: string
  tags: string[]
  status: 'draft' | 'reviewed' | 'published'
  pageCount: number
  languages: string[]
  assets: PortableBookAsset[]
}
```

`content/pages.json` stores page order and source references:

```ts
type PortableBookPage = {
  pageNumber: number
  sectionTitle?: string
  sourceLines: string[]
  snapshotAssetId?: string
}
```

`content/translations.{language}.json` stores translated page content for one language:

```ts
type PortablePageTranslationFile = {
  pageNumber: number
  translations: PortablePageTranslation[]
}[]

type PortablePageTranslation = {
  language: string
  complexity: 'original' | 'kid-friendly' | 'concept-guide' | 'simplified' | 'high-school' | 'college'
  title?: string
  paragraphs: string[]
  notes?: string[]
  glossary?: PortableGlossaryTerm[]
  model?: string
  sourceModel?: string
  createdAt: string
}
```

`content/glossary.json` stores approved book-level glossary terms:

```ts
type PortableGlossaryFile = PortableGlossaryTerm[]

type PortableGlossaryTerm = {
  sourceTerm: string
  translatedTerm: string
  explanation?: string
  englishTerm?: string
  targetTerm?: string
  transliteration?: string
  language?: string
  approved?: boolean
}
```

Assets are referenced from `content/book.json` and `content/pages.json`:

```ts
type PortableBookAsset = {
  id: string
  kind: 'cover' | 'page-snapshot' | 'pdf'
  pageNumber?: number
  fileName: string
  mimeType: string
  dataUrl?: string
  path?: string
  width?: number
  height?: number
  sizeBytes?: number
}
```

The package has two version layers:

- `schemaVersion` describes compatibility of the package format.
- `version` and `revision` describe the publisher's book content. Fixing a translation typo can increment `revision` without changing the schema.
- `contentHash` lets web and mobile readers decide whether the readable content changed.
- `files[].sha256` lets importers verify each extracted file.

## Export Modes

Book Reader supports two package scopes:

- **Language package**: exports the selected reader language. For non-English target languages, it also includes English `original` records so consumers have a source/faithful reference.
- **All-languages package**: exports every stored translation record across all languages and complexities.

Both modes include saved page snapshots under `assets/pages/`. Both modes include `source/original.pdf` when the imported PDF is still available locally.

The all-languages package is best for publisher backup, TamilSteam import, and preparing a multi-language library. Individual language packages are smaller and are better for mobile sync when a reader only wants one language.

## Mapping From Book Reader

Current Book Reader fields map cleanly:

- `OldBookRecord.id` -> `source.appBookId`
- `OldBookRecord.title` -> `book.title`
- `OldBookRecord.author` -> `book.author`
- `OldBookRecord.originalLanguage` -> `book.originalLanguage`
- `OldBookRecord.dateLabel` -> `book.dateLabel`
- `OldBookRecord.tags` -> `book.tags`
- `OldBookRecord.pages` -> `book.pageCount`
- `pageSnapshots[]` -> `assets/pages/*` plus `book.assets[]` with `kind: 'page-snapshot'`
- `translations[]` grouped by language -> `content/translations.{language}.json`
- `translationMemory[]` -> `content/glossary.json`

Book Reader should export only selected language and complexity variants by default. A full archival export can include every variant.

## TamilSteam Consumer Shape

TamilSteam should add first-class book tables rather than forcing books into the existing article model.

```sql
books (
  id,
  slug,
  title,
  subtitle,
  author,
  original_language,
  date_label,
  description,
  status,
  page_count,
  created_at,
  updated_at
)

book_tags (
  id,
  book_id,
  tag
)

book_assets (
  id,
  book_id,
  kind,
  page_number,
  file_name,
  mime_type,
  storage_path,
  width,
  height,
  size_bytes
)

book_pages (
  id,
  book_id,
  page_number,
  section_title,
  source_lines_json,
  snapshot_asset_id
)

book_page_translations (
  id,
  page_id,
  language,
  complexity,
  title,
  paragraphs_json,
  notes_json,
  model,
  source_model,
  created_at,
  updated_at
)

book_glossary_terms (
  id,
  book_id,
  page_id,
  language,
  source_term,
  translated_term,
  explanation,
  english_term,
  target_term,
  transliteration,
  approved
)
```

Use JSON columns for arrays if the deployment database supports them. If TamilSteam stays with a simpler database setup, store arrays as text JSON and normalize later.

## TamilSteam API Targets

Initial private/admin endpoints:

- `POST /api/books/import-package`
- `GET /api/books`
- `GET /api/books/{id}`
- `PUT /api/books/{id}`
- `POST /api/books/{id}/publish`

Initial public endpoints or generated pages:

- `/{language}/books/`
- `/{language}/books/{slug}/`
- `/{language}/books/{slug}/read/`
- `/{language}/books/{slug}/page/{pageNumber}/`

## iPhone/iPad Reader Targets

The mobile reader should consume the same portable package format:

- Fetch a library index from TamilSteam or another publisher host.
- Compare local `bookId`, `version`, `revision`, and `contentHash`.
- Download new or changed packages.
- Store packages locally for offline reading.
- Keep reading position, bookmarks, and notes separate from book content.

Useful sync metadata:

```ts
type ReaderProgress = {
  bookId: string
  packageId: string
  version: string
  revision: number
  language: string
  pageNumber: number
  updatedAt: string
}
```

## Reader Experience

The public reader should prioritize:

- Fast mobile reading.
- Tamil and Indian-language typography.
- Language switcher when multiple translations exist.
- Page/chapter navigation.
- Optional original scan alongside translation.
- Glossary terms near the relevant page.
- Shareable stable URLs per book and page.
- Static HTML output for SEO and cheap hosting.

The private translator can stay dense and operational. The public reader should be calm, focused, and much simpler.

## Phased Implementation

1. Add `PortableBookPackage` export in Book Reader.
2. Generate one JSON package for an existing translated book.
3. Add TamilSteam book models, repositories, and import endpoint.
4. Import one package into TamilSteam.
5. Render one public static book in one language.
6. Add a polished public reader UI.
7. Add admin review/publish controls.
8. Move assets out of embedded data URLs into filesystem or object storage.

## Open Decisions

- Whether publisher production data should be Postgres only, SQLite only for local dev, or both.
- Whether the first public reader should be static-generated only or API-backed React.
- Whether page snapshots should be public by default or only visible in a side-by-side mode.
- Whether public readers should support multiple translation complexities or publish only one reviewed reading version per language.
