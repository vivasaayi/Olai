import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import './App.css'
import antiqueFolioUrl from './assets/mock-antique-folio.png'
import {
  complexityOptions,
  createPageSnapshotRecord,
  createQuestionRecord,
  createTranslationRecord,
  getDemoTranslationParagraphs,
  getOldBookFileDataUrl,
  getOldBookPdfBlob,
  importOldBookPdf,
  languageOptions,
  mergeOldBookRecords,
  readOldBooks,
  saveOldBookRecord,
  sourcePageLines,
  type OldBookRecord,
  type QuestionRecord,
  type SnapshotJobState,
  type PageSnapshotRecord,
  type TranslationComplexity,
  type TranslationGlossaryEntry,
  type TranslationJobState,
  type TranslationLanguage,
  type TranslationMemoryEntry,
} from './oldBooksStore'
import {
  listVisionModels,
  requestTextTranslation,
  requestTranslationMemoryReview,
  requestVisionAnswer,
  requestVisionTranslation,
  type LocalVisionModel,
  type VisionTranslationResult,
} from './localVision'
import { getPdfPageCount, renderPdfPageSnapshot, renderPdfPageSnapshotsParallelStream, type RenderedPdfSnapshot } from './pdfPageSnapshot'
import type { Book, NodePersona, OutlineNode, OutlineNodeType, Resource, ResourceType } from './types'

type LibraryEntry = {
  fileName: string
  book: Book
  chapterCount: number
  itemCount: number
}

type NodeLocation = {
  node: OutlineNode
  parentId: string | null
  depth: number
  path: string[]
}

type SuggestionItem = {
  id: string
  title: string
  summary: string
  children: SuggestionItem[]
}

type BookTab = {
  key: string
  label: string
  fileName: string | null
  audience: string
  chapterCount: number
  itemCount: number
  updatedAt?: string
  isCurrentDraft: boolean
}

type WorkspaceTab = 'books' | 'contents' | 'preview' | 'archive' | 'translation'
type BookSettingsMode = 'create' | 'edit'
type PreviewMode = 'reader' | 'outline' | 'json'
type DeleteConfirmState = {
  entry: LibraryEntry
  step: 1 | 2
  typedTitle: string
  busy: boolean
}

type SnapshotProgressState = {
  phase: 'preparing' | 'rendering' | 'saving' | 'persist' | 'complete'
  current: number
  total: number
  message: string
}

type JournalArchiveArticle = {
  id: string
  provider: 'royal-society' | 'open-web'
  publisherName: string
  journalName: string
  issueTitle: string
  issueUrl: string
  articleId: string
  title: string
  authors: string[]
  year?: string
  month?: string
  publishedAt?: string
  volume?: string
  issue?: string
  pages?: string
  sourceUrl: string
  pdfUrl?: string
  importedBookId?: string
}

type JournalArchiveIssue = {
  id: string
  provider: 'royal-society' | 'open-web'
  publisherName: string
  journalName: string
  issueTitle: string
  issueUrl: string
  year?: string
  month?: string
  volume?: string
  issue?: string
  importedAt: string
  articles: JournalArchiveArticle[]
}

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
  publisher?: PortablePublisherMetadata
  changelog?: string
  license?: string
  rightsStatus?: string
  sourceUrl?: string
  volume?: PortablePackageVolume
  source: {
    app: 'book-reader'
    appBookId: string
  }
  files?: PortablePackageFileManifest[]
  book: PortableBook
}

type PortablePublisherMetadata = {
  name?: string
}

type PortablePackageVolume = {
  index: number
  total: number
  pageStart: number
  pageEnd: number
}

type PortablePackageFileManifest = {
  path: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

type PortableBook = {
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
  pages: PortableBookPage[]
  glossary: PortableGlossaryTerm[]
  assets: PortableBookAsset[]
}

type PortableBookPage = {
  pageNumber: number
  sectionTitle?: string
  sourceLines: string[]
  snapshotAssetId?: string
  translations: PortablePageTranslation[]
}

type PortablePageTranslation = {
  language: string
  complexity: TranslationComplexity
  title?: string
  paragraphs: string[]
  notes?: string[]
  glossary?: PortableGlossaryTerm[]
  model?: string
  sourceModel?: string
  createdAt: string
}

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

type PortablePackageFile = {
  path: string
  bytes: Uint8Array
}

type EpubChapter = {
  id: string
  path: string
  title: string
  bodyHtml: string
}

type PortablePackageExportScope =
  | { kind: 'language', language: TranslationLanguage }
  | { kind: 'all', defaultLanguage: TranslationLanguage }

type PortablePackageMetadataDraft = {
  publisherName: string
  version: string
  revision: number
  changelog: string
  license: string
  rightsStatus: string
  sourceUrl: string
}

type PortablePackageAssetOptions = {
  includeSourcePdf: boolean
  includeSnapshots: boolean
  includeThumbnails: boolean
  imageFormat: 'png' | 'jpeg'
  imageMaxWidth: number
  jpegQuality: number
  pagesPerVolume: number
}

type PortablePackageInspectorState = {
  open: boolean
  fileName: string
  status: string
  manifest?: PortableBookPackage
  files: PortablePackageFileManifest[]
  validation: { path: string, status: 'ok' | 'missing' | 'mismatch', detail: string }[]
  pages: PortableBookPage[]
  translations: { language: string, pageCount: number, translationCount: number, sample?: PortablePageTranslation }[]
  error?: string
}

const resourceTypes: ResourceType[] = ['link', 'image', 'video', 'prompt', 'download', 'pdf']
const personas: NodePersona[] = ['default', 'kids', 'beginner', 'formal', 'college']
const llmRouterEndpoint = '/api/llm-router/v1'
const llmRouterModel = 'gpt-5.4-nano'
const llmRouterSourceModel = 'gpt-5.4-mini'
const legacyRouterEndpoint = 'http://localhost:1235'
const legacyRouterModel = 'gpt-5.4-nano'
const defaultRouterEndpoint = llmRouterEndpoint
const defaultRouterModel = llmRouterModel
const defaultSourceExtractionModel = llmRouterSourceModel

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2, 10)}`

function createResource(): Resource {
  return {
    id: createId(),
    type: 'link',
    label: 'Resource title',
    value: '',
    description: '',
  }
}

function createNode(type: OutlineNodeType, title?: string, children: OutlineNode[] = []): OutlineNode {
  return {
    id: createId(),
    type,
    title: title ?? (type === 'chapter' ? 'New Chapter' : 'New Section'),
    intent: '',
    summary: '',
    content: '',
    keywords: [],
    persona: 'default',
    durationMinutes: undefined,
    resources: [],
    children,
  }
}

function createInitialBook(): Book {
  const now = new Date().toISOString()
  const section = createNode('section', 'New Section')
  const chapter = createNode('chapter', 'New Chapter', [section])
  return {
    id: createId(),
    title: 'Untitled Book',
    synopsis: '',
    audience: '',
    tone: 'Neutral',
    tags: [],
    outline: [chapter],
    createdAt: now,
    updatedAt: now,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function asOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeResource(value: unknown, index: number): Resource {
  const raw = asRecord(value)
  const type = asString(raw.type, 'link') as ResourceType
  return {
    id: asString(raw.id) || `resource-${index + 1}`,
    type: resourceTypes.includes(type) ? type : 'link',
    label: asString(raw.label, 'Resource'),
    value: asString(raw.value),
    description: asString(raw.description),
  }
}

function normalizeOutlineNode(value: unknown, fallbackType: OutlineNodeType, index: number): OutlineNode {
  const raw = asRecord(value)
  const rawType = asString(raw.type, fallbackType) as OutlineNodeType
  const type: OutlineNodeType = rawType === 'chapter' || rawType === 'section' ? rawType : fallbackType
  const persona = asString(raw.persona, 'default') as NodePersona
  const children = Array.isArray(raw.children)
    ? raw.children.map((child, childIndex) => normalizeOutlineNode(child, 'section', childIndex))
    : []

  return {
    id: asString(raw.id) || `${type}-${index + 1}`,
    type,
    title: asString(raw.title, type === 'chapter' ? `Chapter ${index + 1}` : `Section ${index + 1}`),
    intent: asString(raw.intent) || asString(raw.goals),
    summary: asString(raw.summary) || asString(raw.synopsis),
    content: asString(raw.content),
    keywords: asStringArray(raw.keywords),
    persona: personas.includes(persona) ? persona : 'default',
    durationMinutes: asOptionalNumber(raw.durationMinutes),
    resources: Array.isArray(raw.resources)
      ? raw.resources.map((resource, resourceIndex) => normalizeResource(resource, resourceIndex))
      : [],
    children,
  }
}

function normalizeLegacyChapter(value: unknown, index: number): OutlineNode {
  const raw = asRecord(value)
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((section, sectionIndex) => normalizeOutlineNode(section, 'section', sectionIndex))
    : []

  return {
    ...normalizeOutlineNode(
      {
        ...raw,
        type: 'chapter',
        intent: asString(raw.goals),
        summary: asString(raw.synopsis),
        children: sections,
      },
      'chapter',
      index,
    ),
    children: sections,
  }
}

function normalizeBook(value: unknown): Book {
  const raw = asRecord(value)
  const title = asString(raw.title, 'Untitled Book').trim() || 'Untitled Book'
  const legacyChapters = Array.isArray(raw.chapters)
    ? raw.chapters.map((chapter, index) => normalizeLegacyChapter(chapter, index))
    : []
  const outline = Array.isArray(raw.outline)
    ? raw.outline.map((node, index) => normalizeOutlineNode(node, 'chapter', index))
    : legacyChapters

  return {
    id: asString(raw.id) || title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || createId(),
    title,
    synopsis: asString(raw.synopsis),
    audience: asString(raw.audience),
    tone: asString(raw.tone, 'Neutral'),
    tags: asStringArray(raw.tags),
    outline: outline.length ? outline : createInitialBook().outline,
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) || new Date().toISOString(),
  }
}

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
}

function findFirstNodeId(nodes: OutlineNode[]): string {
  return nodes[0]?.id ?? ''
}

function findNode(
  nodes: OutlineNode[],
  id: string,
  parentId: string | null = null,
  depth = 0,
  path: string[] = [],
): NodeLocation | null {
  for (const node of nodes) {
    const nextPath = [...path, node.title || 'Untitled']
    if (node.id === id) {
      return { node, parentId, depth, path: nextPath }
    }
    const childMatch = findNode(node.children, id, node.id, depth + 1, nextPath)
    if (childMatch) return childMatch
  }
  return null
}

function updateNode(nodes: OutlineNode[], id: string, updater: (node: OutlineNode) => OutlineNode): OutlineNode[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node)
    return { ...node, children: updateNode(node.children, id, updater) }
  })
}

function appendChildren(nodes: OutlineNode[], targetId: string | null, children: OutlineNode[]): OutlineNode[] {
  if (!targetId) return [...nodes, ...children]
  return updateNode(nodes, targetId, (node) => ({ ...node, children: [...node.children, ...children] }))
}

function removeNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: removeNode(node.children, id) }))
}

function formatDate(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function isTauriUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('reading \'invoke\'') || message.includes('__TAURI__') || message.includes('not a function')
}

function getSnapshotImageSrc(snapshot: PageSnapshotRecord | undefined) {
  if (!snapshot) return ''
  if (snapshot.imageDataUrl) return snapshot.imageDataUrl
  if (!snapshot.filePath) return ''
  try {
    return convertFileSrc(snapshot.filePath)
  } catch {
    return ''
  }
}

function routerCompletionsUrl(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const clientEndpoint = trimmed.replace('://0.0.0.0', '://localhost')
  if (clientEndpoint.endsWith('/chat/completions')) return clientEndpoint
  if (clientEndpoint.endsWith('/v1')) return `${clientEndpoint}/chat/completions`
  return `${clientEndpoint}/v1/chat/completions`
}

function extractJsonPayload(text: string): unknown {
  const withoutFence = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1))
    }
    throw new Error('The model did not return valid JSON suggestions.')
  }
}

function normalizeSuggestionItems(value: unknown): SuggestionItem[] {
  const raw = asRecord(value)
  const source = Array.isArray(value) ? value : Array.isArray(raw.items) ? raw.items : []
  return source
    .map((entry, index) => {
      const item = asRecord(entry)
      const title = asString(item.title).trim()
      if (!title) return null
      return {
        id: `suggestion-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        summary: asString(item.summary) || asString(item.description),
        children: normalizeSuggestionItems(item.children),
      } satisfies SuggestionItem
    })
    .filter((entry): entry is SuggestionItem => Boolean(entry))
}

function flattenSuggestionIds(items: SuggestionItem[]): string[] {
  return items.flatMap((item) => [item.id, ...flattenSuggestionIds(item.children)])
}

function suggestionToNode(item: SuggestionItem, type: OutlineNodeType, children: OutlineNode[]): OutlineNode {
  return {
    ...createNode(type, item.title, children),
    summary: item.summary,
    intent: item.summary,
  }
}

function materializeSuggestions(
  items: SuggestionItem[],
  selectedIds: Set<string>,
  rootType: OutlineNodeType,
): OutlineNode[] {
  return items.flatMap((item) => {
    const children = materializeSuggestions(item.children, selectedIds, 'section')
    if (selectedIds.has(item.id)) {
      return [suggestionToNode(item, rootType, children)]
    }
    return children
  })
}

function OutlineTree({
  nodes,
  activeId,
  onSelect,
  onAddChild,
  onSuggest,
  onRemove,
}: {
  nodes: OutlineNode[]
  activeId: string
  onSelect: (id: string) => void
  onAddChild: (id: string) => void
  onSuggest: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="outline-list">
      {nodes.map((node) => (
        <OutlineTreeNode
          key={node.id}
          node={node}
          depth={0}
          activeId={activeId}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onSuggest={onSuggest}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

function OutlineTreeNode({
  node,
  depth,
  activeId,
  onSelect,
  onAddChild,
  onSuggest,
  onRemove,
}: {
  node: OutlineNode
  depth: number
  activeId: string
  onSelect: (id: string) => void
  onAddChild: (id: string) => void
  onSuggest: (id: string) => void
  onRemove: (id: string) => void
}) {
  const childLabel = node.type === 'chapter' ? 'Section' : 'Subsection'
  const style = { '--depth': depth } as CSSProperties

  return (
    <div className="outline-node" style={style}>
      <div className={node.id === activeId ? 'outline-node-row active' : 'outline-node-row'}>
        <button className="outline-node-title" onClick={() => onSelect(node.id)} type="button">
          <span className="node-type">{node.type}</span>
          <span>{node.title || 'Untitled'}</span>
        </button>
        <div className="outline-node-actions">
          <button className="mini-button" onClick={() => onAddChild(node.id)} type="button">
            + {childLabel}
          </button>
          <button className="mini-button" onClick={() => onSuggest(node.id)} type="button">
            Suggest
          </button>
          <button className="icon-button" onClick={() => onRemove(node.id)} title="Remove item" type="button">
            x
          </button>
        </div>
      </div>
      {node.children.length ? (
        <div className="outline-children">
          {node.children.map((child) => (
            <OutlineTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onSuggest={onSuggest}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SuggestionChecklist({
  items,
  selectedIds,
  onToggle,
}: {
  items: SuggestionItem[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="suggestion-list">
      {items.map((item) => (
        <div key={item.id} className="suggestion-item">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span>
              <strong>{item.title}</strong>
              {item.summary ? <small>{item.summary}</small> : null}
            </span>
          </label>
          {item.children.length ? (
            <div className="suggestion-children">
              <SuggestionChecklist items={item.children} selectedIds={selectedIds} onToggle={onToggle} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PreviewOutline({ nodes, depth = 0 }: { nodes: OutlineNode[], depth?: number }) {
  return (
    <div className="preview-outline-list">
      {nodes.map((node) => (
        <div key={node.id} className="preview-outline-item" style={{ '--depth': depth } as CSSProperties}>
          <span className="node-type">{node.type}</span>
          <strong>{node.title || 'Untitled'}</strong>
          {node.summary ? <p>{node.summary}</p> : null}
          {node.children.length ? <PreviewOutline nodes={node.children} depth={depth + 1} /> : null}
        </div>
      ))}
    </div>
  )
}

function PreviewReaderNode({ node, index, depth = 0 }: { node: OutlineNode, index: number, depth?: number }) {
  const content = node.content.trim() || node.summary.trim() || node.intent.trim()
  const heading = node.type === 'chapter' ? `Chapter ${index + 1}` : 'Section'
  return (
    <article className={node.type === 'chapter' ? 'preview-reader-chapter' : 'preview-reader-section'}>
      <p className="preview-reader-kicker">{heading}</p>
      <h3>{node.title || 'Untitled'}</h3>
      {content ? <p>{content}</p> : <p className="muted">No draft content yet.</p>}
      {node.keywords.length ? (
        <div className="preview-chip-row">
          {node.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
        </div>
      ) : null}
      {node.children.length ? (
        <div className="preview-reader-children" style={{ '--depth': depth + 1 } as CSSProperties}>
          {node.children.map((child, childIndex) => (
            <PreviewReaderNode key={child.id} node={child} index={childIndex} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </article>
  )
}

function BookPreviewContent({
  book,
  previewMode,
  onPreviewModeChange,
}: {
  book: Book
  previewMode: PreviewMode
  onPreviewModeChange: (mode: PreviewMode) => void
}) {
  return (
    <>
      <div className="preview-mode-tabs" role="tablist" aria-label="Preview mode">
        <button
          className={previewMode === 'reader' ? 'preview-mode-tab active' : 'preview-mode-tab'}
          onClick={() => onPreviewModeChange('reader')}
          type="button"
        >
          Reader
        </button>
        <button
          className={previewMode === 'outline' ? 'preview-mode-tab active' : 'preview-mode-tab'}
          onClick={() => onPreviewModeChange('outline')}
          type="button"
        >
          Outline
        </button>
        <button
          className={previewMode === 'json' ? 'preview-mode-tab active' : 'preview-mode-tab'}
          onClick={() => onPreviewModeChange('json')}
          type="button"
        >
          JSON
        </button>
      </div>

      <div className="book-preview-body">
        {previewMode === 'reader' ? (
          <div className="preview-reader">
            <header className="preview-reader-cover">
              <p className="app-overline">{book.audience || 'Book preview'}</p>
              <h1>{book.title || 'Untitled Book'}</h1>
              {book.synopsis ? <p>{book.synopsis}</p> : null}
              <div className="preview-chip-row">
                <span>{book.tone || 'Neutral'}</span>
                {book.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </header>
            {book.outline.map((node, index) => (
              <PreviewReaderNode key={node.id} node={node} index={index} />
            ))}
          </div>
        ) : null}

        {previewMode === 'outline' ? (
          <div className="preview-outline">
            <PreviewOutline nodes={book.outline} />
          </div>
        ) : null}

        {previewMode === 'json' ? (
          <pre className="preview-json modal-json">{JSON.stringify(book, null, 2)}</pre>
        ) : null}
      </div>
    </>
  )
}

function formatFileSize(sizeBytes: number | undefined) {
  if (!sizeBytes) return ''
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function normalizedModelKey(value: string | undefined) {
  return value?.trim() ?? ''
}

function translationMatchesVariant(
  translation: OldBookRecord['translations'][number],
  model?: string,
  sourceModel?: string,
) {
  const expectedModel = normalizedModelKey(model)
  const expectedSourceModel = normalizedModelKey(sourceModel)
  if (expectedModel && normalizedModelKey(translation.model) !== expectedModel) return false
  if (expectedSourceModel && normalizedModelKey(translation.sourceModel) !== expectedSourceModel) return false
  return true
}

function translationVariantLabel(translation: OldBookRecord['translations'][number]) {
  const model = normalizedModelKey(translation.model) || 'Unknown model'
  const sourceModel = normalizedModelKey(translation.sourceModel)
  return sourceModel && sourceModel !== model ? `${sourceModel} -> ${model}` : model
}

function getStoredTranslation(
  book: OldBookRecord,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  sectionTitle: string,
  model?: string,
  sourceModel?: string,
) {
  const matchesVariant = (translation: OldBookRecord['translations'][number]) =>
    translationMatchesVariant(translation, model, sourceModel)
  const exactSection = book.translations.find((translation) =>
    translation.pageNumber === book.pageNumber
    && translation.sectionTitle === sectionTitle
    && translation.complexity === complexity
    && translation.language === language
    && matchesVariant(translation)
  )

  if (exactSection) return exactSection

  return book.translations.find((translation) =>
    translation.pageNumber === book.pageNumber
    && translation.complexity === complexity
    && translation.language === language
    && matchesVariant(translation)
  )
}

function getTranslatedPageCount(
  book: OldBookRecord | undefined,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  model?: string,
  sourceModel?: string,
) {
  if (!book?.pdfBlobId) return 0
  return new Set(
    book.translations
      .filter((translation) =>
        translation.complexity === complexity
        && translation.language === language
        && translationMatchesVariant(translation, model, sourceModel)
      )
      .map((translation) => translation.pageNumber),
  ).size
}

function parsePageSelection(selection: string, totalPages: number) {
  const normalizedSelection = selection.trim().toLowerCase()
  if (!normalizedSelection || normalizedSelection === 'all') {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages = new Set<number>()
  const tokens = normalizedSelection.split(/[\s,]+/).filter(Boolean)

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > totalPages) {
        throw new Error(`Invalid page range "${token}".`)
      }
      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        pages.add(pageNumber)
      }
      continue
    }

    const pageNumber = Number(token)
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
      throw new Error(`Invalid page "${token}".`)
    }
    pages.add(pageNumber)
  }

  return [...pages].sort((left, right) => left - right)
}

function isAllPagesSelection(selection: string) {
  const normalizedSelection = selection.trim().toLowerCase()
  return !normalizedSelection || normalizedSelection === 'all'
}

function getCanonicalOriginalTranslation(book: OldBookRecord | undefined, pageNumber = book?.pageNumber, model?: string) {
  if (!book || !pageNumber) return undefined
  return book.translations.find((translation) =>
    translation.pageNumber === pageNumber
    && translation.complexity === 'original'
    && translation.language === 'en'
    && translationMatchesVariant(translation, model)
  )
}

function getPreviousOriginalTranslation(book: OldBookRecord | undefined, model?: string) {
  if (!book || book.pageNumber <= 1) return undefined
  return getCanonicalOriginalTranslation(book, book.pageNumber - 1, model)
}

function getNextOriginalTranslation(book: OldBookRecord | undefined, model?: string) {
  if (!book) return undefined
  return getCanonicalOriginalTranslation(book, book.pageNumber + 1, model)
}

function getPreviousPageTranslation(
  book: OldBookRecord | undefined,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  model?: string,
  sourceModel?: string,
) {
  if (!book || book.pageNumber <= 1) return undefined
  return book.translations.find((translation) =>
    translation.pageNumber === book.pageNumber - 1
    && translation.complexity === complexity
    && translation.language === language
    && translationMatchesVariant(translation, model, sourceModel)
  )
}

function glossaryKey(sourceTerm: string, translatedTerm: string) {
  return `${sourceTerm.trim()}|${translatedTerm.trim()}`.toLowerCase()
}

function getApprovedTranslationMemory(book: OldBookRecord | undefined): TranslationGlossaryEntry[] {
  if (!book?.translationMemory?.length) return []
  return book.translationMemory
    .filter((entry) => entry.approved)
    .map((entry) => ({
      sourceTerm: entry.sourceTerm,
      translatedTerm: entry.translatedTerm,
      explanation: entry.explanation,
      englishTerm: entry.englishTerm,
      targetTerm: entry.targetTerm,
      transliteration: entry.transliteration,
    }))
}

function getPriorGlossary(book: OldBookRecord | undefined) {
  if (!book) return []

  const seen = new Set<string>()
  const glossary: TranslationGlossaryEntry[] = []

  for (const entry of getApprovedTranslationMemory(book)) {
    const key = glossaryKey(entry.sourceTerm, entry.translatedTerm)
    if (seen.has(key)) continue
    seen.add(key)
    glossary.push(entry)
  }

  const originals = book.translations
    .filter((translation) =>
      translation.complexity === 'original'
      && translation.language === 'en'
      && translation.pageNumber < book.pageNumber
      && translation.glossary?.length)
    .sort((left, right) => right.pageNumber - left.pageNumber)

  for (const translation of originals) {
    for (const entry of translation.glossary ?? []) {
      const key = glossaryKey(entry.sourceTerm, entry.translatedTerm)
      if (seen.has(key)) continue
      seen.add(key)
      glossary.push(entry)
      if (glossary.length >= 24) return glossary
    }
  }

  return glossary
}

function mergeTranslationMemorySuggestions(
  memory: TranslationMemoryEntry[] = [],
  glossary: TranslationGlossaryEntry[] = [],
) {
  const now = new Date().toISOString()
  const seen = new Set(memory.map((entry) => glossaryKey(entry.sourceTerm, entry.translatedTerm)))
  const additions = glossary
    .filter((entry) => entry.sourceTerm.trim() || entry.translatedTerm.trim())
    .filter((entry) => {
      const key = glossaryKey(entry.sourceTerm, entry.translatedTerm)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((entry): TranslationMemoryEntry => ({
      id: createId(),
      sourceTerm: entry.sourceTerm.trim(),
      translatedTerm: entry.translatedTerm.trim(),
      explanation: entry.explanation.trim(),
      englishTerm: entry.englishTerm?.trim() || undefined,
      targetTerm: entry.targetTerm?.trim() || undefined,
      transliteration: entry.transliteration?.trim() || undefined,
      approved: false,
      createdAt: now,
      updatedAt: now,
    }))

  return additions.length ? [...memory, ...additions] : memory
}

function mergeApprovedTranslationMemory(
  memory: TranslationMemoryEntry[] = [],
  glossary: TranslationGlossaryEntry[] = [],
) {
  const now = new Date().toISOString()
  const existingByKey = new Map(memory.map((entry) => [glossaryKey(entry.sourceTerm, entry.translatedTerm), entry]))
  const nextMemory = [...memory]

  for (const entry of glossary) {
    const sourceTerm = entry.sourceTerm.trim()
    const translatedTerm = entry.translatedTerm.trim()
    if (!sourceTerm && !translatedTerm) continue

    const key = glossaryKey(sourceTerm, translatedTerm)
    const existing = existingByKey.get(key)
    const reviewedEntry: TranslationMemoryEntry = existing
      ? {
        ...existing,
        sourceTerm,
        translatedTerm,
        explanation: entry.explanation.trim() || existing.explanation,
        englishTerm: entry.englishTerm?.trim() || existing.englishTerm,
        targetTerm: entry.targetTerm?.trim() || existing.targetTerm,
        transliteration: entry.transliteration?.trim() || existing.transliteration,
        approved: true,
        updatedAt: now,
      }
      : {
        id: createId(),
        sourceTerm,
        translatedTerm,
        explanation: entry.explanation.trim(),
        englishTerm: entry.englishTerm?.trim() || undefined,
        targetTerm: entry.targetTerm?.trim() || undefined,
        transliteration: entry.transliteration?.trim() || undefined,
        approved: true,
        createdAt: now,
        updatedAt: now,
      }

    if (existing) {
      const index = nextMemory.findIndex((memoryEntry) => memoryEntry.id === existing.id)
      if (index >= 0) nextMemory[index] = reviewedEntry
    } else {
      nextMemory.push(reviewedEntry)
    }
    existingByKey.set(key, reviewedEntry)
  }

  return nextMemory
}

function getTranslationMemoryRows(book: OldBookRecord | undefined): TranslationMemoryEntry[] {
  if (!book) return []
  return mergeTranslationMemorySuggestions(
    book.translationMemory,
    book.translations
      .filter((translation) => translation.complexity === 'original' && translation.language === 'en')
      .flatMap((translation) => translation.glossary ?? []),
  )
}

function replaceTranslationRecord(translations: OldBookRecord['translations'], translation: OldBookRecord['translations'][number]) {
  return [
    translation,
    ...translations.filter((entry) =>
      !(entry.pageNumber === translation.pageNumber
        && entry.complexity === translation.complexity
        && entry.language === translation.language)
        || normalizedModelKey(entry.model) !== normalizedModelKey(translation.model)
        || normalizedModelKey(entry.sourceModel) !== normalizedModelKey(translation.sourceModel)
    ),
  ]
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function decodeHtmlEntities(value: string) {
  const textarea = typeof document !== 'undefined' ? document.createElement('textarea') : null
  if (!textarea) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }
  textarea.innerHTML = value
  return textarea.value.replace(/\s+/g, ' ').trim()
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

function readHtmlTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return title ? stripHtml(title) : ''
}

function readHtmlMeta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i')
  const reversePattern = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, 'i')
  return decodeHtmlEntities(html.match(pattern)?.[1] ?? html.match(reversePattern)?.[1] ?? '')
}

function absoluteArchiveUrl(baseUrl: string, value: string) {
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return ''
  }
}

function stableArchiveId(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'archive'
}

function yearFromArchiveDate(value: string) {
  const year = value.match(/\b(16|17|18|19|20)\d{2}\b/)?.[0]
  if (year) return year
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : String(date.getUTCFullYear())
}

function monthFromArchiveDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : String(date.getUTCMonth() + 1).padStart(2, '0')
}

function royalSocietyJournalName(journalCode: string) {
  const journals: Record<string, string> = {
    rstl: 'Philosophical Transactions of the Royal Society of London',
    rsta: 'Philosophical Transactions of the Royal Society A',
    rstb: 'Philosophical Transactions of the Royal Society B',
    rspa: 'Proceedings of the Royal Society A',
    rspb: 'Proceedings of the Royal Society B',
    rsos: 'Royal Society Open Science',
    rsif: 'Journal of The Royal Society Interface',
    rsbl: 'Biology Letters',
  }
  return journals[journalCode] ?? 'Royal Society Publishing'
}

function parseRoyalSocietyIssuePath(url: string) {
  try {
    const parsed = new URL(url)
    const [, journalCode = '', issueMarker = '', volume = '', issue = ''] = parsed.pathname.split('/')
    return issueMarker === 'issue' ? { journalCode, volume, issue } : { journalCode, volume: '', issue: '' }
  } catch {
    return { journalCode: '', volume: '', issue: '' }
  }
}

function articleTitleNearHref(html: string, href: string) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const anchor = html.match(new RegExp(`<a\\s+[^>]*href=["']${escapedHref}["'][^>]*>([\\s\\S]*?)<\\/a>`, 'i'))?.[1]
  return anchor ? stripHtml(anchor) : ''
}

function parseRoyalSocietyIssueHtml(html: string, issueUrl: string): JournalArchiveIssue {
  const parsedUrl = new URL(issueUrl)
  const pathParts = parseRoyalSocietyIssuePath(issueUrl)
  const publishedAt = readHtmlMeta(html, 'citation_publication_date') || readHtmlMeta(html, 'dc.Date') || readHtmlTitle(html)
  const journalName = readHtmlMeta(html, 'citation_journal_title') || royalSocietyJournalName(pathParts.journalCode)
  const issueTitle = readHtmlTitle(html) || `${journalName} Volume ${pathParts.volume} Issue ${pathParts.issue}`
  const issueBase = {
    id: `royal-society-${stableArchiveId(parsedUrl.pathname)}`,
    provider: 'royal-society' as const,
    publisherName: 'Royal Society Publishing',
    journalName,
    issueTitle,
    issueUrl,
    year: yearFromArchiveDate(publishedAt),
    month: monthFromArchiveDate(publishedAt),
    volume: pathParts.volume || undefined,
    issue: pathParts.issue || undefined,
    importedAt: new Date().toISOString(),
  }
  const articlesByDoi = new Map<string, JournalArchiveArticle>()
  const hrefPattern = /href=["']([^"']*\/doi\/(?:abs\/|full\/|pdf\/)?(10\.[^"'?#\s<>]+))["']/gi
  let match: RegExpExecArray | null

  while ((match = hrefPattern.exec(html))) {
    const href = match[1]
    const doi = decodeURIComponent(match[2])
    if (!doi.startsWith('10.') || articlesByDoi.has(doi)) continue
    const sourceUrl = absoluteArchiveUrl(issueUrl, href.replace(/\/doi\/pdf\//, '/doi/abs/').replace(/\/doi\/full\//, '/doi/abs/'))
    if (!sourceUrl) continue
    const pdfUrl = absoluteArchiveUrl(issueUrl, href.includes('/doi/pdf/') ? href : href.replace(/\/doi\/(?:abs\/|full\/)?/, '/doi/pdf/'))
    const title = articleTitleNearHref(html, href) || `Royal Society article ${doi}`
    articlesByDoi.set(doi, {
      id: `royal-society-${stableArchiveId(doi)}`,
      provider: 'royal-society',
      publisherName: issueBase.publisherName,
      journalName: issueBase.journalName,
      issueTitle: issueBase.issueTitle,
      issueUrl,
      articleId: doi,
      title,
      authors: [],
      year: issueBase.year,
      month: issueBase.month,
      publishedAt: issueBase.year,
      volume: issueBase.volume,
      issue: issueBase.issue,
      sourceUrl,
      pdfUrl,
    })
  }

  return {
    ...issueBase,
    articles: Array.from(articlesByDoi.values()).sort((left, right) => left.title.localeCompare(right.title)),
  }
}

const archiveCatalogStorageKey = 'bookforge.journalArchiveIssues.v1'

function loadArchiveIssuesFromStorage(): JournalArchiveIssue[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(archiveCatalogStorageKey) || '[]')
    return Array.isArray(parsed) ? parsed as JournalArchiveIssue[] : []
  } catch {
    return []
  }
}

function saveArchiveIssuesToStorage(issues: JournalArchiveIssue[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(archiveCatalogStorageKey, JSON.stringify(issues, null, 2))
}

function slugifyFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'bookforge-export'
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
}

function downloadBlobFile(fileName: string, blob: Blob) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
}

async function sha256HexBytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

function dataUrlToBytes(dataUrl: string) {
  const [meta, payload] = dataUrl.split(',', 2)
  if (!payload) return new Uint8Array()
  if (meta.endsWith(';base64')) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  }
  return new TextEncoder().encode(decodeURIComponent(payload))
}

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

function parseJsonBytes<T>(bytes: Uint8Array): T {
  return JSON.parse(bytesToText(bytes)) as T
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image blob.'))
    reader.readAsDataURL(blob)
  })
}

async function transformImageDataUrl(
  dataUrl: string,
  options: { format: 'png' | 'jpeg', maxWidth: number, jpegQuality: number },
) {
  if (!dataUrl || (options.format === 'png' && !options.maxWidth)) return dataUrl

  const image = new Image()
  image.decoding = 'async'
  image.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Unable to load snapshot image.'))
  })

  const scale = options.maxWidth && image.naturalWidth > options.maxWidth
    ? options.maxWidth / image.naturalWidth
    : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return dataUrl
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, options.jpegQuality))
  return blob ? blobToDataUrl(blob) : dataUrl
}

function portablePackageLanguages(book: PortableBook) {
  return Array.from(new Set(book.pages.flatMap((page) => page.translations.map((translation) => translation.language)))).sort()
}

function sanitizePackagePathPart(value: string) {
  return slugifyFileName(value).replace(/\./g, '-') || 'asset'
}

function pageAssetPath(asset: PortableBookAsset) {
  const pageNumber = String(asset.pageNumber ?? 0).padStart(4, '0')
  const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/webp' ? 'webp' : 'png'
  return `assets/pages/page-${pageNumber}-${sanitizePackagePathPart(asset.id)}.${extension}`
}

function thumbnailAssetPath(asset: PortableBookAsset) {
  const pageNumber = String(asset.pageNumber ?? 0).padStart(4, '0')
  return `assets/thumbnails/page-${pageNumber}-${sanitizePackagePathPart(asset.id)}.jpg`
}

function concatBytes(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true)
}

function currentDosDateTime() {
  const now = new Date()
  const year = Math.max(1980, now.getFullYear())
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  return { time, date }
}

function createZipBlob(files: PortablePackageFile[], type = 'application/vnd.portable-translation-book+zip') {
  const encoder = new TextEncoder()
  const { time, date } = currentDosDateTime()
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let localOffset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.path)
    const fileCrc = crc32(file.bytes)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)

    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0x0800)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, time)
    writeUint16(localView, 12, date)
    writeUint32(localView, 14, fileCrc)
    writeUint32(localView, 18, file.bytes.length)
    writeUint32(localView, 22, file.bytes.length)
    writeUint16(localView, 26, nameBytes.length)
    writeUint16(localView, 28, 0)
    localHeader.set(nameBytes, 30)
    localChunks.push(localHeader, file.bytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0x0800)
    writeUint16(centralView, 10, 0)
    writeUint16(centralView, 12, time)
    writeUint16(centralView, 14, date)
    writeUint32(centralView, 16, fileCrc)
    writeUint32(centralView, 20, file.bytes.length)
    writeUint32(centralView, 24, file.bytes.length)
    writeUint16(centralView, 28, nameBytes.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, localOffset)
    centralHeader.set(nameBytes, 46)
    centralChunks.push(centralHeader)

    localOffset += localHeader.length + file.bytes.length
  }

  const centralDirectory = concatBytes(centralChunks)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, files.length)
  writeUint16(endView, 10, files.length)
  writeUint32(endView, 12, centralDirectory.length)
  writeUint32(endView, 16, localOffset)
  writeUint16(endView, 20, 0)

  return new Blob([concatBytes([...localChunks, centralDirectory, endRecord])], { type })
}

function readUint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function parseZipPackage(bytes: Uint8Array) {
  const decoder = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  let offset = 0

  while (offset + 30 <= bytes.length) {
    const signature = readUint32(bytes, offset)
    if (signature === 0x02014b50 || signature === 0x06054b50) break
    if (signature !== 0x04034b50) throw new Error('Unsupported package: local ZIP header not found.')

    const flags = readUint16(bytes, offset + 6)
    const compression = readUint16(bytes, offset + 8)
    const compressedSize = readUint32(bytes, offset + 18)
    const fileNameLength = readUint16(bytes, offset + 26)
    const extraLength = readUint16(bytes, offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + fileNameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) throw new Error('Unsupported package: truncated ZIP entry.')
    if (flags & 0x0008) throw new Error('Unsupported package: streaming ZIP entries are not supported yet.')
    if (compression !== 0) throw new Error('Unsupported package: compressed ZIP entries are not supported yet.')

    const path = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength))
    files.set(path, bytes.slice(dataStart, dataEnd))
    offset = dataEnd
  }

  return files
}

function packageVolumeRanges(pageNumbers: number[], pagesPerVolume: number) {
  if (!pagesPerVolume || pagesPerVolume <= 0 || pageNumbers.length <= pagesPerVolume) {
    return [{ index: 1, total: 1, pages: pageNumbers }]
  }

  const ranges: { index: number, total: number, pages: number[] }[] = []
  for (let index = 0; index < pageNumbers.length; index += pagesPerVolume) {
    ranges.push({ index: ranges.length + 1, total: 0, pages: pageNumbers.slice(index, index + pagesPerVolume) })
  }
  return ranges.map((range) => ({ ...range, total: ranges.length }))
}

function toPortableGlossaryTerm(
  entry: TranslationGlossaryEntry | TranslationMemoryEntry,
  language?: string,
): PortableGlossaryTerm {
  return {
    sourceTerm: entry.sourceTerm,
    translatedTerm: entry.translatedTerm,
    explanation: entry.explanation || undefined,
    englishTerm: entry.englishTerm || undefined,
    targetTerm: entry.targetTerm || undefined,
    transliteration: entry.transliteration || undefined,
    language,
    approved: 'approved' in entry ? entry.approved : undefined,
  }
}

function shouldPublishTranslation(
  translation: OldBookRecord['translations'][number],
  targetLanguage: TranslationLanguage,
) {
  if (targetLanguage === 'en') return translation.language === 'en'
  return translation.language === targetLanguage || (translation.language === 'en' && translation.complexity === 'original')
}

function buildPortableBookPackage(
  book: OldBookRecord,
  scope: PortablePackageExportScope,
  snapshotImages = new Map<number, string>(),
  metadata: PortablePackageMetadataDraft,
  assetOptions: PortablePackageAssetOptions,
  volume?: PortablePackageVolume,
): PortableBookPackage {
  const slug = slugifyFileName(book.title)
  const defaultLanguage = scope.kind === 'all' ? scope.defaultLanguage : scope.language
  const publishableTranslations = book.translations
    .filter((translation) =>
      scope.kind === 'all'
        ? true
        : shouldPublishTranslation(translation, scope.language),
    )
    .sort((left, right) =>
      left.pageNumber - right.pageNumber
      || left.language.localeCompare(right.language)
      || left.complexity.localeCompare(right.complexity)
      || translationVariantLabel(left).localeCompare(translationVariantLabel(right)),
    )
  const allPageNumbers = Array.from(new Set([
    ...publishableTranslations.map((translation) => translation.pageNumber),
    ...(assetOptions.includeSnapshots ? book.pageSnapshots.map((snapshot) => snapshot.pageNumber) : []),
  ])).sort((left, right) => left - right)
  const pageNumbers = volume
    ? allPageNumbers.filter((pageNumber) => pageNumber >= volume.pageStart && pageNumber <= volume.pageEnd)
    : allPageNumbers
  const snapshotAssets: PortableBookAsset[] = book.pageSnapshots
    .filter((snapshot) => assetOptions.includeSnapshots && pageNumbers.includes(snapshot.pageNumber))
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((snapshot) => ({
      id: snapshot.id,
      kind: 'page-snapshot',
      pageNumber: snapshot.pageNumber,
      fileName: `${slugifyFileName(book.title)}-page-${snapshot.pageNumber}.${assetOptions.imageFormat === 'jpeg' ? 'jpg' : 'png'}`,
      mimeType: assetOptions.imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
      dataUrl: snapshotImages.get(snapshot.pageNumber) || snapshot.imageDataUrl || undefined,
      path: snapshot.filePath,
      width: snapshot.width,
      height: snapshot.height,
    }))
  const snapshotAssetByPage = new Map(snapshotAssets.map((asset) => [asset.pageNumber, asset]))
  const translationsByPage = new Map<number, typeof publishableTranslations>()

  for (const translation of publishableTranslations) {
    translationsByPage.set(translation.pageNumber, [
      ...(translationsByPage.get(translation.pageNumber) ?? []),
      translation,
    ])
  }

  const pages: PortableBookPage[] = pageNumbers.map((pageNumber) => {
    const pageTranslations = translationsByPage.get(pageNumber) ?? []
    const original = pageTranslations.find((translation) => translation.language === 'en' && translation.complexity === 'original')
      ?? book.translations.find((translation) => translation.pageNumber === pageNumber && translation.language === 'en' && translation.complexity === 'original')
    const firstTranslation = pageTranslations[0]
    const snapshotAsset = snapshotAssetByPage.get(pageNumber)

    return {
      pageNumber,
      sectionTitle: firstTranslation?.sectionTitle || original?.sectionTitle || undefined,
      sourceLines: original?.sourceLines ?? firstTranslation?.sourceLines ?? [],
      snapshotAssetId: snapshotAsset?.id,
      translations: pageTranslations.map((translation) => ({
        language: translation.language,
        complexity: translation.complexity,
        title: translation.sectionTitle || undefined,
        paragraphs: translation.paragraphs,
        notes: translation.notes,
        glossary: translation.glossary?.map((entry) => toPortableGlossaryTerm(entry, translation.language)),
        model: translation.model,
        sourceModel: translation.sourceModel,
        createdAt: translation.createdAt,
      })),
    }
  })
  const languages = Array.from(new Set(publishableTranslations.map((translation) => translation.language))).sort()
  const approvedGlossary = book.translationMemory
    .filter((entry) => entry.approved)
    .map((entry) => toPortableGlossaryTerm(entry))

  return {
    schemaVersion: '1.0.0',
    packageType: 'portable-translation-book',
    packageId: scope.kind === 'all' ? `${slug}.all` : `${slug}.${scope.language}`,
    bookId: slug,
    version: metadata.version.trim() || '1.0.0',
    revision: Math.max(1, Math.floor(metadata.revision || 1)),
    defaultLanguage,
    exportedAt: new Date().toISOString(),
    publisher: metadata.publisherName.trim() ? { name: metadata.publisherName.trim() } : undefined,
    changelog: metadata.changelog.trim() || undefined,
    license: metadata.license.trim() || undefined,
    rightsStatus: metadata.rightsStatus.trim() || undefined,
    sourceUrl: metadata.sourceUrl.trim() || undefined,
    volume,
    source: {
      app: 'book-reader',
      appBookId: book.id,
    },
    book: {
      slug,
      title: book.title,
      author: book.author || undefined,
      originalLanguage: book.originalLanguage || undefined,
      dateLabel: book.dateLabel || undefined,
      description: book.section || undefined,
      tags: book.tags,
      status: 'reviewed',
      pageCount: book.pages || pageNumbers.length,
      languages,
      pages,
      glossary: approvedGlossary,
      assets: snapshotAssets,
    },
  }
}

function withoutUndefinedValues<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

async function buildPortablePackageFiles(
  packagePayload: PortableBookPackage,
  assetOptions: PortablePackageAssetOptions,
  sourcePdfBlob?: Blob | null,
) {
  const book = packagePayload.book
  const assetFiles: PortablePackageFile[] = []
  const archiveAssets: PortableBookAsset[] = []

  for (const asset of book.assets) {
    if (asset.kind === 'page-snapshot' && asset.dataUrl) {
      const path = pageAssetPath(asset)
      const transformedDataUrl = await transformImageDataUrl(asset.dataUrl, {
        format: assetOptions.imageFormat,
        maxWidth: assetOptions.imageMaxWidth,
        jpegQuality: assetOptions.jpegQuality,
      })
      const bytes = dataUrlToBytes(transformedDataUrl)
      assetFiles.push({ path, bytes })
      archiveAssets.push(withoutUndefinedValues({
        ...asset,
        path,
        dataUrl: undefined,
        sizeBytes: bytes.length,
      }))

      if (assetOptions.includeThumbnails) {
        const thumbnailDataUrl = await transformImageDataUrl(asset.dataUrl, {
          format: 'jpeg',
          maxWidth: 360,
          jpegQuality: 0.72,
        })
        const thumbnailBytes = dataUrlToBytes(thumbnailDataUrl)
        assetFiles.push({ path: thumbnailAssetPath(asset), bytes: thumbnailBytes })
      }
      continue
    }

    archiveAssets.push(withoutUndefinedValues({
      ...asset,
      dataUrl: undefined,
    }))
  }

  if (assetOptions.includeSourcePdf && sourcePdfBlob) {
    const pdfBytes = new Uint8Array(await sourcePdfBlob.arrayBuffer())
    const pdfPath = 'source/original.pdf'
    assetFiles.push({ path: pdfPath, bytes: pdfBytes })
    archiveAssets.push({
      id: 'source-pdf',
      kind: 'pdf',
      fileName: book.assets.find((asset) => asset.kind === 'pdf')?.fileName ?? `${book.slug}.pdf`,
      mimeType: sourcePdfBlob.type || 'application/pdf',
      path: pdfPath,
      sizeBytes: pdfBytes.length,
    })
  }

  const bookMetadata = {
    slug: book.slug,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author,
    originalLanguage: book.originalLanguage,
    dateLabel: book.dateLabel,
    description: book.description,
    tags: book.tags,
    status: book.status,
    pageCount: book.pageCount,
    languages: book.languages,
    assets: archiveAssets,
  }
  const pages = book.pages.map((page) => ({
    pageNumber: page.pageNumber,
    sectionTitle: page.sectionTitle,
    sourceLines: page.sourceLines,
    snapshotAssetId: page.snapshotAssetId,
  }))
  const translationFiles = book.languages.map((language) => ({
    path: `content/translations.${language}.json`,
    bytes: jsonBytes(book.pages
      .map((page) => ({
        pageNumber: page.pageNumber,
        translations: page.translations.filter((translation) => translation.language === language),
      }))
      .filter((page) => page.translations.length)),
  }))
  const contentFiles: PortablePackageFile[] = [
    { path: 'content/book.json', bytes: jsonBytes(bookMetadata) },
    { path: 'content/pages.json', bytes: jsonBytes(pages) },
    { path: 'content/glossary.json', bytes: jsonBytes(book.glossary) },
    ...translationFiles,
  ]
  const contentHashInput = concatBytes(contentFiles.flatMap((file) => [
    new TextEncoder().encode(`${file.path}\n`),
    file.bytes,
  ]))
  const contentHash = `sha256:${await sha256HexBytes(contentHashInput)}`
  const manifestBase = {
    schemaVersion: packagePayload.schemaVersion,
    packageType: packagePayload.packageType,
    packageId: packagePayload.packageId,
    bookId: packagePayload.bookId,
    version: packagePayload.version,
    revision: packagePayload.revision,
    defaultLanguage: packagePayload.defaultLanguage,
    contentHash,
    exportedAt: packagePayload.exportedAt,
    publisher: packagePayload.publisher,
    changelog: packagePayload.changelog,
    license: packagePayload.license,
    rightsStatus: packagePayload.rightsStatus,
    sourceUrl: packagePayload.sourceUrl,
    volume: packagePayload.volume,
    source: packagePayload.source,
    book: bookMetadata,
  }
  const filesForManifest = [...contentFiles, ...assetFiles]
  const fileManifest: PortablePackageFileManifest[] = await Promise.all(filesForManifest.map(async (file) => ({
    path: file.path,
    mimeType: file.path.endsWith('.json')
      ? 'application/json'
      : file.path.endsWith('.pdf')
        ? 'application/pdf'
        : 'image/png',
    sizeBytes: file.bytes.length,
    sha256: `sha256:${await sha256HexBytes(file.bytes)}`,
  })))
  const manifest = {
    ...manifestBase,
    files: fileManifest,
  }

  return [
    { path: 'manifest.json', bytes: jsonBytes(manifest) },
    ...contentFiles,
    ...assetFiles,
  ]
}

function getPageTranslation(
  book: OldBookRecord,
  pageNumber: number,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  model?: string,
  sourceModel?: string,
) {
  return book.translations.find((translation) =>
    translation.pageNumber === pageNumber
    && translation.complexity === complexity
    && translation.language === language
    && translationMatchesVariant(translation, model, sourceModel)
  )
}

function getPageTranslations(
  book: OldBookRecord,
  pageNumber: number,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
) {
  return book.translations
    .filter((translation) =>
      translation.pageNumber === pageNumber
      && translation.complexity === complexity
      && translation.language === language
    )
    .sort((left, right) => translationVariantLabel(left).localeCompare(translationVariantLabel(right)))
}

function getTranslationModelLabel(translation: OldBookRecord['translations'][number] | undefined) {
  if (!translation) return ''
  return translationVariantLabel(translation)
}

function renderExportParagraphs(paragraphs: string[] | undefined) {
  if (!paragraphs?.length) return '<p class="missing">Not exported yet.</p>'
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')
}

function markdownSourceLines(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/\s+(\d+)\.\s+/g, '\n$1. ').split('\n'))
}

function renderInlineMarkdownHtml(value: string) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function inlineMarkdownParts(value = '') {
  return value.split(/(\*\*.+?\*\*)/g).filter(Boolean).map((part) => {
    const strong = part.match(/^\*\*(.+)\*\*$/)
    return { text: strong?.[1] ?? part, strong: Boolean(strong) }
  })
}

function parseMarkdownTableLine(line: string) {
  if (!line.trim().startsWith('|') || !line.trim().endsWith('|')) return null
  return line.trim().slice(1, -1).split('|').map((cell) => cell.trim())
}

function isMarkdownTableSeparator(line: string) {
  const cells = parseMarkdownTableLine(line)
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
}

function renderMarkdownishHtml(markdown: string) {
  const lines = markdownSourceLines(markdown)
  const html: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let orderedItems: string[] = []
  let tableRows: string[][] = []
  let codeFence: { language: string, lines: string[] } | null = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderInlineMarkdownHtml(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!listItems.length) return
    html.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdownHtml(item)}</li>`).join('')}</ul>`)
    listItems = []
  }
  const flushOrderedList = () => {
    if (!orderedItems.length) return
    html.push(`<ol>${orderedItems.map((item) => `<li>${renderInlineMarkdownHtml(item)}</li>`).join('')}</ol>`)
    orderedItems = []
  }
  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows = []
      return
    }
    const [header, ...body] = tableRows
    html.push(`
      <table>
        <thead><tr>${header.map((cell) => `<th>${renderInlineMarkdownHtml(cell)}</th>`).join('')}</tr></thead>
        <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdownHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `)
    tableRows = []
  }

  for (const line of lines) {
    const fenceMatch = line.match(/^```(\w+)?\s*$/)
    if (fenceMatch) {
      if (codeFence) {
        const code = escapeHtml(codeFence.lines.join('\n'))
        html.push(codeFence.language === 'mermaid'
          ? `<pre class="mermaid">${code}</pre>`
          : `<pre><code>${code}</code></pre>`)
        codeFence = null
      } else {
        flushParagraph()
        flushList()
        flushOrderedList()
        flushTable()
        codeFence = { language: fenceMatch[1] ?? '', lines: [] }
      }
      continue
    }

    if (codeFence) {
      codeFence.lines.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      flushOrderedList()
      flushTable()
      continue
    }

    const tableCells = parseMarkdownTableLine(line)
    if (tableCells) {
      if (isMarkdownTableSeparator(line)) continue
      flushParagraph()
      flushList()
      flushOrderedList()
      tableRows.push(tableCells)
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      flushOrderedList()
      flushTable()
      const level = Math.min(4, heading[1].length + 2)
      html.push(`<h${level}>${renderInlineMarkdownHtml(heading[2])}</h${level}>`)
      continue
    }

    const listItem = line.match(/^[-*]\s+(.+)$/)
    if (listItem) {
      flushParagraph()
      flushOrderedList()
      flushTable()
      listItems.push(listItem[1])
      continue
    }

    const orderedItem = line.match(/^\d+\.\s+(.+)$/)
    if (orderedItem) {
      flushParagraph()
      flushList()
      flushTable()
      orderedItems.push(orderedItem[1])
      continue
    }

    paragraph.push(line.trim())
  }

  flushParagraph()
  flushList()
  flushOrderedList()
  flushTable()
  if (codeFence) {
    const code = escapeHtml(codeFence.lines.join('\n'))
    html.push(codeFence.language === 'mermaid'
      ? `<pre class="mermaid">${code}</pre>`
      : `<pre><code>${code}</code></pre>`)
  }

  return html.join('\n')
}

function renderExportContent(translation: OldBookRecord['translations'][number] | undefined) {
  if (!translation?.paragraphs.length) return '<p class="missing">Not exported yet.</p>'
  if (translation.complexity === 'concept-guide') {
    return renderMarkdownishHtml(translation.paragraphs.join('\n\n'))
  }
  return renderExportParagraphs(translation.paragraphs)
}

function renderExportModelMeta(translation: OldBookRecord['translations'][number] | undefined) {
  const model = getTranslationModelLabel(translation)
  if (!model) return ''
  return `<p class="model-meta">Model: ${escapeHtml(model)}</p>`
}

function renderExportSourceLines(sourceLines: string[] | undefined) {
  if (!sourceLines?.length) return '<p class="missing">No German extraction stored.</p>'
  return `<ol>${sourceLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n')}</ol>`
}

function renderExportVocabulary(glossary: TranslationGlossaryEntry[] | undefined) {
  if (!glossary?.length) return ''
  return `
    <section class="vocabulary">
      <h4>Vocabulary</h4>
      <dl>
        ${glossary.map((entry) => `
          <div>
            <dt>${escapeHtml(entry.sourceTerm)}${entry.translatedTerm ? ` <span>${escapeHtml(entry.translatedTerm)}</span>` : ''}</dt>
            ${entry.englishTerm || entry.targetTerm || entry.transliteration ? `
              <dd class="vocabulary-meta">
                ${entry.englishTerm ? `<strong>English:</strong> ${escapeHtml(entry.englishTerm)}` : ''}
                ${entry.targetTerm ? `${entry.englishTerm ? ' · ' : ''}<strong>Target:</strong> ${escapeHtml(entry.targetTerm)}` : ''}
                ${entry.transliteration ? `${entry.englishTerm || entry.targetTerm ? ' · ' : ''}<strong>Transliteration:</strong> ${escapeHtml(entry.transliteration)}` : ''}
              </dd>
            ` : ''}
            ${entry.explanation ? `<dd>${escapeHtml(entry.explanation)}</dd>` : ''}
          </div>
        `).join('\n')}
      </dl>
    </section>
  `
}

function renderPortableVocabulary(glossary: PortableGlossaryTerm[] | undefined) {
  if (!glossary?.length) return ''
  return `
    <section class="vocabulary">
      <h3>Glossary</h3>
      <dl>
        ${glossary.map((entry) => `
          <div>
            <dt>${escapeHtml(entry.sourceTerm)}${entry.translatedTerm ? ` <span>${escapeHtml(entry.translatedTerm)}</span>` : ''}</dt>
            ${entry.englishTerm || entry.targetTerm || entry.transliteration ? `
              <dd class="vocabulary-meta">
                ${entry.englishTerm ? `<strong>English:</strong> ${escapeHtml(entry.englishTerm)}` : ''}
                ${entry.targetTerm ? `${entry.englishTerm ? ' · ' : ''}<strong>Target:</strong> ${escapeHtml(entry.targetTerm)}` : ''}
                ${entry.transliteration ? `${entry.englishTerm || entry.targetTerm ? ' · ' : ''}<strong>Transliteration:</strong> ${escapeHtml(entry.transliteration)}` : ''}
              </dd>
            ` : ''}
            ${entry.explanation ? `<dd>${escapeHtml(entry.explanation)}</dd>` : ''}
          </div>
        `).join('\n')}
      </dl>
    </section>
  `
}

function getPreferredPortableTranslation(
  page: PortableBookPage,
  language: string,
  selectedComplexity: TranslationComplexity,
) {
  return page.translations.find((translation) =>
    translation.language === language && translation.complexity === selectedComplexity
  )
    ?? page.translations.find((translation) => translation.language === language && translation.complexity !== 'original')
    ?? page.translations.find((translation) => translation.language === language)
    ?? page.translations.find((translation) => translation.language === 'en' && translation.complexity === 'original')
    ?? page.translations[0]
}

function renderPortableTranslationContent(translation: PortablePageTranslation | undefined) {
  if (!translation?.paragraphs.length) return '<p class="missing">No exported translation for this page.</p>'
  if (translation.complexity === 'concept-guide') return renderMarkdownishHtml(translation.paragraphs.join('\n\n'))
  return renderExportParagraphs(translation.paragraphs)
}

function epubPath(value: string) {
  return `OEBPS/${value}`
}

function buildPortableEpubFiles(
  packagePayload: PortableBookPackage,
  language: string,
  languageLabel: string,
  selectedComplexity: TranslationComplexity,
) {
  const encoder = new TextEncoder()
  const book = packagePayload.book
  const pages = book.pages.slice().sort((left, right) => left.pageNumber - right.pageNumber)
  const chapters: EpubChapter[] = pages.map((page) => {
    const translation = getPreferredPortableTranslation(page, language, selectedComplexity)
    const title = translation?.title || page.sectionTitle || `Page ${page.pageNumber}`
    const bodyHtml = `
      <article class="book-page">
        <h1>${escapeHtml(title)}</h1>
        <p class="page-meta">Page ${page.pageNumber}${translation?.complexity ? ` · ${escapeHtml(translation.complexity)}` : ''}</p>
        ${renderPortableTranslationContent(translation)}
        ${renderPortableVocabulary(translation?.glossary)}
      </article>
    `
    return {
      id: `page-${page.pageNumber}`,
      path: `pages/page-${String(page.pageNumber).padStart(4, '0')}.xhtml`,
      title,
      bodyHtml,
    }
  })
  const title = `${book.title}${languageLabel ? ` - ${languageLabel}` : ''}`
  const author = book.author || 'Unknown author'
  const publisher = packagePayload.publisher?.name || 'Book Reader'
  const modified = new Date(packagePayload.exportedAt).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const stylesheet = `
body {
  color: #172033;
  font-family: serif;
  line-height: 1.65;
  margin: 0;
  padding: 0;
}
h1, h2, h3 {
  line-height: 1.25;
}
p, li, dd {
  font-size: 1em;
}
.page-meta, .missing, .vocabulary-meta {
  color: #667085;
}
.book-page {
  page-break-after: always;
}
.vocabulary {
  border-top: 1px solid #d8dee6;
  margin-top: 1.5em;
  padding-top: 1em;
}
dt {
  font-weight: bold;
}
dt span {
  color: #145d52;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th, td {
  border: 1px solid #d8dee6;
  padding: 0.35em;
}
pre {
  white-space: pre-wrap;
}
`
  const chapterFiles: PortablePackageFile[] = chapters.map((chapter) => ({
    path: epubPath(chapter.path),
    bytes: encoder.encode(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeHtml(language)}" lang="${escapeHtml(language)}">
<head>
  <title>${escapeHtml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body>
${chapter.bodyHtml}
</body>
</html>
`),
  }))

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeHtml(language)}" lang="${escapeHtml(language)}">
<head>
  <title>${escapeHtml(title)} Contents</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${chapters.map((chapter) => `<li><a href="${escapeHtml(chapter.path)}">${escapeHtml(chapter.title)}</a></li>`).join('\n')}
    </ol>
  </nav>
</body>
</html>
`
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeHtml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeHtml(`${packagePayload.packageId}.${language}.epub`)}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:language>${escapeHtml(language)}</dc:language>
    <dc:creator>${escapeHtml(author)}</dc:creator>
    <dc:publisher>${escapeHtml(publisher)}</dc:publisher>
    <dc:date>${escapeHtml(packagePayload.exportedAt.slice(0, 10))}</dc:date>
    ${packagePayload.license ? `<dc:rights>${escapeHtml(packagePayload.license)}</dc:rights>` : ''}
    <meta property="dcterms:modified">${escapeHtml(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="styles/book.css" media-type="text/css" />
    ${chapters.map((chapter) => `<item id="${escapeHtml(chapter.id)}" href="${escapeHtml(chapter.path)}" media-type="application/xhtml+xml" />`).join('\n')}
  </manifest>
  <spine>
    ${chapters.map((chapter) => `<itemref idref="${escapeHtml(chapter.id)}" />`).join('\n')}
  </spine>
</package>
`

  return [
    { path: 'mimetype', bytes: encoder.encode('application/epub+zip') },
    { path: 'META-INF/container.xml', bytes: encoder.encode(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`) },
    { path: epubPath('package.opf'), bytes: encoder.encode(opf) },
    { path: epubPath('nav.xhtml'), bytes: encoder.encode(nav) },
    { path: epubPath('styles/book.css'), bytes: encoder.encode(stylesheet) },
    ...chapterFiles,
  ]
}

function buildPortablePrintHtml(
  packagePayload: PortableBookPackage,
  language: string,
  languageLabel: string,
  selectedComplexity: TranslationComplexity,
) {
  const book = packagePayload.book
  const pages = book.pages.slice().sort((left, right) => left.pageNumber - right.pageNumber)
  const exportedAt = new Date(packagePayload.exportedAt).toLocaleString()
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(book.title)} - ${escapeHtml(languageLabel)} PDF Export</title>
  <style>
${exportReaderStyles}
    main { max-width: 760px; }
    .book-page { break-before: page; }
    .book-page:first-of-type { break-before: auto; }
    @page { margin: 0.72in; }
    @media print {
      body { background: #fff; }
      main { padding: 0; }
      .book-page { border-top: 0; margin-top: 0; padding-top: 0; }
    }
  </style>
</head>
<body>
  <main>
    <header class="book-header">
      <h1>${escapeHtml(book.title)}</h1>
      <p class="meta">${escapeHtml(book.author || 'Unknown author')} · ${escapeHtml(languageLabel)} · Exported ${escapeHtml(exportedAt)}</p>
      ${packagePayload.publisher?.name ? `<p class="meta">Publisher: ${escapeHtml(packagePayload.publisher.name)}</p>` : ''}
      ${packagePayload.license ? `<p class="meta">License: ${escapeHtml(packagePayload.license)}</p>` : ''}
    </header>
    ${pages.map((page) => {
      const translation = getPreferredPortableTranslation(page, language, selectedComplexity)
      return `
        <article class="book-page">
          <h2>${escapeHtml(translation?.title || page.sectionTitle || `Page ${page.pageNumber}`)}</h2>
          <p class="meta">Page ${page.pageNumber}${translation?.complexity ? ` · ${escapeHtml(translation.complexity)}` : ''}</p>
          ${renderPortableTranslationContent(translation)}
          ${renderPortableVocabulary(translation?.glossary)}
        </article>
      `
    }).join('\n')}
  </main>
  <script>
    window.addEventListener('load', () => {
      window.setTimeout(() => window.print(), 250)
    })
  </script>
</body>
</html>`
}

function MarkdownishContent({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => {
    const lines = markdownSourceLines(markdown)
    const parsedBlocks: { kind: 'heading' | 'paragraph' | 'list' | 'ordered-list' | 'table' | 'code' | 'mermaid', text?: string, level?: number, items?: string[], rows?: string[][] }[] = []
    let paragraph: string[] = []
    let listItems: string[] = []
    let orderedItems: string[] = []
    let tableRows: string[][] = []
    let codeFence: { language: string, lines: string[] } | null = null

    const flushParagraph = () => {
      if (!paragraph.length) return
      parsedBlocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
    const flushList = () => {
      if (!listItems.length) return
      parsedBlocks.push({ kind: 'list', items: listItems })
      listItems = []
    }
    const flushOrderedList = () => {
      if (!orderedItems.length) return
      parsedBlocks.push({ kind: 'ordered-list', items: orderedItems })
      orderedItems = []
    }
    const flushTable = () => {
      if (tableRows.length >= 2) {
        parsedBlocks.push({ kind: 'table', rows: tableRows })
      }
      tableRows = []
    }

    for (const line of lines) {
      const fenceMatch = line.match(/^```(\w+)?\s*$/)
      if (fenceMatch) {
        if (codeFence) {
          parsedBlocks.push({
            kind: codeFence.language === 'mermaid' ? 'mermaid' : 'code',
            text: codeFence.lines.join('\n'),
          })
          codeFence = null
        } else {
          flushParagraph()
          flushList()
          flushOrderedList()
          flushTable()
          codeFence = { language: fenceMatch[1] ?? '', lines: [] }
        }
        continue
      }

      if (codeFence) {
        codeFence.lines.push(line)
        continue
      }

      if (!line.trim()) {
        flushParagraph()
        flushList()
        flushOrderedList()
        flushTable()
        continue
      }

      const tableCells = parseMarkdownTableLine(line)
      if (tableCells) {
        if (isMarkdownTableSeparator(line)) continue
        flushParagraph()
        flushList()
        flushOrderedList()
        tableRows.push(tableCells)
        continue
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/)
      if (heading) {
        flushParagraph()
        flushList()
        flushOrderedList()
        flushTable()
        parsedBlocks.push({ kind: 'heading', level: Math.min(4, heading[1].length + 2), text: heading[2] })
        continue
      }

      const listItem = line.match(/^[-*]\s+(.+)$/)
      if (listItem) {
        flushParagraph()
        flushOrderedList()
        flushTable()
        listItems.push(listItem[1])
        continue
      }

      const orderedItem = line.match(/^\d+\.\s+(.+)$/)
      if (orderedItem) {
        flushParagraph()
        flushList()
        flushTable()
        orderedItems.push(orderedItem[1])
        continue
      }

      paragraph.push(line.trim())
    }

    flushParagraph()
    flushList()
    flushOrderedList()
    flushTable()
    if (codeFence) {
      parsedBlocks.push({
        kind: codeFence.language === 'mermaid' ? 'mermaid' : 'code',
        text: codeFence.lines.join('\n'),
      })
    }
    return parsedBlocks
  }, [markdown])

  const renderInline = (text = '') => inlineMarkdownParts(text).map((part, index) =>
    part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>,
  )

  return (
    <div className="markdownish-content">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const HeadingTag = `h${block.level ?? 3}` as keyof JSX.IntrinsicElements
          return <HeadingTag key={index}>{renderInline(block.text)}</HeadingTag>
        }
        if (block.kind === 'list') {
          return <ul key={index}>{block.items?.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>)}</ul>
        }
        if (block.kind === 'ordered-list') {
          return <ol key={index}>{block.items?.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>)}</ol>
        }
        if (block.kind === 'table') {
          const [header = [], ...rows] = block.rows ?? []
          return (
            <div key={index} className="markdown-table-wrap">
              <table className="markdown-table">
                <thead>
                  <tr>{header.map((cell, cellIndex) => <th key={`${cell}-${cellIndex}`}>{renderInline(cell)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{renderInline(cell)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'mermaid') {
          return <pre key={index} className="mermaid-block">{block.text}</pre>
        }
        if (block.kind === 'code') {
          return <pre key={index} className="code-block">{block.text}</pre>
        }
        return <p key={index}>{renderInline(block.text)}</p>
      })}
    </div>
  )
}

function renderExportSnapshotImage(pageNumber: number, snapshotImages: Map<number, string>) {
  const imageDataUrl = snapshotImages.get(pageNumber)
  if (!imageDataUrl) return '<p class="missing">No page image snapshot stored.</p>'
  return `
    <figure class="page-image">
      <img src="${escapeHtml(imageDataUrl)}" alt="Snapshot of page ${pageNumber}" />
      <figcaption>Page ${pageNumber} image</figcaption>
    </figure>
  `
}

const exportReaderStyles = `
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f7f9; }
    body { margin: 0; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 24px 72px; background: #fff; min-height: 100vh; }
    header.book-header { border-bottom: 2px solid #172033; padding-bottom: 20px; margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 2rem; line-height: 1.15; }
    .meta { color: #667085; margin: 0; }
    .tabs { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; overflow-x: auto; border-bottom: 1px solid #d8dee6; padding: 12px 0; background: #fff; }
    .tab-button { flex: 0 0 auto; border: 1px solid #d8dee6; border-radius: 8px; padding: 10px 14px; background: #f8fafc; color: #344054; cursor: pointer; font: inherit; font-weight: 750; }
    .tab-button.active { border-color: #16816f; background: #eef6f4; color: #145d52; }
    .tab-panel { display: block; padding-top: 24px; }
    .tab-panel + .tab-panel { border-top: 2px solid #d8dee6; margin-top: 36px; }
    .js-tabs .tab-panel { display: none; }
    .js-tabs .tab-panel.active { display: block; border-top: 0; margin-top: 0; }
    .book-page { border-top: 1px solid #d8dee6; padding-top: 28px; margin-top: 32px; }
    .book-page:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
    .all-version-block { margin-top: 22px; }
    .translation-variant-block { border-top: 1px solid #eef2f6; margin-top: 14px; padding-top: 14px; }
    .translation-variant-block:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
    h2 { margin: 0 0 16px; font-size: 1.45rem; }
    h3 { margin: 22px 0 10px; font-size: 1.05rem; color: #145d52; }
    h4 { margin: 16px 0 8px; font-size: 0.9rem; color: #475467; }
    p, li, dd { font-size: 0.98rem; line-height: 1.65; }
    ol { padding-left: 1.35rem; }
    ul { padding-left: 1.35rem; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 18px; font-size: 0.9rem; line-height: 1.45; }
    th, td { border: 1px solid #d8dee6; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #111827; font-weight: 800; }
    pre { overflow-x: auto; border: 1px solid #d8dee6; border-radius: 8px; padding: 14px; background: #f8fafc; color: #172033; font-size: 0.85rem; line-height: 1.45; }
    pre.mermaid::before { content: "Mermaid diagram"; display: block; margin-bottom: 8px; color: #145d52; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
    .missing { color: #98a2b3; font-style: italic; }
    .model-meta { display: inline-flex; margin: 0 0 12px; border: 1px solid #d8dee6; border-radius: 999px; padding: 4px 10px; background: #f8fafc; color: #475467; font-size: 0.82rem; line-height: 1.35; }
    .vocabulary { border-left: 3px solid #16816f; margin-top: 12px; padding-left: 12px; }
    dl { margin: 0; }
    dt { font-weight: 750; }
    dt span { color: #145d52; margin-left: 8px; }
    dd { margin: 2px 0 10px; color: #475467; }
    .vocabulary-meta { color: #667085; font-size: 0.82rem; }
    .vocabulary-meta strong { color: #475467; }
    @media print {
      body { background: #fff; }
      main { max-width: none; padding: 0; }
      .tabs { display: none; }
      .tab-panel,
      .js-tabs .tab-panel { display: block; }
      .book-page { break-before: page; }
    }
`

function renderExportTabScript(initialTab: string) {
  return `
  <script>
    (() => {
      document.documentElement.classList.add('js-tabs')
      let activeTab = ${JSON.stringify(initialTab)}
      const update = () => {
        document.querySelectorAll('.tab-button').forEach((button) => {
          button.classList.toggle('active', button.dataset.tabTarget === activeTab)
        })
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.classList.toggle('active', panel.dataset.tab === activeTab)
        })
      }
      document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => {
          activeTab = button.dataset.tabTarget || activeTab
          update()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        })
      })
      update()
    })()
  </script>`
}

function buildEnglishBookExportHtml(book: OldBookRecord, snapshotImages = new Map<number, string>()) {
  const versionTabs: { id: string, label: string, complexity?: TranslationComplexity }[] = [
    { id: 'german', label: 'German' },
    { id: 'faithful', label: 'Good Faith English', complexity: 'original' },
    { id: 'simplified', label: 'Simplified English', complexity: 'simplified' },
    { id: 'kid', label: 'Kid-Friendly English', complexity: 'kid-friendly' },
    { id: 'guide', label: 'Concept Guide', complexity: 'concept-guide' },
    { id: 'school', label: 'School-Friendly English', complexity: 'high-school' },
    { id: 'college', label: 'College English', complexity: 'college' },
  ]
  const exportTabs = [{ id: 'all', label: 'All Versions' }, ...versionTabs]
  const pageNumbers = Array.from(
    new Set(book.translations.map((translation) => translation.pageNumber)),
  ).sort((left, right) => left - right)
  const exportedAt = new Date().toLocaleString()
  const renderTranslationVariantBlock = (translation: OldBookRecord['translations'][number] | undefined) => `
    <section class="translation-variant-block">
      ${renderExportModelMeta(translation)}
      ${renderExportContent(translation)}
      ${renderExportVocabulary(translation?.glossary)}
    </section>
  `
  const renderGermanPage = (pageNumber: number) => {
    const originals = getPageTranslations(book, pageNumber, 'original', 'en')
    return `
      <article class="book-page" id="german-page-${pageNumber}">
        <h2>Page ${pageNumber}</h2>
        <div class="german-spotcheck-grid">
          <section>
            <h3>Page Image</h3>
            ${renderExportSnapshotImage(pageNumber, snapshotImages)}
          </section>
          <section>
            <h3>German Extraction</h3>
            ${originals.length
              ? originals.map((original) => `
                <section class="translation-variant-block">
                  ${renderExportModelMeta(original)}
                  ${renderExportSourceLines(original.sourceLines)}
                </section>
              `).join('\n')
              : renderExportSourceLines(undefined)}
          </section>
          <section>
            <h3>Good Faith English</h3>
            ${originals.length
              ? originals.map((original) => renderTranslationVariantBlock(original)).join('\n')
              : renderExportContent(undefined)}
          </section>
        </div>
        ${originals.map((original) => renderExportVocabulary(original.glossary)).join('\n')}
      </article>
    `
  }
  const renderVersionPage = (pageNumber: number, tab: typeof versionTabs[number]) => {
    const translations = tab.complexity ? getPageTranslations(book, pageNumber, tab.complexity, 'en') : []
    return `
      <article class="book-page" id="${tab.id}-page-${pageNumber}">
        <h2>Page ${pageNumber}</h2>
        <h3>${escapeHtml(tab.label)}</h3>
        ${translations.length
          ? translations.map(renderTranslationVariantBlock).join('\n')
          : renderExportContent(undefined)}
      </article>
    `
  }
  const renderAllPage = (pageNumber: number) => `
    <article class="book-page all-page" id="page-${pageNumber}">
      <h2>Page ${pageNumber}</h2>
      <div class="german-spotcheck-grid">
        <section>
          <h3>Page Image</h3>
          ${renderExportSnapshotImage(pageNumber, snapshotImages)}
        </section>
        <section>
          <h3>German Extraction</h3>
          ${getPageTranslations(book, pageNumber, 'original', 'en').length
            ? getPageTranslations(book, pageNumber, 'original', 'en').map((original) => `
              <section class="translation-variant-block">
                ${renderExportModelMeta(original)}
                ${renderExportSourceLines(original.sourceLines)}
              </section>
            `).join('\n')
            : renderExportSourceLines(undefined)}
        </section>
        <section>
          <h3>Good Faith English</h3>
          ${getPageTranslations(book, pageNumber, 'original', 'en').length
            ? getPageTranslations(book, pageNumber, 'original', 'en').map(renderTranslationVariantBlock).join('\n')
            : renderExportContent(undefined)}
        </section>
      </div>
      ${versionTabs.filter((tab) => tab.id !== 'german').map((tab) => `
        <section class="all-version-block">
          <h3>${escapeHtml(tab.label)}</h3>
          ${tab.complexity && getPageTranslations(book, pageNumber, tab.complexity, 'en').length
            ? getPageTranslations(book, pageNumber, tab.complexity, 'en').map(renderTranslationVariantBlock).join('\n')
            : renderExportContent(undefined)}
        </section>
      `).join('\n')}
    </article>
  `

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(book.title)} - BookForge Export</title>
  <style>
${exportReaderStyles}
    .german-spotcheck-grid { display: grid; grid-template-columns: minmax(240px, 0.85fr) minmax(260px, 1fr) minmax(280px, 1fr); gap: 24px; align-items: start; }
    .page-image { margin: 0 0 22px; border: 1px solid #d8dee6; border-radius: 8px; overflow: hidden; background: #f8fafc; }
    .page-image img { display: block; width: 100%; max-height: 82vh; object-fit: contain; background: #26323d; }
    .page-image figcaption { padding: 8px 10px; color: #667085; font-size: 0.82rem; }
    @media print {
      .german-spotcheck-grid { grid-template-columns: 1fr 1fr; gap: 18px; }
    }
    @media (max-width: 1020px) { .german-spotcheck-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header class="book-header">
      <h1>${escapeHtml(book.title)}</h1>
      <p class="meta">${escapeHtml(book.author || 'Unknown author')} · ${escapeHtml(book.dateLabel || 'Unknown date')} · Exported ${escapeHtml(exportedAt)}</p>
    </header>
    <nav class="tabs" aria-label="Book versions">
      ${exportTabs.map((tab, index) => `<button class="tab-button${index === 0 ? ' active' : ''}" data-tab-target="${tab.id}" type="button">${escapeHtml(tab.label)}</button>`).join('\n')}
    </nav>
    <section class="tab-panel active" data-tab="all">
      ${pageNumbers.length ? pageNumbers.map(renderAllPage).join('\n') : '<p class="missing">No translated pages stored yet.</p>'}
    </section>
    <section class="tab-panel" data-tab="german">
      ${pageNumbers.length ? pageNumbers.map(renderGermanPage).join('\n') : '<p class="missing">No German extraction stored yet.</p>'}
    </section>
    ${versionTabs.filter((tab) => tab.id !== 'german').map((tab) => `
      <section class="tab-panel" data-tab="${tab.id}">
        ${pageNumbers.length ? pageNumbers.map((pageNumber) => renderVersionPage(pageNumber, tab)).join('\n') : '<p class="missing">No translated pages stored yet.</p>'}
      </section>
    `).join('\n')}
  </main>
${renderExportTabScript('all')}
</body>
</html>`
}

function buildLanguageBookExportHtml(
  book: OldBookRecord,
  targetLanguage: TranslationLanguage,
  targetLanguageLabel: string,
) {
  const targetComplexities = complexityOptions
    .filter((option) => option.value !== 'original')
    .map((option) => ({ id: option.value, label: option.label, complexity: option.value }))
  const pageNumbers = Array.from(
    new Set(book.translations
      .filter((translation) => translation.language === targetLanguage || (translation.complexity === 'original' && translation.language === 'en'))
      .map((translation) => translation.pageNumber)),
  ).sort((left, right) => left - right)
  const exportedAt = new Date().toLocaleString()
  const renderTranslationVariantBlock = (translation: OldBookRecord['translations'][number] | undefined) => `
    <section class="translation-variant-block">
      ${renderExportModelMeta(translation)}
      ${renderExportContent(translation)}
      ${renderExportVocabulary(translation?.glossary)}
    </section>
  `
  const renderFaithfulPage = (pageNumber: number) => {
    const originals = getPageTranslations(book, pageNumber, 'original', 'en')
    return `
      <article class="book-page" id="faithful-page-${pageNumber}">
        <h2>Page ${pageNumber}</h2>
        ${originals.length
          ? originals.map(renderTranslationVariantBlock).join('\n')
          : renderExportContent(undefined)}
      </article>
    `
  }
  const renderTargetPage = (pageNumber: number) => `
    <article class="book-page" id="target-page-${pageNumber}">
      <h2>Page ${pageNumber}</h2>
      ${targetComplexities.map((tab) => {
        const translations = getPageTranslations(book, pageNumber, tab.complexity, targetLanguage)
        if (!translations.length) return ''
        return `
          <section class="all-version-block">
            <h3>${escapeHtml(tab.label)}</h3>
            ${translations.map(renderTranslationVariantBlock).join('\n')}
          </section>
        `
      }).join('\n') || '<p class="missing">No target-language translation stored for this page yet.</p>'}
    </article>
  `

  return `<!doctype html>
<html lang="${escapeHtml(targetLanguage)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(book.title)} - ${escapeHtml(targetLanguageLabel)} BookForge Export</title>
  <style>
${exportReaderStyles}
  </style>
</head>
<body>
  <main>
    <header class="book-header">
      <h1>${escapeHtml(book.title)}</h1>
      <p class="meta">${escapeHtml(book.author || 'Unknown author')} · ${escapeHtml(book.dateLabel || 'Unknown date')} · ${escapeHtml(targetLanguageLabel)} export · Exported ${escapeHtml(exportedAt)}</p>
    </header>
    <nav class="tabs" aria-label="Book versions">
      <button class="tab-button active" data-tab-target="faithful" type="button">Good Faith English</button>
      <button class="tab-button" data-tab-target="target" type="button">${escapeHtml(targetLanguageLabel)}</button>
    </nav>
    <section class="tab-panel active" data-tab="faithful">
      ${pageNumbers.length ? pageNumbers.map(renderFaithfulPage).join('\n') : '<p class="missing">No Good Faith English pages stored yet.</p>'}
    </section>
    <section class="tab-panel" data-tab="target">
      ${pageNumbers.length ? pageNumbers.map(renderTargetPage).join('\n') : '<p class="missing">No translated pages stored yet.</p>'}
    </section>
  </main>
${renderExportTabScript('faithful')}
</body>
</html>`
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function TranslationWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const translationAbortRef = useRef<AbortController | null>(null)
  const pagePersistTimerRef = useRef<number | null>(null)
  const [oldBooks, setOldBooks] = useState<OldBookRecord[]>(() => mergeOldBookRecords([]))
  const [activeBookId, setActiveBookId] = useState('')
  const [complexity, setComplexity] = useState<TranslationComplexity>('kid-friendly')
  const [language, setLanguage] = useState<TranslationLanguage>('ml')
  const [activeSection, setActiveSection] = useState('Opening argument')
  const [question, setQuestion] = useState('Why does this section compare the sky to circles?')
  const [oldBookStatus, setOldBookStatus] = useState('')
  const [oldBookBusy, setOldBookBusy] = useState(false)
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null)
  const [activePdfBlob, setActivePdfBlob] = useState<Blob | null>(null)
  const [latestAnswer, setLatestAnswer] = useState<QuestionRecord | null>(null)
  const [visionEndpoint, setVisionEndpoint] = useState(defaultRouterEndpoint)
  const [visionModel, setVisionModel] = useState(defaultRouterModel)
  const [sourceExtractionModel, setSourceExtractionModel] = useState(defaultSourceExtractionModel)
  const [availableVisionModels, setAvailableVisionModels] = useState<LocalVisionModel[]>([])
  const [visionModelsLoading, setVisionModelsLoading] = useState(false)
  const [visionModelsStatus, setVisionModelsStatus] = useState('')
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [activeSnapshotPage, setActiveSnapshotPage] = useState<number | null>(null)
  const [snapshotViewMode, setSnapshotViewMode] = useState<'all' | 'page'>('all')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [sourceInspectorOpen, setSourceInspectorOpen] = useState(false)
  const [sourceInspectorTab, setSourceInspectorTab] = useState<'source' | 'faithful'>('source')
  const [liveExportOpen, setLiveExportOpen] = useState(false)
  const [liveExportHtml, setLiveExportHtml] = useState('')
  const [liveExportTitle, setLiveExportTitle] = useState('')
  const [packageSettingsOpen, setPackageSettingsOpen] = useState(false)
  const [packageInspector, setPackageInspector] = useState<PortablePackageInspectorState>({
    open: false,
    fileName: '',
    status: '',
    files: [],
    validation: [],
    pages: [],
    translations: [],
  })
  const [packageMetadata, setPackageMetadata] = useState<PortablePackageMetadataDraft>({
    publisherName: '',
    version: '1.0.0',
    revision: 1,
    changelog: '',
    license: 'Public domain',
    rightsStatus: 'Public domain source; translation reviewed for publication',
    sourceUrl: '',
  })
  const [packageAssetOptions, setPackageAssetOptions] = useState<PortablePackageAssetOptions>({
    includeSourcePdf: true,
    includeSnapshots: true,
    includeThumbnails: true,
    imageFormat: 'jpeg',
    imageMaxWidth: 1600,
    jpegQuality: 0.82,
    pagesPerVolume: 0,
  })
  const [forceRetranslate, setForceRetranslate] = useState(false)
  const [translationPageSelection, setTranslationPageSelection] = useState('all')
  const [activeTranslationJob, setActiveTranslationJob] = useState<TranslationJobState | null>(null)
  const [activeSnapshotJob, setActiveSnapshotJob] = useState<SnapshotJobState | null>(null)
  const [snapshotProgress, setSnapshotProgress] = useState<SnapshotProgressState | null>(null)

  const activeBook = oldBooks.find((entry) => entry.id === activeBookId) ?? oldBooks[0]
  const translationLanguage: TranslationLanguage = complexity === 'original' ? 'en' : language
  const selectedLanguage = languageOptions.find((entry) => entry.value === translationLanguage)?.label ?? 'English'
  const selectedComplexity = complexityOptions.find((entry) => entry.value === complexity)?.label ?? 'Kid Friendly'
  const visionModelOptions = availableVisionModels.some((entry) => entry.id === visionModel)
    ? availableVisionModels
    : visionModel
      ? [{ id: visionModel }, ...availableVisionModels]
      : availableVisionModels
  const sourceExtractionModelOptions = availableVisionModels.some((entry) => entry.id === sourceExtractionModel)
    ? availableVisionModels
    : sourceExtractionModel
      ? [{ id: sourceExtractionModel }, ...availableVisionModels]
      : availableVisionModels
  const activeOutputModel = complexity === 'original' ? sourceExtractionModel : visionModel
  const activeSourceModel = sourceExtractionModel
  const activeTranslation = activeBook
    ? getStoredTranslation(
      activeBook,
      complexity,
      translationLanguage,
      activeSection,
      activeOutputModel,
      complexity === 'original' ? activeOutputModel : activeSourceModel,
    )
    : undefined
  const activeTranslationVariants = activeBook
    ? getPageTranslations(activeBook, activeBook.pageNumber, complexity, translationLanguage)
    : []
  const canonicalOriginalTranslation = getCanonicalOriginalTranslation(activeBook, activeBook?.pageNumber, activeSourceModel)
  const previousOriginalTranslation = getPreviousOriginalTranslation(activeBook, activeSourceModel)
  const nextOriginalTranslation = getNextOriginalTranslation(activeBook, activeSourceModel)
  const activePageSnapshot = activeBook?.pageSnapshots.find((snapshot) => snapshot.pageNumber === activeBook.pageNumber)
  const hasImportedPdf = Boolean(activeBook?.pdfBlobId)
  const activePageNumber = activeBook?.pageNumber ?? 1
  const activePageLimit = activeBook?.pages && activeBook.pages > 0 ? activeBook.pages : undefined
  const activePageCount = activePageLimit ?? Math.max(activePageSnapshot?.pageNumber ?? 0, activePageNumber, 1)
  const translatedPageCount = getTranslatedPageCount(
    activeBook,
    complexity,
    translationLanguage,
    activeOutputModel,
    complexity === 'original' ? activeOutputModel : activeSourceModel,
  )
  const translatedParagraphs = activeTranslation
    ? activeTranslation.paragraphs
    : hasImportedPdf
      ? [`No stored ${selectedLanguage} translation for page ${activePageNumber} yet. Choose Translate Page to generate and save it.`]
      : getDemoTranslationParagraphs(complexity, language)
  const currentProgress = hasImportedPdf && activePageCount
    ? Math.round((translatedPageCount / activePageCount) * 100)
    : activeBook?.progress ?? 0
  const translationHeaderTitle = activeTranslation?.sectionTitle ?? activeSection
  const activePdfFrameSrc = activePdfUrl ? `${activePdfUrl}#page=${activePageNumber}&toolbar=0&navpanes=0` : null
  const activeQuestion = latestAnswer
    ?? activeBook?.questions.find((entry) =>
      entry.pageNumber === activeBook.pageNumber
      && entry.sectionTitle === activeSection
      && entry.complexity === complexity
      && entry.language === translationLanguage
    )
    ?? activeBook?.questions.find((entry) =>
      entry.pageNumber === activeBook.pageNumber
      && entry.complexity === complexity
      && entry.language === translationLanguage
    )
  const visibleSourceLines = activeTranslation?.sourceLines.length
    ? activeTranslation.sourceLines
    : hasImportedPdf
      ? []
      : sourcePageLines
  const currentSourceLines = canonicalOriginalTranslation?.sourceLines.length
    ? canonicalOriginalTranslation.sourceLines
    : activeTranslation?.sourceLines.length
      ? activeTranslation.sourceLines
      : hasImportedPdf
        ? []
        : sourcePageLines
  const previousSourceLines = previousOriginalTranslation?.sourceLines ?? []
  const nextSourceLines = nextOriginalTranslation?.sourceLines ?? []
  const previousGoodFaithParagraphs = previousOriginalTranslation?.paragraphs ?? []
  const goodFaithParagraphs = canonicalOriginalTranslation?.paragraphs ?? []
  const nextGoodFaithParagraphs = nextOriginalTranslation?.paragraphs ?? []
  const sortedSnapshots = useMemo(
    () => [...(activeBook?.pageSnapshots ?? [])].sort((left, right) => left.pageNumber - right.pageNumber),
    [activeBook?.pageSnapshots],
  )
  const selectedSnapshot = sortedSnapshots.find((snapshot) => snapshot.pageNumber === activeSnapshotPage)
    ?? sortedSnapshots.find((snapshot) => snapshot.pageNumber === activeBook?.pageNumber)
    ?? sortedSnapshots[0]
  const snapshotBrowserItems = snapshotViewMode === 'page' && selectedSnapshot ? [selectedSnapshot] : sortedSnapshots
  const translationMemoryRows = useMemo(() => getTranslationMemoryRows(activeBook), [activeBook])
  const approvedMemoryCount = translationMemoryRows.filter((entry) => entry.approved).length
  const displayedTranslationJob = activeTranslationJob
    ?? activeBook?.translationJobs?.find((entry) => entry.status === 'running')
    ?? activeBook?.translationJobs?.[0]
  const resumableTranslationJob = activeBook?.translationJobs?.find((entry) =>
    entry.kind === 'translate-all'
    && entry.complexity === complexity
    && entry.language === translationLanguage
    && entry.status !== 'complete'
  )
  const hasResumableTranslationJob = Boolean(resumableTranslationJob && !forceRetranslate)
  const displayedSnapshotJob = activeSnapshotJob
    ?? activeBook?.snapshotJobs?.find((entry) => entry.status === 'running')
    ?? activeBook?.snapshotJobs?.[0]
  const hasRunningSnapshotJob = displayedSnapshotJob?.status === 'running'
  const snapshotProgressPercent = snapshotProgress?.total
    ? Math.min(100, Math.max(0, Math.round((snapshotProgress.current / snapshotProgress.total) * 100)))
    : 0

  async function refreshVisionModels(
    endpointOverride = visionEndpoint,
    preferredModel = visionModel,
    preferredSourceModel = sourceExtractionModel,
  ) {
    setVisionModelsLoading(true)
    setVisionModelsStatus('Loading router models...')
    try {
      const models = await listVisionModels(endpointOverride)
      const modelIds = models.map((entry) => entry.id)
      setAvailableVisionModels(models)
      if (modelIds.length && !modelIds.includes(preferredModel)) {
        setVisionModel(modelIds.includes(llmRouterModel) ? llmRouterModel : modelIds[0])
      }
      if (modelIds.length && !modelIds.includes(preferredSourceModel)) {
        setSourceExtractionModel(modelIds.includes(llmRouterSourceModel) ? llmRouterSourceModel : modelIds[0])
      }
      setVisionModelsStatus(models.length ? `${models.length} router models available.` : 'No models returned by this endpoint.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAvailableVisionModels([])
      setVisionModelsStatus(message)
      setOldBookStatus(message)
    } finally {
      setVisionModelsLoading(false)
    }
  }

  useEffect(() => {
    const migratedEndpoint = visionEndpoint === legacyRouterEndpoint
      ? llmRouterEndpoint
      : visionEndpoint
    const migratedModel = visionModel === legacyRouterModel ? llmRouterModel : visionModel
    const migratedSourceModel = sourceExtractionModel === legacyRouterModel ? llmRouterSourceModel : sourceExtractionModel
    if (migratedEndpoint !== visionEndpoint) setVisionEndpoint(migratedEndpoint)
    if (migratedModel !== visionModel) setVisionModel(migratedModel)
    if (migratedSourceModel !== sourceExtractionModel) setSourceExtractionModel(migratedSourceModel)
    void refreshVisionModels(migratedEndpoint, migratedModel, migratedSourceModel)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadOldBookCatalog() {
      setOldBookBusy(true)
      try {
        const storedBooks = await readOldBooks()
        if (cancelled) return
        const mergedBooks = mergeOldBookRecords(storedBooks)
        setOldBooks(mergedBooks)
        setActiveBookId((current) => (
          mergedBooks.some((book) => book.id === current) ? current : mergedBooks[0]?.id ?? ''
        ))
      } catch (error) {
        if (!cancelled) {
          setOldBookStatus(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setOldBookBusy(false)
        }
      }
    }

    void loadOldBookCatalog()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setActivePdfUrl(null)
    setActivePdfBlob(null)

    async function loadPdfBlob(pdfBlobId: string) {
      try {
        const blob = await getOldBookPdfBlob(pdfBlobId)
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setActivePdfBlob(blob)
        setActivePdfUrl(objectUrl)
      } catch (error) {
        if (!cancelled) {
          setOldBookStatus(error instanceof Error ? error.message : String(error))
        }
      }
    }

    if (activeBook?.pdfBlobId) {
      void loadPdfBlob(activeBook.pdfBlobId)
    }

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [activeBook?.pdfBlobId])

  useEffect(() => {
    setLatestAnswer(null)
  }, [activeBookId, activeSection, complexity, language])

  useEffect(() => () => {
    if (pagePersistTimerRef.current) {
      window.clearTimeout(pagePersistTimerRef.current)
    }
  }, [])

  async function persistOldBook(updatedBook: OldBookRecord) {
    const updatedAt = new Date().toISOString()
    const normalizedBook = { ...updatedBook, updatedAt }
    await saveOldBookRecord(normalizedBook)
    setOldBooks((current) => {
      const withoutBook = current.filter((entry) => entry.id !== normalizedBook.id)
      return normalizedBook.pdfBlobId ? [normalizedBook, ...withoutBook] : [normalizedBook, ...withoutBook]
    })
    return normalizedBook
  }

  function schedulePagePositionPersist(updatedBook: OldBookRecord) {
    if (pagePersistTimerRef.current) {
      window.clearTimeout(pagePersistTimerRef.current)
    }

    pagePersistTimerRef.current = window.setTimeout(() => {
      pagePersistTimerRef.current = null
      void saveOldBookRecord(updatedBook).catch((error) => {
        setOldBookStatus(error instanceof Error ? error.message : String(error))
      })
    }, 600)
  }

  async function persistTranslationJob(book: OldBookRecord, job: TranslationJobState) {
    const updatedJob = { ...job, updatedAt: new Date().toISOString() }
    setActiveTranslationJob(updatedJob)
    setOldBookStatus(updatedJob.message)
    const updatedBook = await persistOldBook({
      ...book,
      status: updatedJob.message,
      translationJobs: [
        updatedJob,
        ...(book.translationJobs ?? []).filter((entry) => entry.id !== updatedJob.id),
      ],
    })
    await yieldToBrowser()
    return { updatedBook, updatedJob }
  }

  async function persistSnapshotJob(book: OldBookRecord, job: SnapshotJobState) {
    const updatedJob = { ...job, updatedAt: new Date().toISOString() }
    setActiveSnapshotJob(updatedJob)
    setSnapshotProgress({
      phase: updatedJob.phase === 'complete' ? 'complete' : updatedJob.phase,
      current: updatedJob.completedPages + updatedJob.skippedPages,
      total: updatedJob.totalPages,
      message: updatedJob.message,
    })
    setOldBookStatus(updatedJob.message)
    const updatedBook = await persistOldBook({
      ...book,
      status: updatedJob.message,
      snapshotJobs: [
        updatedJob,
        ...(book.snapshotJobs ?? []).filter((entry) => entry.id !== updatedJob.id),
      ],
    })
    await yieldToBrowser()
    return { updatedBook, updatedJob }
  }

  function stopTranslationRequest() {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    setOldBookBusy(false)
    setOldBookStatus('Translation request stopped.')
    setActiveTranslationJob((current) => current ? {
      ...current,
      status: 'failed',
      error: 'Stopped by user.',
      message: 'Stopped by user.',
      updatedAt: new Date().toISOString(),
    } : current)
  }

  function resetTranslationControls() {
    translationAbortRef.current = null
    setOldBookBusy(false)
    setOldBookStatus('Controls reset. Any in-flight model request may still finish server-side, but the UI is free.')
  }

  async function handlePdfSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setOldBookStatus('Choose a PDF file to import.')
      return
    }

    setOldBookBusy(true)
    try {
      const importedBook = await importOldBookPdf(file)
      setOldBooks((current) => [importedBook, ...current.filter((entry) => entry.id !== importedBook.id)])
      setActiveBookId(importedBook.id)
      setActiveSection('Page 1, OCR pending')
      setOldBookStatus(`Imported ${file.name} (${formatFileSize(file.size)}).`)
    } catch (error) {
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setOldBookBusy(false)
    }
  }

  function setReaderPage(pageNumber: number) {
    if (!activeBook || !Number.isFinite(pageNumber)) return

    const roundedPage = Math.round(pageNumber)
    const lowerBoundedPage = Math.max(1, roundedPage)
    const nextPage = activePageLimit ? Math.min(lowerBoundedPage, activePageLimit) : lowerBoundedPage
    if (nextPage === activeBook.pageNumber) return

    const storedPageTranslation = activeBook.translations.find((translation) =>
      translation.pageNumber === nextPage
      && translation.complexity === complexity
      && translation.language === language
    )
    const nextSection = storedPageTranslation?.sectionTitle
      ?? (activeBook.pdfBlobId ? `Page ${nextPage}, OCR pending` : activeBook.section)
    const updatedBook = {
      ...activeBook,
      pageNumber: nextPage,
      section: nextSection,
      updatedAt: new Date().toISOString(),
    }

    setLatestAnswer(null)
    setActiveSection(nextSection)
    setActiveSnapshotPage(nextPage)
    setOldBooks((current) => current.map((entry) => (entry.id === updatedBook.id ? updatedBook : entry)))
    schedulePagePositionPersist(updatedBook)
  }

  function openAllSnapshots() {
    setActiveSnapshotPage(activeBook?.pageNumber ?? sortedSnapshots[0]?.pageNumber ?? null)
    setSnapshotViewMode('all')
    setSnapshotsOpen(true)
  }

  function openActivePageSnapshot() {
    if (!activePageSnapshot) return
    setActiveSnapshotPage(activePageSnapshot.pageNumber)
    setSnapshotViewMode('page')
    setSnapshotsOpen(true)
  }

  async function saveRenderedSnapshotToFolder(bookId: string, snapshot: RenderedPdfSnapshot) {
    if (!bookId) return undefined

    try {
      return (await invoke('save_old_book_snapshot', {
        bookId,
        pageNumber: snapshot.pageNumber,
        imageDataUrl: snapshot.imageDataUrl,
      })) as string
    } catch (error) {
      if (isTauriUnavailable(error)) return undefined
      throw error
    }
  }

  async function getSnapshotImageDataUrl(snapshot: PageSnapshotRecord) {
    if (snapshot.imageDataUrl) return snapshot.imageDataUrl
    if (!snapshot.filePath) {
      throw new Error(`Snapshot page ${snapshot.pageNumber} has no image data or file path.`)
    }
    return getOldBookFileDataUrl(snapshot.filePath)
  }

  async function renderAndSaveActivePageSnapshot(bookToSnapshot: OldBookRecord) {
    if (!activePdfBlob) {
      throw new Error('Import a PDF before creating a page snapshot.')
    }

    const renderedSnapshot = await renderPdfPageSnapshot(activePdfBlob, bookToSnapshot.pageNumber)
    const snapshot = createPageSnapshotRecord(
      bookToSnapshot.pageNumber,
      renderedSnapshot.imageDataUrl,
      renderedSnapshot.width,
      renderedSnapshot.height,
      await saveRenderedSnapshotToFolder(bookToSnapshot.id, renderedSnapshot),
    )
    const existingSnapshots = bookToSnapshot.pageSnapshots.filter((entry) => entry.pageNumber !== snapshot.pageNumber)
    const updatedBook = await persistOldBook({
      ...bookToSnapshot,
      pages: renderedSnapshot.pageCount || bookToSnapshot.pages,
      status: 'Page snapshot ready',
      pageSnapshots: [snapshot, ...existingSnapshots],
    })

    setOldBookStatus(`Captured page ${snapshot.pageNumber} snapshot for ${updatedBook.title}.`)
    return { updatedBook, snapshot }
  }

  async function ensureActivePageSnapshot(bookToSnapshot: OldBookRecord) {
    const existingSnapshot = bookToSnapshot.pageSnapshots.find((entry) => entry.pageNumber === bookToSnapshot.pageNumber)
    if (existingSnapshot) return { updatedBook: bookToSnapshot, snapshot: existingSnapshot }
    return renderAndSaveActivePageSnapshot(bookToSnapshot)
  }

  async function ensurePageSnapshot(bookToSnapshot: OldBookRecord, pageNumber: number) {
    const existingSnapshot = bookToSnapshot.pageSnapshots.find((entry) => entry.pageNumber === pageNumber)
    if (existingSnapshot) {
      return { updatedBook: { ...bookToSnapshot, pageNumber }, snapshot: existingSnapshot, pageCount: bookToSnapshot.pages }
    }

    if (!activePdfBlob) {
      throw new Error('Import a PDF before creating a page snapshot.')
    }

    const renderedSnapshot = await renderPdfPageSnapshot(activePdfBlob, pageNumber, { maxWidth: 1000 })
    const snapshot = createPageSnapshotRecord(
      renderedSnapshot.pageNumber,
      renderedSnapshot.imageDataUrl,
      renderedSnapshot.width,
      renderedSnapshot.height,
      await saveRenderedSnapshotToFolder(bookToSnapshot.id, renderedSnapshot),
    )
    const updatedBook = {
      ...bookToSnapshot,
      pageNumber: renderedSnapshot.pageNumber,
      pages: renderedSnapshot.pageCount || bookToSnapshot.pages,
      status: 'Page snapshot ready',
      pageSnapshots: [
        snapshot,
        ...bookToSnapshot.pageSnapshots.filter((entry) => entry.pageNumber !== snapshot.pageNumber),
      ],
    }

    return { updatedBook, snapshot, pageCount: renderedSnapshot.pageCount }
  }

  async function snapshotActivePage() {
    if (!activeBook) return
    setOldBookBusy(true)
    try {
      const { snapshot } = await renderAndSaveActivePageSnapshot(activeBook)
      setActiveSnapshotPage(snapshot.pageNumber)
    } catch (error) {
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setOldBookBusy(false)
    }
  }

  async function snapshotAllPages() {
    if (!activeBook || !activePdfBlob) return
    const startedAt = new Date().toISOString()
    let job: SnapshotJobState = {
      id: createId(),
      kind: 'snapshot-all',
      status: 'running',
      currentPage: activeBook.pageNumber,
      totalPages: activeBook.pages || 0,
      phase: 'preparing',
      completedPages: 0,
      skippedPages: 0,
      message: 'Preparing all page snapshots...',
      startedAt,
      updatedAt: startedAt,
    }

    setOldBookBusy(true)
    setSnapshotProgress({
      phase: 'preparing',
      current: 0,
      total: activeBook.pages || 0,
      message: 'Preparing all page snapshots...',
    })
    try {
      let { updatedBook: workingBook, updatedJob } = await persistSnapshotJob(activeBook, job)
      job = updatedJob
      const totalPages = workingBook.pages || await getPdfPageCount(activePdfBlob)
      const existingByPage = new Map(workingBook.pageSnapshots.map((snapshot) => [snapshot.pageNumber, snapshot]))
      const missingPages = Array.from({ length: totalPages }, (_, index) => index + 1)
        .filter((pageNumber) => !existingByPage.has(pageNumber))
      const skippedPages = totalPages - missingPages.length

      if (!missingPages.length) {
        const completeJob: SnapshotJobState = {
          ...job,
          status: 'complete',
          phase: 'complete',
          currentPage: totalPages,
          totalPages,
          completedPages: 0,
          skippedPages,
          message: `All ${totalPages} page snapshots are already saved.`,
          updatedAt: new Date().toISOString(),
        }
        workingBook = await persistOldBook({
          ...workingBook,
          pages: totalPages,
          status: completeJob.message,
          snapshotJobs: [
            completeJob,
            ...(workingBook.snapshotJobs ?? []).filter((entry) => entry.id !== completeJob.id),
          ],
        })
        setActiveSnapshotJob(completeJob)
        setSnapshotProgress({
          phase: 'complete',
          current: totalPages,
          total: totalPages,
          message: completeJob.message,
        })
        setOldBookStatus(completeJob.message)
        setActiveBookId(workingBook.id)
        setSnapshotsOpen(true)
        return
      }

      ;({ updatedBook: workingBook, updatedJob } = await persistSnapshotJob(workingBook, {
        ...job,
        totalPages,
        skippedPages,
        message: `Rendering ${missingPages.length} missing snapshots; ${skippedPages} already saved.`,
      }))
      job = updatedJob

      const snapshotRecords: PageSnapshotRecord[] = []
      const snapshotRecordPages = new Set<number>()
      let lastPersistedSnapshotCount = 0
      let flushSnapshotsPromise = Promise.resolve()

      async function flushSnapshotBatch(reason: 'batch' | 'final') {
        if (reason === 'batch' && snapshotRecords.length === lastPersistedSnapshotCount) return
        const recordsToPersist = [...snapshotRecords]
        const latestSnapshot = recordsToPersist[recordsToPersist.length - 1]
        const nextJob: SnapshotJobState = {
          ...job,
          currentPage: latestSnapshot?.pageNumber ?? job.currentPage,
          totalPages,
          phase: reason === 'final' ? 'persist' : 'saving',
          completedPages: recordsToPersist.length,
          skippedPages,
          message: reason === 'final'
            ? `Persisting ${recordsToPersist.length} rendered snapshots...`
            : `Saved ${recordsToPersist.length} of ${missingPages.length} missing snapshots.`,
          updatedAt: new Date().toISOString(),
        }

        flushSnapshotsPromise = flushSnapshotsPromise.then(async () => {
          const persistedPageNumbers = new Set(recordsToPersist.map((entry) => entry.pageNumber))
          const mergedSnapshots = [
            ...recordsToPersist,
            ...workingBook.pageSnapshots.filter((snapshot) => !persistedPageNumbers.has(snapshot.pageNumber)),
          ]
          workingBook = await persistOldBook({
            ...workingBook,
            pages: totalPages,
            status: nextJob.message,
            pageSnapshots: mergedSnapshots,
            snapshotJobs: [
              nextJob,
              ...(workingBook.snapshotJobs ?? []).filter((entry) => entry.id !== nextJob.id),
            ],
          })
          job = nextJob
          updatedJob = nextJob
          lastPersistedSnapshotCount = recordsToPersist.length
          setActiveSnapshotJob(nextJob)
        })

        await flushSnapshotsPromise
      }

      await renderPdfPageSnapshotsParallelStream(activePdfBlob, {
        maxWidth: 1000,
        pages: missingPages,
        concurrency: 2,
        onProgress: (pageNumber, pageCount, started) => {
          setSnapshotProgress({
            phase: 'rendering',
            current: skippedPages + snapshotRecords.length,
            total: totalPages,
            message: `Rendering page ${pageNumber} of ${pageCount} (${started} queued)`,
          })
        },
        onSnapshot: async (renderedSnapshot, current) => {
          setSnapshotProgress({
            phase: 'saving',
            current: skippedPages + current,
            total: totalPages,
            message: `Saving page ${renderedSnapshot.pageNumber} of ${totalPages}`,
          })
          setOldBookStatus(`Saving snapshot ${renderedSnapshot.pageNumber} of ${renderedSnapshot.pageCount}...`)
          const snapshotRecord = createPageSnapshotRecord(
            renderedSnapshot.pageNumber,
            renderedSnapshot.imageDataUrl,
            renderedSnapshot.width,
            renderedSnapshot.height,
            await saveRenderedSnapshotToFolder(activeBook.id, renderedSnapshot),
          )
          if (!snapshotRecordPages.has(snapshotRecord.pageNumber)) {
            snapshotRecordPages.add(snapshotRecord.pageNumber)
            snapshotRecords.push(snapshotRecord)
            snapshotRecords.sort((left, right) => left.pageNumber - right.pageNumber)
          }
          setOldBooks((currentBooks) => currentBooks.map((entry) => {
            if (entry.id !== activeBook.id) return entry
            return {
              ...entry,
              pages: totalPages,
              pageSnapshots: [
                snapshotRecord,
                ...entry.pageSnapshots.filter((snapshot) => snapshot.pageNumber !== snapshotRecord.pageNumber),
              ],
            }
          }))
          if (snapshotRecords.length % 5 === 0 || current === missingPages.length) {
            await flushSnapshotBatch('batch')
          }
          await yieldToBrowser()
        },
      })
      await flushSnapshotBatch('final')

      const mergedSnapshotRecords = [
        ...snapshotRecords,
        ...workingBook.pageSnapshots.filter((snapshot) =>
          !snapshotRecords.some((entry) => entry.pageNumber === snapshot.pageNumber)
        ),
      ]
      const completeJob: SnapshotJobState = {
        ...job,
        status: 'complete',
        phase: 'complete',
        currentPage: totalPages,
        totalPages,
        completedPages: snapshotRecords.length,
        skippedPages,
        message: `Snapshot All complete. Saved ${snapshotRecords.length}, skipped ${skippedPages}.`,
        updatedAt: new Date().toISOString(),
      }
      const savedBook = await persistOldBook({
        ...workingBook,
        pages: totalPages,
        status: completeJob.message,
        pageSnapshots: mergedSnapshotRecords,
        snapshotJobs: [
          completeJob,
          ...(workingBook.snapshotJobs ?? []).filter((entry) => entry.id !== completeJob.id),
        ],
      })
      setActiveSnapshotJob(completeJob)
      setActiveSnapshotPage(snapshotRecords[0]?.pageNumber ?? null)
      setSnapshotViewMode('all')
      setOldBookStatus(`Captured ${snapshotRecords.length} snapshots for ${savedBook.title}.`)
      setSnapshotsOpen(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOldBookStatus(message)
      setActiveSnapshotJob((current) => current ? {
        ...current,
        status: 'failed',
        error: message,
        message,
        updatedAt: new Date().toISOString(),
      } : current)
    } finally {
      setSnapshotProgress(null)
      setOldBookBusy(false)
    }
  }

  async function createOriginalTranslationFromSnapshot(
    bookForTranslation: OldBookRecord,
    snapshotImageDataUrl: string,
    signal?: AbortSignal,
  ) {
    const result = await requestVisionTranslation({
      endpoint: visionEndpoint,
      model: sourceExtractionModel,
      imageDataUrl: snapshotImageDataUrl,
      bookTitle: bookForTranslation.title,
      pageNumber: bookForTranslation.pageNumber,
      complexityLabel: 'Original',
      languageLabel: 'English',
      complexity: 'original',
      language: 'en',
      previousOriginalParagraphs: getPreviousOriginalTranslation(bookForTranslation, sourceExtractionModel)?.paragraphs,
      previousSourceLines: getPreviousOriginalTranslation(bookForTranslation, sourceExtractionModel)?.sourceLines,
      priorGlossary: getPriorGlossary(bookForTranslation),
      signal,
    })

    return createTranslationRecord(
      bookForTranslation,
      'original',
      'en',
      result.sectionTitle || `Page ${bookForTranslation.pageNumber}`,
      {
        paragraphs: result.paragraphs,
        sourceLines: result.sourceLines,
        glossary: result.glossary,
        notes: result.notes,
        model: sourceExtractionModel,
        sourceModel: sourceExtractionModel,
      },
    )
  }

  async function reviewGlossaryIntoBookMemory(
    bookForReview: OldBookRecord,
    memory: TranslationMemoryEntry[],
    glossary: TranslationGlossaryEntry[] | undefined,
    signal?: AbortSignal,
  ) {
    if (!glossary?.length) return memory

    try {
      const reviewed = await requestTranslationMemoryReview({
        endpoint: visionEndpoint,
        model: llmRouterModel,
        bookTitle: bookForReview.title,
        newTerms: glossary,
        existingTerms: getApprovedTranslationMemory({ ...bookForReview, translationMemory: memory }),
        signal,
      })
      return mergeApprovedTranslationMemory(memory, reviewed.glossary)
    } catch (error) {
      setOldBookStatus(`Glossary review skipped: ${error instanceof Error ? error.message : String(error)}`)
      return mergeTranslationMemorySuggestions(memory, glossary)
    }
  }

  function createPageTranslationFromResult(
    bookForTranslation: OldBookRecord,
    result: VisionTranslationResult,
    outputComplexity = complexity,
    outputLanguage = translationLanguage,
    outputSourceModel = sourceExtractionModel,
  ) {
    return createTranslationRecord(
      bookForTranslation,
      outputComplexity,
      outputLanguage,
      result.sectionTitle || activeSection,
      {
        paragraphs: result.paragraphs,
        sourceLines: result.sourceLines,
        glossary: result.glossary,
        notes: result.notes,
        model: visionModel,
        sourceModel: outputSourceModel,
      },
    )
  }

  async function translateActivePage() {
    if (!activeBook) return

    translationAbortRef.current?.abort()
    const abortController = new AbortController()
    translationAbortRef.current = abortController
    setOldBookBusy(true)
    try {
      setOldBookStatus(`Translating page ${activeBook.pageNumber}...`)
      let bookForTranslation = activeBook
      let translationsForSave = activeBook.translations
      let translationMemoryForSave = activeBook.translationMemory
      let translation = undefined as ReturnType<typeof createTranslationRecord> | undefined

      if (activeBook.pdfBlobId) {
        setOldBookStatus(
          activePageSnapshot
            ? `Using saved page ${activeBook.pageNumber} snapshot for translation...`
            : `Creating page ${activeBook.pageNumber} snapshot for translation...`,
        )
        const { updatedBook, snapshot } = await ensureActivePageSnapshot(activeBook)
        bookForTranslation = updatedBook
        translationsForSave = updatedBook.translations
        translationMemoryForSave = updatedBook.translationMemory

        let originalTranslation = getCanonicalOriginalTranslation(updatedBook, updatedBook.pageNumber, sourceExtractionModel)
        if (!originalTranslation) {
          setOldBookStatus(`Transcribing source text and creating Original English for page ${updatedBook.pageNumber}...`)
          originalTranslation = await createOriginalTranslationFromSnapshot(
            updatedBook,
            await getSnapshotImageDataUrl(snapshot),
            abortController.signal,
          )
          translationsForSave = replaceTranslationRecord(translationsForSave, originalTranslation)
          setOldBookStatus(`Reviewing page ${updatedBook.pageNumber} glossary with ${llmRouterModel}...`)
          translationMemoryForSave = await reviewGlossaryIntoBookMemory(
            updatedBook,
            translationMemoryForSave,
            originalTranslation.glossary,
            abortController.signal,
          )
          bookForTranslation = {
            ...updatedBook,
            section: originalTranslation.sectionTitle,
            translations: translationsForSave,
            translationMemory: translationMemoryForSave,
          }
        }

        if (complexity === 'original') {
          translation = originalTranslation
        } else {
          setOldBookStatus(`Rewriting page ${updatedBook.pageNumber} from Original English into ${selectedComplexity} ${selectedLanguage}...`)
          const rewrittenTranslation = await requestTextTranslation({
            endpoint: visionEndpoint,
            model: visionModel,
            bookTitle: updatedBook.title,
            pageNumber: updatedBook.pageNumber,
            complexityLabel: selectedComplexity,
            languageLabel: selectedLanguage,
            complexity,
            language: translationLanguage,
            originalParagraphs: originalTranslation.paragraphs,
            sourceLines: originalTranslation.sourceLines,
            glossary: [...getApprovedTranslationMemory(bookForTranslation), ...(originalTranslation.glossary ?? []), ...getPriorGlossary(bookForTranslation)],
            previousOriginalParagraphs: getPreviousOriginalTranslation(bookForTranslation, sourceExtractionModel)?.paragraphs,
            previousSourceLines: getPreviousOriginalTranslation(bookForTranslation, sourceExtractionModel)?.sourceLines,
            nextOriginalParagraphs: getNextOriginalTranslation(bookForTranslation, sourceExtractionModel)?.paragraphs,
            nextSourceLines: getNextOriginalTranslation(bookForTranslation, sourceExtractionModel)?.sourceLines,
            previousTranslatedParagraphs: getPreviousPageTranslation(bookForTranslation, complexity, translationLanguage, visionModel, sourceExtractionModel)?.paragraphs,
            signal: abortController.signal,
          })
          translation = createPageTranslationFromResult(
            bookForTranslation,
            rewrittenTranslation,
            complexity,
            translationLanguage,
            normalizedModelKey(originalTranslation.model) || sourceExtractionModel,
          )
          translationsForSave = replaceTranslationRecord(translationsForSave, translation)
        }
      }

      if (!translation) {
        translation = createTranslationRecord(bookForTranslation, complexity, translationLanguage, activeSection, {
          model: activeOutputModel,
          sourceModel: complexity === 'original' ? activeOutputModel : activeSourceModel,
        })
        translationsForSave = replaceTranslationRecord(translationsForSave, translation)
      } else if (complexity === 'original') {
        translationsForSave = replaceTranslationRecord(translationsForSave, translation)
      }

      const translatedPagesAfterSave = getTranslatedPageCount(
        { ...bookForTranslation, translations: translationsForSave },
        complexity,
        translationLanguage,
        activeOutputModel,
        complexity === 'original' ? activeOutputModel : activeSourceModel,
      )
      const updatedBook = await persistOldBook({
        ...bookForTranslation,
        section: translation.sectionTitle,
        status: 'Page translation stored',
        progress: bookForTranslation.pages
          ? Math.round((translatedPagesAfterSave / bookForTranslation.pages) * 100)
          : Math.max(bookForTranslation.progress, 1),
        translations: translationsForSave,
        translationMemory: translationMemoryForSave,
      })
      setActiveSection(translation.sectionTitle)
      setOldBookStatus(`Saved page ${translation.pageNumber} as ${selectedComplexity} ${selectedLanguage} for ${updatedBook.title}.`)
    } catch (error) {
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (translationAbortRef.current === abortController) {
        translationAbortRef.current = null
      }
      setOldBookBusy(false)
    }
  }

  async function translateAllPages() {
    if (!activeBook || !activePdfBlob) return

    translationAbortRef.current?.abort()
    const abortController = new AbortController()
    translationAbortRef.current = abortController
    setOldBookBusy(true)
    const now = new Date().toISOString()
    const canResumePreviousJob = !forceRetranslate && isAllPagesSelection(translationPageSelection)
    const reusableJob = canResumePreviousJob
      ? activeBook.translationJobs.find((entry) =>
        entry.kind === 'translate-all'
        && entry.complexity === complexity
        && entry.language === translationLanguage
        && entry.status !== 'complete'
      )
      : undefined
    let job: TranslationJobState = reusableJob
      ? {
        ...reusableJob,
        status: 'running',
        phase: reusableJob.phase === 'complete' ? 'snapshot' : reusableJob.phase,
        message: `Resuming Translate All from page ${Math.max(1, reusableJob.currentPage || 1)}...`,
        updatedAt: now,
      }
      : {
        id: createId(),
        kind: 'translate-all',
        status: 'running',
        complexity,
        language: translationLanguage,
        currentPage: activeBook.pageNumber,
        totalPages: activeBook.pages || 0,
        phase: 'snapshot',
        completedPages: 0,
        skippedPages: 0,
        message: forceRetranslate ? 'Starting forced translation...' : 'Starting bulk translation...',
        startedAt: now,
        updatedAt: now,
      }
    let workingBook: OldBookRecord = activeBook
    let updatedJob: TranslationJobState = job
    try {
      ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(activeBook, job))
      job = updatedJob
      let totalPages = workingBook.pages

      if (!totalPages) {
        ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
          ...job,
          currentPage: 1,
          totalPages: 0,
          phase: 'snapshot',
          message: 'Detecting PDF page count...',
        }))
        job = updatedJob
        const firstPage = await ensurePageSnapshot({ ...workingBook, pageNumber: 1 }, 1)
        workingBook = firstPage.updatedBook
        totalPages = firstPage.pageCount || firstPage.updatedBook.pages || 1
      }

      const selectedPages = parsePageSelection(translationPageSelection, totalPages)
      if (!selectedPages.length) {
        throw new Error('Choose at least one page to translate.')
      }

      const resumePage = job.phase === 'persist'
        ? (job.currentPage || 1) + 1
        : job.currentPage || 1
      const pagesToVisit = reusableJob && !forceRetranslate
        ? selectedPages.filter((pageNumber) => pageNumber >= Math.min(Math.max(1, resumePage), totalPages))
        : selectedPages
      let translatedCount = reusableJob && !forceRetranslate ? job.completedPages : 0
      let skippedCount = reusableJob && !forceRetranslate ? job.skippedPages : 0

      ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
        ...job,
        totalPages,
        completedPages: translatedCount,
        skippedPages: skippedCount,
        message: forceRetranslate
          ? `Force translating ${pagesToVisit.length} selected pages.`
          : `Translating ${pagesToVisit.length} selected pages; completed pages will be skipped.`,
      }))
      job = updatedJob

      for (let selectedIndex = 0; selectedIndex < pagesToVisit.length; selectedIndex += 1) {
        const pageNumber = pagesToVisit[selectedIndex]
        const selectedPosition = selectedIndex + 1
        let pageBook: OldBookRecord = {
          ...workingBook,
          pageNumber,
          section: getStoredTranslation(
            { ...workingBook, pageNumber },
            complexity,
            translationLanguage,
            `Page ${pageNumber}`,
            activeOutputModel,
            complexity === 'original' ? activeOutputModel : activeSourceModel,
          )
            ?.sectionTitle ?? `Page ${pageNumber}, OCR pending`,
        }

        const originalExists = Boolean(getCanonicalOriginalTranslation(pageBook, pageNumber, sourceExtractionModel))
        const targetExists = Boolean(pageBook.translations.find((entry) =>
          entry.pageNumber === pageNumber
          && entry.complexity === complexity
          && entry.language === translationLanguage
          && translationMatchesVariant(
            entry,
            activeOutputModel,
            complexity === 'original' ? activeOutputModel : activeSourceModel,
          )
        ))

        if (!forceRetranslate && originalExists && targetExists) {
          skippedCount += 1
          ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            skippedPages: skippedCount,
            phase: 'persist',
            message: `Skipping page ${pageNumber}; already translated (${selectedPosition} of ${pagesToVisit.length} selected).`,
          }))
          job = updatedJob
          continue
        }

        ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
          ...job,
          currentPage: pageNumber,
          totalPages,
          phase: 'snapshot',
          completedPages: translatedCount,
          skippedPages: skippedCount,
          message: `Preparing page ${pageNumber} (${selectedPosition} of ${pagesToVisit.length} selected)...`,
        }))
        job = updatedJob
        const { updatedBook, snapshot } = await ensurePageSnapshot(pageBook, pageNumber)
        pageBook = {
          ...updatedBook,
          translations: workingBook.translations,
          translationMemory: workingBook.translationMemory,
          pageSnapshots: updatedBook.pageSnapshots,
          pages: totalPages,
        }

        let translationsForSave = pageBook.translations
        let memoryForSave = pageBook.translationMemory
        let originalTranslation = getCanonicalOriginalTranslation(pageBook, pageNumber, sourceExtractionModel)

        if (!originalTranslation || (forceRetranslate && complexity === 'original')) {
          ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            phase: 'source',
            completedPages: translatedCount,
            skippedPages: skippedCount,
            message: `Transcribing source text for page ${pageNumber} (${selectedPosition} of ${pagesToVisit.length} selected)...`,
          }))
          job = updatedJob
          originalTranslation = await createOriginalTranslationFromSnapshot(
            pageBook,
            await getSnapshotImageDataUrl(snapshot),
            abortController.signal,
          )
          translationsForSave = replaceTranslationRecord(translationsForSave, originalTranslation)
          ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            phase: 'source',
            completedPages: translatedCount,
            skippedPages: skippedCount,
            message: `Reviewing glossary for page ${pageNumber} with ${llmRouterModel}...`,
          }))
          job = updatedJob
          memoryForSave = await reviewGlossaryIntoBookMemory(
            pageBook,
            memoryForSave,
            originalTranslation.glossary,
            abortController.signal,
          )
          pageBook = {
            ...pageBook,
            section: originalTranslation.sectionTitle,
            translations: translationsForSave,
            translationMemory: memoryForSave,
          }
        }

        if (complexity !== 'original' && (forceRetranslate || !targetExists)) {
          ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            phase: 'rewrite',
            completedPages: translatedCount,
            skippedPages: skippedCount,
            message: `Rewriting page ${pageNumber} (${selectedPosition} of ${pagesToVisit.length} selected) into ${selectedComplexity} ${selectedLanguage}...`,
          }))
          job = updatedJob
          const rewrittenTranslation = await requestTextTranslation({
            endpoint: visionEndpoint,
            model: visionModel,
            bookTitle: pageBook.title,
            pageNumber,
            complexityLabel: selectedComplexity,
            languageLabel: selectedLanguage,
            complexity,
            language: translationLanguage,
            originalParagraphs: originalTranslation.paragraphs,
            sourceLines: originalTranslation.sourceLines,
            glossary: [...getApprovedTranslationMemory(pageBook), ...(originalTranslation.glossary ?? []), ...getPriorGlossary(pageBook)],
            previousOriginalParagraphs: getPreviousOriginalTranslation(pageBook, sourceExtractionModel)?.paragraphs,
            previousSourceLines: getPreviousOriginalTranslation(pageBook, sourceExtractionModel)?.sourceLines,
            nextOriginalParagraphs: getNextOriginalTranslation(pageBook, sourceExtractionModel)?.paragraphs,
            nextSourceLines: getNextOriginalTranslation(pageBook, sourceExtractionModel)?.sourceLines,
            previousTranslatedParagraphs: getPreviousPageTranslation(pageBook, complexity, translationLanguage, visionModel, sourceExtractionModel)?.paragraphs,
            signal: abortController.signal,
          })
          const rewrittenRecord = createPageTranslationFromResult(
            pageBook,
            rewrittenTranslation,
            complexity,
            translationLanguage,
            normalizedModelKey(originalTranslation.model) || sourceExtractionModel,
          )
          translationsForSave = replaceTranslationRecord(translationsForSave, rewrittenRecord)
          pageBook = {
            ...pageBook,
            section: rewrittenRecord.sectionTitle,
            translations: translationsForSave,
          }
        }

        const pagesDone = getTranslatedPageCount(
          { ...pageBook, translations: translationsForSave },
          complexity,
          translationLanguage,
          activeOutputModel,
          complexity === 'original' ? activeOutputModel : activeSourceModel,
        )
        ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
          ...job,
          currentPage: pageNumber,
          totalPages,
          phase: 'persist',
          completedPages: translatedCount,
          skippedPages: skippedCount,
          message: `Saving page ${pageNumber} (${selectedPosition} of ${pagesToVisit.length} selected)...`,
        }))
        job = updatedJob
        workingBook = await persistOldBook({
          ...pageBook,
          pages: totalPages,
          status: 'Bulk translation in progress',
          progress: Math.round((pagesDone / totalPages) * 100),
          translations: translationsForSave,
          translationMemory: memoryForSave,
          translationJobs: [
            {
              ...job,
              completedPages: translatedCount + 1,
              skippedPages: skippedCount,
              message: `Saved page ${pageNumber} (${selectedPosition} of ${pagesToVisit.length} selected).`,
              updatedAt: new Date().toISOString(),
            },
            ...(pageBook.translationJobs ?? []).filter((entry) => entry.id !== job.id),
          ],
        })
        translatedCount += 1
        setActiveTranslationJob(workingBook.translationJobs[0] ?? null)
        await yieldToBrowser()
      }

      const completeJob: TranslationJobState = {
        ...job,
        status: 'complete',
        phase: 'complete',
        currentPage: selectedPages[selectedPages.length - 1] ?? totalPages,
        totalPages,
        completedPages: translatedCount,
        skippedPages: skippedCount,
        message: `Bulk translation complete. Updated ${translatedCount} pages, skipped ${skippedCount}.`,
        updatedAt: new Date().toISOString(),
      }
      workingBook = await persistOldBook({
        ...workingBook,
        status: completeJob.message,
        translationJobs: [
          completeJob,
          ...(workingBook.translationJobs ?? []).filter((entry) => entry.id !== completeJob.id),
        ],
      })
      setActiveTranslationJob(completeJob)
      setActiveBookId(workingBook.id)
      setActiveSection(workingBook.section)
      setOldBookStatus(completeJob.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedJob: TranslationJobState = {
        ...job,
        status: 'failed',
        error: message,
        message,
        updatedAt: new Date().toISOString(),
      }
      setOldBookStatus(message)
      setActiveTranslationJob(failedJob)
      try {
        await persistOldBook({
          ...workingBook,
          status: message,
          translationJobs: [
            failedJob,
            ...(workingBook.translationJobs ?? []).filter((entry) => entry.id !== failedJob.id),
          ],
        })
      } catch {
        // Keep the visible failure even if the follow-up status write also fails.
      }
    } finally {
      if (translationAbortRef.current === abortController) {
        translationAbortRef.current = null
      }
      setOldBookBusy(false)
    }
  }

  async function askActiveSection() {
    if (!activeBook || !question.trim()) return

    translationAbortRef.current?.abort()
    const abortController = new AbortController()
    translationAbortRef.current = abortController
    setOldBookBusy(true)
    try {
      let bookForQuestion = activeBook
      let answerText: string | undefined

      if (activeBook.pdfBlobId) {
        const { updatedBook, snapshot } = await ensureActivePageSnapshot(activeBook)
        bookForQuestion = updatedBook
        const visionAnswer = await requestVisionAnswer({
          endpoint: visionEndpoint,
          model: visionModel,
          imageDataUrl: await getSnapshotImageDataUrl(snapshot),
          bookTitle: updatedBook.title,
          pageNumber: updatedBook.pageNumber,
          sectionTitle: translationHeaderTitle,
          question: question.trim(),
          complexityLabel: selectedComplexity,
          languageLabel: selectedLanguage,
          translatedParagraphs,
          signal: abortController.signal,
        })
        answerText = visionAnswer.answer
      }

      const answer = createQuestionRecord(bookForQuestion, complexity, translationLanguage, translationHeaderTitle, question.trim(), answerText)
      await persistOldBook({
        ...bookForQuestion,
        questions: [answer, ...bookForQuestion.questions],
      })
      setLatestAnswer(answer)
      setOldBookStatus('Saved the section question and answer.')
    } catch (error) {
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (translationAbortRef.current === abortController) {
        translationAbortRef.current = null
      }
      setOldBookBusy(false)
    }
  }

  async function autoReviewBookGlossary() {
    if (!activeBook) return

    const candidates = activeBook.translations
      .flatMap((translation) => translation.glossary ?? [])
      .filter((entry) => entry.sourceTerm.trim() || entry.translatedTerm.trim())

    if (!candidates.length) {
      setOldBookStatus('No page vocabulary is available to review yet.')
      return
    }

    setOldBookBusy(true)
    try {
      setOldBookStatus(`Reviewing ${candidates.length} glossary candidates with ${llmRouterModel}...`)
      const reviewedMemory = await reviewGlossaryIntoBookMemory(
        activeBook,
        activeBook.translationMemory,
        candidates,
      )
      const reviewedBook = await persistOldBook({
        ...activeBook,
        translationMemory: reviewedMemory,
        status: 'Book glossary reviewed',
      })
      const approvedCount = reviewedBook.translationMemory.filter((entry) => entry.approved).length
      setOldBookStatus(`Book glossary reviewed. ${approvedCount} approved terms are available for future pages.`)
    } catch (error) {
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setOldBookBusy(false)
    }
  }

  async function setMemoryApproval(memoryEntry: TranslationMemoryEntry, approved: boolean) {
    if (!activeBook) return
    const now = new Date().toISOString()
    const key = glossaryKey(memoryEntry.sourceTerm, memoryEntry.translatedTerm)
    const existing = activeBook.translationMemory.find((entry) =>
      entry.id === memoryEntry.id || glossaryKey(entry.sourceTerm, entry.translatedTerm) === key
    )
    const nextEntry: TranslationMemoryEntry = existing
      ? { ...existing, approved, updatedAt: now }
      : {
        ...memoryEntry,
        id: createId(),
        approved,
        createdAt: now,
        updatedAt: now,
      }
    const nextMemory = existing
      ? activeBook.translationMemory.map((entry) => (entry.id === existing.id ? nextEntry : entry))
      : [...activeBook.translationMemory, nextEntry]

    await persistOldBook({
      ...activeBook,
      translationMemory: nextMemory,
      status: 'Translation memory updated',
    })
    setOldBookStatus(`${approved ? 'Approved' : 'Unapproved'} term: ${nextEntry.translatedTerm || nextEntry.sourceTerm}.`)
  }

  async function buildExportSnapshotImages(bookForExport: OldBookRecord) {
    const snapshotImages = new Map<number, string>()

    await Promise.all(bookForExport.pageSnapshots.map(async (snapshot) => {
      if (snapshot.imageDataUrl) {
        snapshotImages.set(snapshot.pageNumber, snapshot.imageDataUrl)
        return
      }

      if (!snapshot.filePath) return

      try {
        snapshotImages.set(snapshot.pageNumber, await getOldBookFileDataUrl(snapshot.filePath))
      } catch {
        // Keep the export usable even if a stale snapshot record points to a missing file.
      }
    }))

    return snapshotImages
  }

  async function buildActiveBookExportHtml() {
    if (!activeBook) return null
    const shouldExportTargetLanguage = translationLanguage !== 'en'
    const exportLanguageLabel = languageOptions.find((entry) => entry.value === translationLanguage)?.label ?? selectedLanguage
    const snapshotImages = shouldExportTargetLanguage ? new Map<number, string>() : await buildExportSnapshotImages(activeBook)
    const html = shouldExportTargetLanguage
      ? buildLanguageBookExportHtml(activeBook, translationLanguage, exportLanguageLabel)
      : buildEnglishBookExportHtml(activeBook, snapshotImages)
    const fileName = shouldExportTargetLanguage
      ? `${slugifyFileName(activeBook.title)}-${slugifyFileName(exportLanguageLabel)}-book.html`
      : `${slugifyFileName(activeBook.title)}-english-book.html`
    const title = shouldExportTargetLanguage
      ? `${activeBook.title} - ${exportLanguageLabel} export`
      : `${activeBook.title} - English export`

    return { html, fileName, title }
  }

  async function inspectPortablePackageFile(file: File) {
    setPackageInspector({
      open: true,
      fileName: file.name,
      status: 'Reading package...',
      files: [],
      validation: [],
      pages: [],
      translations: [],
    })

    try {
      const packageFiles = parseZipPackage(new Uint8Array(await file.arrayBuffer()))
      const manifestBytes = packageFiles.get('manifest.json')
      if (!manifestBytes) throw new Error('manifest.json is missing.')
      const manifest = parseJsonBytes<PortableBookPackage>(manifestBytes)
      if (manifest.schemaVersion !== '1.0.0') throw new Error(`Unsupported schema version: ${manifest.schemaVersion}`)

      const validation = await Promise.all((manifest.files ?? []).map(async (entry) => {
        const bytes = packageFiles.get(entry.path)
        if (!bytes) return { path: entry.path, status: 'missing' as const, detail: 'File is listed in manifest but missing from archive.' }
        const actualHash = `sha256:${await sha256HexBytes(bytes)}`
        if (actualHash !== entry.sha256) {
          return { path: entry.path, status: 'mismatch' as const, detail: `Expected ${entry.sha256}, found ${actualHash}.` }
        }
        return { path: entry.path, status: 'ok' as const, detail: `${entry.sizeBytes.toLocaleString()} bytes` }
      }))
      const pagesBytes = packageFiles.get('content/pages.json')
      const pages = pagesBytes ? parseJsonBytes<PortableBookPage[]>(pagesBytes) : []
      const translationFiles = Array.from(packageFiles.entries())
        .filter(([path]) => path.startsWith('content/translations.') && path.endsWith('.json'))
        .sort(([left], [right]) => left.localeCompare(right))
      const translations = translationFiles.map(([path, bytes]) => {
        const language = path.replace(/^content\/translations\./, '').replace(/\.json$/, '')
        const pageRows = parseJsonBytes<{ pageNumber: number, translations: PortablePageTranslation[] }[]>(bytes)
        const flatTranslations = pageRows.flatMap((row) => row.translations)
        return {
          language,
          pageCount: pageRows.length,
          translationCount: flatTranslations.length,
          sample: flatTranslations[0],
        }
      })
      const mismatchCount = validation.filter((entry) => entry.status !== 'ok').length

      setPackageInspector({
        open: true,
        fileName: file.name,
        status: mismatchCount ? `${mismatchCount} validation issue${mismatchCount === 1 ? '' : 's'} found.` : 'Package validated.',
        manifest,
        files: manifest.files ?? [],
        validation,
        pages,
        translations,
      })
      setOldBookStatus(`Inspected ${file.name}: ${mismatchCount ? `${mismatchCount} validation issue(s)` : 'valid package'}.`)
    } catch (error) {
      setPackageInspector((current) => ({
        ...current,
        open: true,
        status: 'Package inspection failed.',
        error: error instanceof Error ? error.message : String(error),
      }))
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function exportActiveBookAsPortablePackage(scope: PortablePackageExportScope) {
    if (!activeBook) return
    const scopeLabel = scope.kind === 'all'
      ? 'all languages'
      : languageOptions.find((entry) => entry.value === scope.language)?.label ?? scope.language
    setOldBookStatus(`Preparing ${scopeLabel} portable book package...`)
    const snapshotImages = await buildExportSnapshotImages(activeBook)
    const basePackage = buildPortableBookPackage(activeBook, scope, snapshotImages, packageMetadata, packageAssetOptions)
    const packagePages = basePackage.book.pages.map((page) => page.pageNumber).sort((left, right) => left - right)
    const volumeRanges = packageVolumeRanges(packagePages, packageAssetOptions.pagesPerVolume)
    let sourcePdfBlob: Blob | null = null

    if (packageAssetOptions.includeSourcePdf && activeBook.pdfBlobId) {
      try {
        sourcePdfBlob = await getOldBookPdfBlob(activeBook.pdfBlobId)
      } catch {
        // The package is still useful without the original PDF.
      }
    }

    for (const volumeRange of volumeRanges) {
      const volume = volumeRanges.length > 1
        ? {
            index: volumeRange.index,
            total: volumeRange.total,
            pageStart: volumeRange.pages[0] ?? 1,
            pageEnd: volumeRange.pages[volumeRange.pages.length - 1] ?? 1,
          }
        : undefined
      const packagePayload = buildPortableBookPackage(activeBook, scope, snapshotImages, packageMetadata, packageAssetOptions, volume)
      const fileName = `${slugifyFileName(activeBook.title)}-${scope.kind === 'all' ? 'all-languages' : slugifyFileName(scopeLabel)}${volume ? `-vol-${volume.index}-of-${volume.total}` : ''}.bookpkg`
      const files = await buildPortablePackageFiles(packagePayload, packageAssetOptions, sourcePdfBlob)
      downloadBlobFile(fileName, createZipBlob(files))
      await yieldToBrowser()
    }
    setOldBookStatus(`${scopeLabel} portable book package exported${volumeRanges.length > 1 ? ` in ${volumeRanges.length} volumes` : ''}.`)
  }

  async function exportActiveBookAsEpub() {
    if (!activeBook) return
    const languageLabel = languageOptions.find((entry) => entry.value === translationLanguage)?.label ?? translationLanguage
    setOldBookStatus(`Preparing ${languageLabel} EPUB...`)
    const basePackage = buildPortableBookPackage(
      activeBook,
      { kind: 'language', language: translationLanguage },
      new Map<number, string>(),
      packageMetadata,
      { ...packageAssetOptions, includeSnapshots: false, includeThumbnails: false, includeSourcePdf: false },
    )
    const fileName = `${slugifyFileName(activeBook.title)}-${slugifyFileName(languageLabel)}-${slugifyFileName(complexity)}.epub`
    const files = buildPortableEpubFiles(basePackage, translationLanguage, languageLabel, complexity)
    downloadBlobFile(fileName, createZipBlob(files, 'application/epub+zip'))
    setOldBookStatus(`${languageLabel} EPUB exported.`)
  }

  async function exportActiveBookAsPdf() {
    if (!activeBook) return
    const languageLabel = languageOptions.find((entry) => entry.value === translationLanguage)?.label ?? translationLanguage
    setOldBookStatus(`Preparing ${languageLabel} print/PDF export...`)
    const basePackage = buildPortableBookPackage(
      activeBook,
      { kind: 'language', language: translationLanguage },
      new Map<number, string>(),
      packageMetadata,
      { ...packageAssetOptions, includeSnapshots: false, includeThumbnails: false, includeSourcePdf: false },
    )
    const html = buildPortablePrintHtml(basePackage, translationLanguage, languageLabel, complexity)
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      downloadTextFile(
        `${slugifyFileName(activeBook.title)}-${slugifyFileName(languageLabel)}-print.html`,
        html,
        'text/html;charset=utf-8',
      )
      setOldBookStatus('Popup blocked. Downloaded print-ready HTML; open it and choose Save as PDF.')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    setOldBookStatus('Print/PDF export opened. Choose Save as PDF in the print dialog.')
  }

  async function exportActiveBookAsHtml() {
    if (!activeBook) return
    setOldBookStatus('Preparing HTML export...')
    const exportPayload = await buildActiveBookExportHtml()
    if (!exportPayload) return
    const { html, fileName } = exportPayload

    invoke('export_old_book_html', {
      bookId: activeBook.id,
      fileName,
      html,
      reveal: true,
    })
      .then((filePath) => {
        setOldBookStatus(`Exported and revealed: ${filePath}`)
      })
      .catch((error) => {
        if (!isTauriUnavailable(error)) {
          setOldBookStatus(error instanceof Error ? error.message : String(error))
          return
        }

        downloadTextFile(fileName, html, 'text/html;charset=utf-8')
        setOldBookStatus('Exported through the browser download folder.')
      })
  }

  async function renderActiveBookExport() {
    if (!activeBook) return
    setOldBookStatus('Rendering live export...')
    const exportPayload = await buildActiveBookExportHtml()
    if (!exportPayload) return
    setLiveExportHtml(exportPayload.html)
    setLiveExportTitle(exportPayload.title)
    setLiveExportOpen(true)
    setOldBookStatus('Live export render ready.')
  }

  async function exposeActiveBookExportUrl() {
    if (!activeBook) return
    setOldBookStatus('Preparing browser export URL...')
    const exportPayload = await buildActiveBookExportHtml()
    if (!exportPayload) return
    const { html, fileName } = exportPayload

    try {
      await invoke('export_old_book_html', {
        bookId: activeBook.id,
        fileName,
        html,
        reveal: false,
      })
      const urlInfo = await invoke('old_book_export_http_url', {
        bookId: activeBook.id,
        fileName,
      }) as { localUrl: string, networkUrl?: string | null, port: number }
      const preferredUrl = urlInfo.networkUrl || urlInfo.localUrl
      try {
        await navigator.clipboard?.writeText(preferredUrl)
      } catch {
        // Clipboard can be unavailable depending on host permissions.
      }
      setOldBookStatus(
        `Browser URL copied: ${preferredUrl}${urlInfo.networkUrl ? ` · Mac-only URL: ${urlInfo.localUrl}` : ''}`,
      )
    } catch (error) {
      if (isTauriUnavailable(error)) {
        setOldBookStatus('Browser URL is available only in the Tauri app.')
        return
      }
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function browseActiveBookExports() {
    if (!activeBook) return
    try {
      const exportDir = await invoke('browse_old_book_exports', {
        bookId: activeBook.id,
      }) as string
      setOldBookStatus(`Opened export folder: ${exportDir}`)
    } catch (error) {
      if (isTauriUnavailable(error)) {
        setOldBookStatus('Browse Files is available only in the Tauri app.')
        return
      }
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function exposeActiveBookExportApiUrl() {
    if (!activeBook) return
    setOldBookStatus('Preparing export API URL...')

    try {
      if (activeBook.translations.length) {
        const exportPayload = await buildActiveBookExportHtml()
        if (exportPayload) {
          await invoke('export_old_book_html', {
            bookId: activeBook.id,
            fileName: exportPayload.fileName,
            html: exportPayload.html,
            reveal: false,
          })
        }
      }

      const urlInfo = await invoke('old_book_export_api_url', {
        bookId: activeBook.id,
      }) as { localUrl: string, networkUrl?: string | null, port: number }
      const preferredUrl = urlInfo.networkUrl || urlInfo.localUrl
      try {
        await navigator.clipboard?.writeText(preferredUrl)
      } catch {
        // Clipboard can be unavailable depending on host permissions.
      }
      setOldBookStatus(
        `Export API URL copied: ${preferredUrl}${urlInfo.networkUrl ? ` · Mac-only URL: ${urlInfo.localUrl}` : ''}`,
      )
    } catch (error) {
      if (isTauriUnavailable(error)) {
        setOldBookStatus('Export API is available only in the Tauri app.')
        return
      }
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function selectOldBook(bookId: string) {
    const selectedBook = oldBooks.find((entry) => entry.id === bookId)
    if (!selectedBook) return
    setActiveBookId(selectedBook.id)
    setActiveSection(selectedBook.pdfBlobId ? selectedBook.section : 'Opening argument')
    setActiveSnapshotPage(selectedBook.pageNumber)
    setLatestAnswer(null)
  }

  return (
    <main className="translation-view">
      <section className="translation-toolbar panel compact">
        <input
          id="old-book-pdf-import"
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="visually-hidden-input"
          onChange={(event) => void handlePdfSelected(event)}
        />
        <input
          id="book-package-import"
          type="file"
          accept=".bookpkg,application/zip,application/vnd.portable-translation-book+zip"
          className="visually-hidden-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void inspectPortablePackageFile(file)
          }}
        />
        <div className="translation-compact-bar">
          <div className="translation-compact-row translation-compact-row-primary">
          <div className="translation-title-block">
            <p className="app-overline">Translation Lab</p>
            <h2>Public-domain old book reader</h2>
          </div>

          <label className="translation-book-field">
            <span>Book</span>
            <select value={activeBook?.id ?? ''} onChange={(event) => selectOldBook(event.currentTarget.value)}>
              {oldBooks.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title} · {entry.pages || 'pages pending'} pages
                </option>
              ))}
            </select>
          </label>

          <label className="translation-language-field">
            <span>Language</span>
            <select
              value={translationLanguage}
              onChange={(event) => setLanguage(event.currentTarget.value as TranslationLanguage)}
              disabled={complexity === 'original'}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="translation-complexity-field">
            <span>Complexity</span>
            <select
              value={complexity}
              onChange={(event) => {
                const nextComplexity = event.currentTarget.value as TranslationComplexity
                setComplexity(nextComplexity)
                if (nextComplexity === 'original') setLanguage('en')
              }}
            >
              {complexityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          </div>

          <div className="translation-compact-row translation-compact-row-secondary">
          <label className="translation-endpoint-field">
            <span>Endpoint</span>
            <div className="translation-inline-field">
              <input value={visionEndpoint} onChange={(event) => setVisionEndpoint(event.currentTarget.value)} />
              <button
                className="mini-button"
                onClick={() => {
                  setVisionEndpoint(llmRouterEndpoint)
                  setVisionModel(llmRouterModel)
                  setSourceExtractionModel(llmRouterSourceModel)
                  setOldBookStatus('Using the BookForge LLM router at /api/llm-router/v1.')
                  void refreshVisionModels(llmRouterEndpoint, llmRouterModel, llmRouterSourceModel)
                }}
                type="button"
              >
                Router
              </button>
            </div>
          </label>

          <label className="translation-model-field">
            <span>Model</span>
            <div className="translation-inline-field">
              <select value={visionModel} onChange={(event) => setVisionModel(event.currentTarget.value)}>
                {visionModelOptions.length ? (
                  visionModelOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.id}</option>
                  ))
                ) : (
                  <option value={visionModel}>{visionModel || 'No model loaded'}</option>
                )}
              </select>
              <button
                className="mini-button"
                onClick={() => void refreshVisionModels()}
                disabled={visionModelsLoading}
                type="button"
              >
                {visionModelsLoading ? '...' : 'Refresh'}
              </button>
            </div>
          </label>

          <label className="translation-source-model-field">
            <span>Source Model</span>
            <select value={sourceExtractionModel} onChange={(event) => setSourceExtractionModel(event.currentTarget.value)}>
              {sourceExtractionModelOptions.length ? (
                sourceExtractionModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.id}</option>
                ))
              ) : (
                <option value={sourceExtractionModel}>{sourceExtractionModel || 'No model loaded'}</option>
              )}
            </select>
          </label>

          <label className="translation-page-field">
            <span>Pages</span>
            <input
              value={translationPageSelection}
              onChange={(event) => setTranslationPageSelection(event.currentTarget.value)}
              placeholder="all or 1-20, 42"
              disabled={oldBookBusy}
            />
          </label>

          <div className="translation-actions compact-actions">
            <label className="button secondary import-file-button" htmlFor="old-book-pdf-import">
              PDF Import
            </label>
            {oldBookBusy ? (
              <button
                className="button danger"
                onClick={stopTranslationRequest}
                type="button"
              >
                Stop
              </button>
            ) : null}
            <button
              className="button secondary"
              onClick={resetTranslationControls}
              type="button"
            >
              Reset
            </button>
            <button
              className="button secondary"
              onClick={() => void snapshotAllPages()}
              disabled={oldBookBusy || !activeBook?.pdfBlobId}
              type="button"
            >
              {hasRunningSnapshotJob ? 'Resume Snapshots' : 'Snapshot All'}
            </button>
            <label className="force-retranslate-toggle">
              <input
                type="checkbox"
                checked={forceRetranslate}
                onChange={(event) => setForceRetranslate(event.currentTarget.checked)}
                disabled={oldBookBusy}
              />
              <span>Force</span>
            </label>
            <button
              className="button secondary"
              onClick={() => void translateAllPages()}
              disabled={oldBookBusy || !activeBook?.pdfBlobId}
              type="button"
            >
              {forceRetranslate ? 'Force Retranslate' : hasResumableTranslationJob && isAllPagesSelection(translationPageSelection) ? 'Resume Translate' : 'Translate Pages'}
            </button>
            <button
              className="button secondary"
              onClick={() => setMemoryOpen(true)}
              disabled={!activeBook}
              type="button"
            >
              Memory
            </button>
            <button
              className="button secondary"
              onClick={exportActiveBookAsHtml}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              Export
            </button>
            <button
              className="button secondary"
              onClick={() => setPackageSettingsOpen(true)}
              type="button"
            >
              Package Settings
            </button>
            <button
              className="button secondary"
              onClick={() => void exportActiveBookAsPortablePackage({ kind: 'language', language: translationLanguage })}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              Language Package
            </button>
            <button
              className="button secondary"
              onClick={() => void exportActiveBookAsPortablePackage({ kind: 'all', defaultLanguage: translationLanguage })}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              All Languages
            </button>
            <button
              className="button secondary"
              onClick={() => void exportActiveBookAsEpub()}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              EPUB
            </button>
            <button
              className="button secondary"
              onClick={() => void exportActiveBookAsPdf()}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              PDF / Print
            </button>
            <label className="button secondary import-file-button" htmlFor="book-package-import">
              Inspect Package
            </label>
            <button
              className="button secondary"
              onClick={() => void renderActiveBookExport()}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              Live Render
            </button>
            <button
              className="button secondary"
              onClick={() => void exposeActiveBookExportUrl()}
              disabled={!activeBook?.translations.length}
              type="button"
            >
              Browser URL
            </button>
            <button
              className="button secondary"
              onClick={() => void exposeActiveBookExportApiUrl()}
              disabled={!activeBook}
              type="button"
            >
              API URL
            </button>
            <button
              className="button secondary"
              onClick={() => void browseActiveBookExports()}
              disabled={!activeBook}
              type="button"
            >
              Browse Files
            </button>
            <button
              className="button secondary"
              onClick={openAllSnapshots}
              disabled={!sortedSnapshots.length}
              type="button"
            >
              Snapshots
            </button>
          </div>
          </div>
        </div>

        <div className="translation-toolbar-meta">
          <span>{activeBook?.dateLabel ?? 'Unknown date'} · {activeBook?.originalLanguage ?? 'Unknown language'} · {activeBook?.status ?? 'Ready'}</span>
          {visionModelsStatus ? <span>{visionModelsStatus}</span> : null}
          {oldBookStatus ? <span className="translation-current-status">{oldBookStatus}</span> : null}
        </div>
        {snapshotProgress ? (
          <div className="snapshot-progress-strip">
            <div className="snapshot-progress-copy">
              <strong>{snapshotProgress.phase === 'complete' ? 'Snapshots complete' : snapshotProgress.phase === 'saving' ? 'Saving snapshots' : snapshotProgress.phase === 'rendering' ? 'Rendering snapshots' : 'Preparing snapshots'}</strong>
              <span>{snapshotProgress.message}</span>
              <span>{snapshotProgress.current} of {snapshotProgress.total || '?'}</span>
            </div>
            <div className="snapshot-progress-track" aria-label="Snapshot progress">
              <span style={{ width: `${snapshotProgressPercent}%` }} />
            </div>
          </div>
        ) : null}
        {displayedSnapshotJob ? (
          <div className="translation-job-strip">
            <strong>{displayedSnapshotJob.status === 'running' ? 'Snapshot All resumable' : `Snapshot All ${displayedSnapshotJob.status}`}</strong>
            <span>Page {displayedSnapshotJob.currentPage || 1} of {displayedSnapshotJob.totalPages || activePageCount}</span>
            <span>{displayedSnapshotJob.phase}</span>
            <span>{displayedSnapshotJob.completedPages} saved · {displayedSnapshotJob.skippedPages} skipped</span>
            <span>{displayedSnapshotJob.message}</span>
          </div>
        ) : null}
        {displayedTranslationJob ? (
          <div className="translation-job-strip">
            <strong>{displayedTranslationJob.status === 'running' ? 'Translate All running' : `Translate All ${displayedTranslationJob.status}`}</strong>
            <span>Page {displayedTranslationJob.currentPage || 1} of {displayedTranslationJob.totalPages || activePageCount}</span>
            <span>{displayedTranslationJob.phase}</span>
            <span>{displayedTranslationJob.completedPages} saved · {displayedTranslationJob.skippedPages} skipped</span>
            <span>{displayedTranslationJob.message}</span>
          </div>
        ) : null}
      </section>

      <section className="translation-reader-grid" aria-label="Side by side reader">
        <article className="translation-pane pdf-pane">
          <header className="translation-pane-header">
            <div>
              <p className="app-overline">Original PDF</p>
              <h2>{activeBook?.title ?? 'Old book'}</h2>
              <p>
                {activeBook?.author ?? 'Unknown'} · {activeBook?.section ?? `Page ${activePageNumber}`}
                {activeBook?.pdfBlobId ? ` · ${activePageSnapshot ? 'Snapshot ready' : 'Snapshot needed'}` : ''}
              </p>
            </div>
            <div className="reader-page-controls" aria-label="Current PDF page">
              <button
                className="mini-button"
                onClick={() => void setReaderPage(activePageNumber - 1)}
                disabled={oldBookBusy || activePageNumber <= 1}
                type="button"
              >
                -
              </button>
              <label>
                <span>Page</span>
                <input
                  type="number"
                  min="1"
                  max={activePageLimit}
                  value={activePageNumber}
                  onChange={(event) => void setReaderPage(Number(event.currentTarget.value))}
                  disabled={oldBookBusy || !activeBook}
                />
              </label>
              <span>{activePageLimit ? `of ${activePageLimit}` : ''}</span>
              <button
                className="mini-button"
                onClick={() => void setReaderPage(activePageNumber + 1)}
                disabled={oldBookBusy || Boolean(activePageLimit && activePageNumber >= activePageLimit)}
                type="button"
              >
                +
              </button>
            </div>
          </header>

          <div className="pdf-viewer-shell">
            {activePageSnapshot ? (
              <div className="pdf-page-stage active-snapshot">
                <img src={getSnapshotImageSrc(activePageSnapshot)} alt={`Snapshot of page ${activePageNumber}`} />
              </div>
            ) : activePdfFrameSrc ? (
              <iframe
                key={activePdfFrameSrc}
                className="pdf-frame"
                src={activePdfFrameSrc}
                title={`${activeBook?.title ?? 'Imported PDF'} preview`}
              />
            ) : (
              <div className="pdf-page-stage">
                <img src={antiqueFolioUrl} alt="Mock scanned page from an old public-domain book" />
                <button className="source-hotspot" onClick={() => setActiveSection('Opening argument')} type="button">
                  Opening argument
                </button>
              </div>
            )}
          </div>

          {visibleSourceLines.length ? (
            <div className="ocr-strip">
              {visibleSourceLines.map((line) => (
                <button key={line} onClick={() => setActiveSection(line.slice(0, 28))} type="button">
                  {line}
                </button>
              ))}
            </div>
          ) : null}
        </article>

        <article className="translation-pane translated-pane">
          <header className="translation-pane-header">
            <div>
              <p className="app-overline">{selectedComplexity} {selectedLanguage}</p>
              <h2>{translationHeaderTitle}</h2>
              <p>
                {activeTranslation ? 'Stored page translation' : 'Page translation pending'} · Page {activePageNumber}
                {activeTranslation ? ` · Model ${getTranslationModelLabel(activeTranslation)}` : ''}
              </p>
            </div>
            <div className="progress-summary">
              <span>{currentProgress}%</span>
              <div aria-hidden="true"><i style={{ width: `${currentProgress}%` }} /></div>
            </div>
          </header>

          {activeTranslationVariants.length > 1 ? (
            <div className="translation-variant-strip" aria-label="Stored translation variants">
              {activeTranslationVariants.map((translation) => {
                const isActive = activeTranslation?.id === translation.id
                return (
                  <button
                    key={translation.id}
                    className={isActive ? 'translation-variant-chip active' : 'translation-variant-chip'}
                    onClick={() => {
                      if (translation.complexity === 'original') {
                        if (translation.model) setSourceExtractionModel(translation.model)
                      } else {
                        if (translation.sourceModel) setSourceExtractionModel(translation.sourceModel)
                        if (translation.model) setVisionModel(translation.model)
                      }
                    }}
                    type="button"
                  >
                    {translationVariantLabel(translation)}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="page-action-bar">
            <div className="page-action-status">
              <strong>Page {activePageNumber}</strong>
              <span>
                {activeTranslation
                  ? `${selectedLanguage} saved · Snapshot ready`
                  : activePageSnapshot
                    ? 'Snapshot ready · Translate Page will reuse it'
                    : 'Snapshot needed'}
              </span>
              {hasImportedPdf ? (
                <small>
                  {translatedPageCount} of {activePageCount} pages translated
                  {complexity !== 'original' ? ` · ${canonicalOriginalTranslation ? 'Original source ready' : 'Original source needed'}` : ''}
                </small>
              ) : null}
            </div>
            <div className="page-action-buttons">
              <button
                className="button secondary"
                onClick={() => setSourceInspectorOpen(true)}
                disabled={!currentSourceLines.length && !previousSourceLines.length && !nextSourceLines.length && !goodFaithParagraphs.length}
                type="button"
              >
                Source OCR
              </button>
              <button
                className="button secondary"
                onClick={openActivePageSnapshot}
                disabled={!activePageSnapshot}
                type="button"
              >
                View Snapshot
              </button>
              <button
                className="button secondary"
                onClick={() => void snapshotActivePage()}
                disabled={oldBookBusy || !activeBook?.pdfBlobId}
                type="button"
              >
                {activePageSnapshot ? 'Re-snapshot Page' : 'Snapshot Page'}
              </button>
              <button
                className="button"
                onClick={() => void translateActivePage()}
                disabled={oldBookBusy || !activeBook}
                type="button"
              >
                {oldBookBusy ? 'Working...' : 'Translate Page'}
              </button>
            </div>
          </div>

          <aside className="question-panel">
            <div className="question-panel-header">
              <div>
                <h3>{hasImportedPdf ? 'Ask this page' : 'Ask this section'}</h3>
              </div>
              <span>Local notes</span>
            </div>
            <div className="question-input-row">
              <input value={question} onChange={(event) => setQuestion(event.currentTarget.value)} />
              <button className="button" onClick={() => void askActiveSection()} disabled={oldBookBusy || !question.trim()} type="button">
                Ask
              </button>
            </div>
            {activeQuestion ? <div className="answer-preview">{activeQuestion.answer}</div> : null}
          </aside>

          {hasImportedPdf ? (
            activeTranslation?.sourceLines.length ? (
              <div className="section-tools">
                {activeTranslation.sourceLines.slice(0, 6).map((line, index) => (
                  <button
                    key={`${line}-${index}`}
                    className="section-chip"
                    onClick={() => setActiveSection(line.slice(0, 42))}
                    type="button"
                  >
                    {line}
                  </button>
                ))}
              </div>
            ) : null
          ) : (
            <div className="section-tools">
              <button
                className={activeSection === 'Opening argument' ? 'section-chip active' : 'section-chip'}
                onClick={() => setActiveSection('Opening argument')}
                type="button"
              >
                Opening argument
              </button>
              <button
                className={activeSection === 'Historical note' ? 'section-chip active' : 'section-chip'}
                onClick={() => setActiveSection('Historical note')}
                type="button"
              >
                Historical note
              </button>
              <button
                className={activeSection === 'Vocabulary' ? 'section-chip active' : 'section-chip'}
                onClick={() => setActiveSection('Vocabulary')}
                type="button"
              >
                Vocabulary
              </button>
            </div>
          )}

          <div className="translated-reading-surface">
            {activeTranslation?.complexity === 'concept-guide' ? (
              <MarkdownishContent markdown={translatedParagraphs.join('\n\n')} />
            ) : (
              translatedParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))
            )}

            {activeTranslation?.glossary?.length ? (
              <section className="page-vocabulary-panel" aria-label="Page vocabulary">
                <header>
                  <h3>Page Vocabulary</h3>
                  <span>{activeTranslation.glossary.length} terms</span>
                </header>
                <dl>
                  {activeTranslation.glossary.map((entry, index) => (
                    <div key={`${entry.sourceTerm}-${entry.translatedTerm}-${index}`}>
                      <dt>
                        {entry.sourceTerm}
                        {entry.translatedTerm && entry.translatedTerm !== entry.sourceTerm ? (
                          <span>{entry.translatedTerm}</span>
                        ) : null}
                      </dt>
                      {entry.englishTerm || entry.targetTerm || entry.transliteration ? (
                        <dd className="vocabulary-meta">
                          {entry.englishTerm ? <span><strong>English:</strong> {entry.englishTerm}</span> : null}
                          {entry.targetTerm ? <span><strong>Target:</strong> {entry.targetTerm}</span> : null}
                          {entry.transliteration ? <span><strong>Transliteration:</strong> {entry.transliteration}</span> : null}
                        </dd>
                      ) : null}
                      {entry.explanation ? <dd>{entry.explanation}</dd> : null}
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {activeTranslation?.notes?.length ? (
              <section className="page-notes-panel" aria-label="Translator notes">
                <h3>Translator Notes</h3>
                <ul>
                  {activeTranslation.notes.map((note, index) => (
                    <li key={`${note}-${index}`}>{note}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </article>
      </section>

      {packageSettingsOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel package-settings-modal">
            <header className="modal-header">
              <div>
                <h2>Package Settings</h2>
                <p>Publisher metadata, asset strategy, and volume splitting for `.bookpkg` export.</p>
              </div>
              <button className="icon-button" onClick={() => setPackageSettingsOpen(false)} type="button">x</button>
            </header>
            <div className="package-settings-grid">
              <label>
                <span>Publisher</span>
                <input
                  value={packageMetadata.publisherName}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, publisherName: event.currentTarget.value }))}
                  placeholder="TamilSteam"
                />
              </label>
              <label>
                <span>Version</span>
                <input
                  value={packageMetadata.version}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, version: event.currentTarget.value }))}
                />
              </label>
              <label>
                <span>Revision</span>
                <input
                  type="number"
                  min="1"
                  value={packageMetadata.revision}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, revision: Number(event.currentTarget.value) || 1 }))}
                />
              </label>
              <label>
                <span>License</span>
                <input
                  value={packageMetadata.license}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, license: event.currentTarget.value }))}
                />
              </label>
              <label>
                <span>Rights Status</span>
                <input
                  value={packageMetadata.rightsStatus}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, rightsStatus: event.currentTarget.value }))}
                />
              </label>
              <label>
                <span>Source URL</span>
                <input
                  value={packageMetadata.sourceUrl}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, sourceUrl: event.currentTarget.value }))}
                  placeholder="https://..."
                />
              </label>
              <label className="package-settings-wide">
                <span>Changelog</span>
                <textarea
                  value={packageMetadata.changelog}
                  onChange={(event) => setPackageMetadata((current) => ({ ...current, changelog: event.currentTarget.value }))}
                  rows={3}
                  placeholder="Translation review notes, corrections, or release summary."
                />
              </label>
            </div>
            <div className="package-options-grid">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={packageAssetOptions.includeSourcePdf}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, includeSourcePdf: event.currentTarget.checked }))}
                />
                <span>Include original PDF</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={packageAssetOptions.includeSnapshots}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, includeSnapshots: event.currentTarget.checked }))}
                />
                <span>Include page snapshots</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={packageAssetOptions.includeThumbnails}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, includeThumbnails: event.currentTarget.checked }))}
                  disabled={!packageAssetOptions.includeSnapshots}
                />
                <span>Generate thumbnails</span>
              </label>
              <label>
                <span>Image Format</span>
                <select
                  value={packageAssetOptions.imageFormat}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, imageFormat: event.currentTarget.value as PortablePackageAssetOptions['imageFormat'] }))}
                  disabled={!packageAssetOptions.includeSnapshots}
                >
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                </select>
              </label>
              <label>
                <span>Max Image Width</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={packageAssetOptions.imageMaxWidth}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, imageMaxWidth: Number(event.currentTarget.value) || 0 }))}
                  disabled={!packageAssetOptions.includeSnapshots}
                />
              </label>
              <label>
                <span>JPEG Quality</span>
                <input
                  type="number"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={packageAssetOptions.jpegQuality}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, jpegQuality: Math.min(1, Math.max(0.1, Number(event.currentTarget.value) || 0.82)) }))}
                  disabled={!packageAssetOptions.includeSnapshots || packageAssetOptions.imageFormat !== 'jpeg'}
                />
              </label>
              <label>
                <span>Pages Per Volume</span>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={packageAssetOptions.pagesPerVolume}
                  onChange={(event) => setPackageAssetOptions((current) => ({ ...current, pagesPerVolume: Math.max(0, Math.floor(Number(event.currentTarget.value) || 0)) }))}
                  placeholder="0 = one package"
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button className="button secondary" onClick={() => setPackageSettingsOpen(false)} type="button">Done</button>
            </footer>
          </section>
        </div>
      ) : null}

      {packageInspector.open ? (
        <div className="modal-backdrop">
          <section className="modal-panel package-inspector-modal">
            <header className="modal-header">
              <div>
                <h2>Package Inspector</h2>
                <p>{packageInspector.fileName || 'No package selected'} · {packageInspector.status}</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setPackageInspector((current) => ({ ...current, open: false }))}
                type="button"
              >
                x
              </button>
            </header>
            {packageInspector.error ? (
              <p className="package-error">{packageInspector.error}</p>
            ) : packageInspector.manifest ? (
              <div className="package-inspector-grid">
                <section className="package-summary-panel">
                  <h3>{packageInspector.manifest.book.title}</h3>
                  <dl>
                    <div><dt>Package</dt><dd>{packageInspector.manifest.packageId}</dd></div>
                    <div><dt>Book ID</dt><dd>{packageInspector.manifest.bookId}</dd></div>
                    <div><dt>Version</dt><dd>{packageInspector.manifest.version} rev {packageInspector.manifest.revision}</dd></div>
                    <div><dt>Default Language</dt><dd>{packageInspector.manifest.defaultLanguage}</dd></div>
                    <div><dt>Pages</dt><dd>{packageInspector.pages.length}</dd></div>
                    <div><dt>Assets</dt><dd>{packageInspector.files.filter((file) => file.path.startsWith('assets/') || file.path.startsWith('source/')).length}</dd></div>
                    <div><dt>Publisher</dt><dd>{packageInspector.manifest.publisher?.name || 'Not set'}</dd></div>
                    <div><dt>Rights</dt><dd>{packageInspector.manifest.rightsStatus || 'Not set'}</dd></div>
                    {packageInspector.manifest.volume ? (
                      <div><dt>Volume</dt><dd>{packageInspector.manifest.volume.index} of {packageInspector.manifest.volume.total}, pages {packageInspector.manifest.volume.pageStart}-{packageInspector.manifest.volume.pageEnd}</dd></div>
                    ) : null}
                  </dl>
                </section>
                <section className="package-summary-panel">
                  <h3>Languages</h3>
                  <div className="package-language-list">
                    {packageInspector.translations.map((entry) => (
                      <article key={entry.language}>
                        <strong>{entry.language}</strong>
                        <span>{entry.pageCount} pages · {entry.translationCount} records</span>
                        {entry.sample ? <p>{entry.sample.paragraphs[0] ?? 'No preview text.'}</p> : null}
                      </article>
                    ))}
                  </div>
                </section>
                <section className="package-summary-panel package-validation-panel">
                  <h3>Validation</h3>
                  <div className="package-validation-list">
                    {packageInspector.validation.map((entry) => (
                      <div key={entry.path} className={`package-validation-row ${entry.status}`}>
                        <strong>{entry.status}</strong>
                        <span>{entry.path}</span>
                        <small>{entry.detail}</small>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <p className="muted">Select a `.bookpkg` file to inspect.</p>
            )}
          </section>
        </div>
      ) : null}

      {liveExportOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel export-render-modal">
            <header className="modal-header">
              <div>
                <h2>Live Export Render</h2>
                <p>{liveExportTitle || 'Generated book preview'}</p>
              </div>
              <div className="modal-header-actions">
                <button
                  className="mini-button"
                  onClick={() => void exportActiveBookAsHtml()}
                  disabled={!activeBook?.translations.length}
                  type="button"
                >
                  Export File
                </button>
                <button
                  className="mini-button"
                  onClick={() => void exposeActiveBookExportUrl()}
                  disabled={!activeBook?.translations.length}
                  type="button"
                >
                  Browser URL
                </button>
                <button
                  className="mini-button"
                  onClick={() => void exposeActiveBookExportApiUrl()}
                  disabled={!activeBook}
                  type="button"
                >
                  API URL
                </button>
                <button
                  className="mini-button"
                  onClick={() => void browseActiveBookExports()}
                  disabled={!activeBook}
                  type="button"
                >
                  Browse Files
                </button>
                <button className="icon-button" onClick={() => setLiveExportOpen(false)} type="button">x</button>
              </div>
            </header>
            <iframe
              className="export-render-frame"
              srcDoc={liveExportHtml}
              title={liveExportTitle || 'Live export preview'}
              sandbox="allow-scripts"
            />
          </section>
        </div>
      ) : null}

      {sourceInspectorOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel source-modal">
            <header className="modal-header">
              <div>
                <h2>Source Transcription</h2>
                <p>
                  {activeBook?.title ?? 'Imported book'} · Page {activePageNumber}
                  {canonicalOriginalTranslation ? ` · Model ${getTranslationModelLabel(canonicalOriginalTranslation)}` : ''}
                </p>
              </div>
              <button className="icon-button" onClick={() => setSourceInspectorOpen(false)} type="button">x</button>
            </header>

            <div className="source-modal-tabs" role="tablist" aria-label="Source inspector views">
              <button
                className={sourceInspectorTab === 'source' ? 'active' : ''}
                onClick={() => setSourceInspectorTab('source')}
                type="button"
              >
                Source OCR
              </button>
              <button
                className={sourceInspectorTab === 'faithful' ? 'active' : ''}
                onClick={() => setSourceInspectorTab('faithful')}
                type="button"
              >
                Good Faith English
              </button>
            </div>

            {sourceInspectorTab === 'source' ? (
              <div className="source-inspector-grid three-column">
                <section className="source-lines-panel">
                  <header>
                    <strong>Previous page</strong>
                    <span>Page {Math.max(1, activePageNumber - 1)}</span>
                  </header>
                  {previousSourceLines.length ? (
                    <ol>
                      {previousSourceLines.map((line, index) => (
                        <li key={`${line}-${index}`}>{line}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">
                      No previous-page source transcription is stored yet. Translate page {Math.max(1, activePageNumber - 1)} as Original first to create it.
                    </p>
                  )}
                </section>

                <section className="source-lines-panel">
                  <header>
                    <strong>Current page</strong>
                    <span>Page {activePageNumber}</span>
                  </header>
                  {currentSourceLines.length ? (
                    <ol>
                      {currentSourceLines.map((line, index) => (
                        <li key={`${line}-${index}`}>{line}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">
                      No source-language transcription is stored for this page yet. Translate this page as Original to generate it from the snapshot.
                    </p>
                  )}
                </section>

                <section className="source-lines-panel">
                  <header>
                    <strong>Next page</strong>
                    <span>Page {Math.min(activePageCount, activePageNumber + 1)}</span>
                  </header>
                  {nextSourceLines.length ? (
                    <ol>
                      {nextSourceLines.map((line, index) => (
                        <li key={`${line}-${index}`}>{line}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">
                      No next-page source transcription is stored yet. Translate page {Math.min(activePageCount, activePageNumber + 1)} as Original first to create it.
                    </p>
                  )}
                </section>
              </div>
            ) : (
              <div className="source-inspector-grid three-column">
                <section className="source-lines-panel">
                  <header>
                    <strong>Previous page</strong>
                    <span>Page {Math.max(1, activePageNumber - 1)}</span>
                  </header>
                  {previousGoodFaithParagraphs.length ? (
                    <div className="source-prose">
                      {previousGoodFaithParagraphs.map((paragraph, index) => (
                        <p key={`${paragraph}-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No previous-page Good Faith English is stored yet. Translate page {Math.max(1, activePageNumber - 1)} as Original first to create it.
                    </p>
                  )}
                </section>

                <section className="source-lines-panel">
                  <header>
                    <strong>Current page</strong>
                    <span>Page {activePageNumber}</span>
                  </header>
                  {goodFaithParagraphs.length ? (
                    <div className="source-prose">
                      {goodFaithParagraphs.map((paragraph, index) => (
                        <p key={`${paragraph}-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No Good Faith English translation is stored for this page yet. Translate this page as Original to generate it.
                    </p>
                  )}
                </section>

                <section className="source-lines-panel">
                  <header>
                    <strong>Next page</strong>
                    <span>Page {Math.min(activePageCount, activePageNumber + 1)}</span>
                  </header>
                  {nextGoodFaithParagraphs.length ? (
                    <div className="source-prose">
                      {nextGoodFaithParagraphs.map((paragraph, index) => (
                        <p key={`${paragraph}-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No next-page Good Faith English is stored yet. Translate page {Math.min(activePageCount, activePageNumber + 1)} as Original first to create it.
                    </p>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {memoryOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel memory-modal">
            <header className="modal-header">
              <div>
                <h2>Translation Memory</h2>
                <p>{activeBook?.title ?? 'Imported book'} · {approvedMemoryCount} approved of {translationMemoryRows.length} terms</p>
              </div>
              <div className="modal-header-actions">
                <button
                  className="mini-button"
                  onClick={() => void autoReviewBookGlossary()}
                  disabled={oldBookBusy || !translationMemoryRows.length}
                  type="button"
                >
                  Auto Review
                </button>
                <button className="icon-button" onClick={() => setMemoryOpen(false)} type="button">x</button>
              </div>
            </header>

            {translationMemoryRows.length ? (
              <div className="memory-table-wrap">
                <table className="memory-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Source term</th>
                      <th>Approved translation</th>
                      <th>Context</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {translationMemoryRows.map((entry) => {
                      const persisted = activeBook?.translationMemory.some((memoryEntry) =>
                        glossaryKey(memoryEntry.sourceTerm, memoryEntry.translatedTerm) === glossaryKey(entry.sourceTerm, entry.translatedTerm)
                      )
                      const status = entry.approved ? 'Approved' : persisted ? 'Pending' : 'Suggested'
                      return (
                        <tr key={`${entry.id}-${entry.sourceTerm}-${entry.translatedTerm}`}>
                          <td><span className={entry.approved ? 'memory-status approved' : 'memory-status'}>{status}</span></td>
                          <td>{entry.sourceTerm || '-'}</td>
                          <td>{entry.translatedTerm || '-'}</td>
                          <td>{entry.explanation || '-'}</td>
                          <td>
                            <button
                              className="mini-button"
                              onClick={() => void setMemoryApproval(entry, !entry.approved)}
                              type="button"
                            >
                              {entry.approved ? 'Unapprove' : 'Approve'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No glossary terms have been extracted yet.</p>
            )}
          </section>
        </div>
      ) : null}

      {snapshotsOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel snapshot-modal">
            <header className="modal-header">
              <div>
                <h2>{snapshotViewMode === 'page' ? 'Page Snapshot' : 'Page Snapshots'}</h2>
                <p>
                  {activeBook?.title ?? 'Imported book'} · {
                    snapshotViewMode === 'page' && selectedSnapshot
                      ? `Page ${selectedSnapshot.pageNumber}`
                      : `${sortedSnapshots.length} page snapshots`
                  }
                </p>
              </div>
              <button className="icon-button" onClick={() => setSnapshotsOpen(false)} type="button">x</button>
            </header>

            <div className={snapshotViewMode === 'page' ? 'snapshot-browser single' : 'snapshot-browser'}>
              {snapshotViewMode === 'all' ? (
                <aside className="snapshot-page-list" aria-label="Snapshot pages">
                  {snapshotBrowserItems.map((snapshot) => (
                    <button
                      key={snapshot.id}
                      className={selectedSnapshot?.id === snapshot.id ? 'snapshot-page-button active' : 'snapshot-page-button'}
                      onClick={() => setActiveSnapshotPage(snapshot.pageNumber)}
                      type="button"
                    >
                      <img src={getSnapshotImageSrc(snapshot)} alt="" />
                      <span>Page {snapshot.pageNumber}</span>
                    </button>
                  ))}
                </aside>
              ) : null}

              <main className="snapshot-preview">
                {selectedSnapshot ? (
                  <>
                    <div className="snapshot-preview-toolbar">
                      <div>
                        <strong>Page {selectedSnapshot.pageNumber}</strong>
                        <span>{selectedSnapshot.width} x {selectedSnapshot.height}</span>
                      </div>
                      <a className="mini-button" href={getSnapshotImageSrc(selectedSnapshot)} target="_blank" rel="noreferrer">
                        Open Image
                      </a>
                    </div>
                    <div className="snapshot-preview-stage">
                      <img src={getSnapshotImageSrc(selectedSnapshot)} alt={`Snapshot of page ${selectedSnapshot.pageNumber}`} />
                    </div>
                    <p className="snapshot-path">
                      {selectedSnapshot.filePath ?? 'Stored in local app database'}
                    </p>
                  </>
                ) : (
                  <p className="muted">No snapshots saved yet.</p>
                )}
              </main>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function getInitialWorkspaceTab(): WorkspaceTab {
  if (typeof window === 'undefined') return 'books'
  const requestedTab = new URLSearchParams(window.location.search).get('tab') as WorkspaceTab | null
  return requestedTab === 'books'
    || requestedTab === 'contents'
    || requestedTab === 'preview'
    || requestedTab === 'archive'
    || requestedTab === 'translation'
    ? requestedTab
    : 'books'
}

function App() {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>(() => getInitialWorkspaceTab())
  const [book, setBook] = useState<Book>(() => createInitialBook())
  const [activeNodeId, setActiveNodeId] = useState(() => findFirstNodeId(book.outline))
  const [activeFileName, setActiveFileName] = useState<string | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [bookSettingsDraft, setBookSettingsDraft] = useState<Book | null>(null)
  const [bookSettingsMode, setBookSettingsMode] = useState<BookSettingsMode>('edit')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('reader')
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null)
  const [routerEndpoint, setRouterEndpoint] = useState(defaultRouterEndpoint)
  const [routerModel, setRouterModel] = useState(defaultRouterModel)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestTargetId, setSuggestTargetId] = useState<string | null>(null)
  const [suggestTargetLabel, setSuggestTargetLabel] = useState('Book')
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set())
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [archiveIssueUrl, setArchiveIssueUrl] = useState('https://royalsocietypublishing.org/rstl/issue/1/8')
  const [archiveIssues, setArchiveIssues] = useState<JournalArchiveIssue[]>(() => loadArchiveIssuesFromStorage())
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState('')

  const selectedLocation = useMemo(() => findNode(book.outline, activeNodeId), [book.outline, activeNodeId])
  const activeNode = selectedLocation?.node
  const chapterCount = book.outline.filter((node) => node.type === 'chapter').length
  const itemCount = countNodes(book.outline)
  const bookSettingsOpen = bookSettingsDraft !== null
  const bookSettingsTagsValue = bookSettingsDraft?.tags.join(', ') ?? ''
  const deleteConfirmTitleMatches = deleteConfirm
    ? deleteConfirm.typedTitle.trim() === deleteConfirm.entry.book.title.trim()
    : false
  const keywordsValue = activeNode?.keywords.join(', ') ?? ''
  const activeLibraryEntry = library.find((entry) => entry.fileName === activeFileName)
  const bookTabs = useMemo<BookTab[]>(() => {
    const tabs = library.map((entry) => ({
      key: entry.fileName,
      label: entry.book.title,
      fileName: entry.fileName,
      audience: entry.book.audience,
      chapterCount: entry.chapterCount,
      itemCount: entry.itemCount,
      updatedAt: entry.book.updatedAt,
      isCurrentDraft: false,
    }))

    if (!activeFileName || !tabs.some((tab) => tab.fileName === activeFileName)) {
      tabs.unshift({
        key: activeFileName ?? 'draft',
        label: book.title,
        fileName: activeFileName,
        audience: book.audience,
        chapterCount,
        itemCount,
        updatedAt: book.updatedAt,
        isCurrentDraft: true,
      })
    }

    return tabs
  }, [activeFileName, book.audience, book.title, book.updatedAt, chapterCount, itemCount, library])

  useEffect(() => {
    void refreshLibrary()
  }, [])

  useEffect(() => {
    saveArchiveIssuesToStorage(archiveIssues)
  }, [archiveIssues])

  useEffect(() => {
    if (!book.outline.length) {
      const fallback = createNode('chapter', 'New Chapter', [createNode('section', 'New Section')])
      setBook((current) => ({ ...current, outline: [fallback], updatedAt: new Date().toISOString() }))
      setActiveNodeId(fallback.id)
      return
    }

    if (!activeNodeId || !findNode(book.outline, activeNodeId)) {
      setActiveNodeId(findFirstNodeId(book.outline))
    }
  }, [book.outline, activeNodeId])

  const commitBook = (updater: (current: Book) => Book) => {
    setBook((current) => ({ ...updater(current), updatedAt: new Date().toISOString() }))
  }

  const updateActiveNode = (updater: (node: OutlineNode) => OutlineNode) => {
    if (!activeNode) return
    commitBook((current) => ({ ...current, outline: updateNode(current.outline, activeNode.id, updater) }))
  }

  async function refreshLibrary() {
    setLibraryBusy(true)
    try {
      const fileNames = (await invoke('list_books')) as string[]
      const entries = await Promise.all(
        fileNames
          .filter((fileName) => fileName.endsWith('.json'))
          .map(async (fileName) => {
            const content = (await invoke('load_book', { fileName })) as string
            const parsed = normalizeBook(JSON.parse(content))
            return {
              fileName,
              book: parsed,
              chapterCount: parsed.outline.filter((node) => node.type === 'chapter').length,
              itemCount: countNodes(parsed.outline),
            } satisfies LibraryEntry
          }),
      )
      setLibrary(entries.sort((left, right) => (right.book.updatedAt ?? '').localeCompare(left.book.updatedAt ?? '')))
    } catch (error) {
      if (!isTauriUnavailable(error)) {
        setStatusText(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setLibraryBusy(false)
    }
  }

  function newBook(options: { tab?: WorkspaceTab } = {}) {
    const next = createInitialBook()
    setBook(next)
    setActiveFileName(null)
    setActiveNodeId(findFirstNodeId(next.outline))
    if (options.tab) {
      setActiveWorkspaceTab(options.tab)
    }
    setStatusText('Started a new unsaved book.')
  }

  async function persistBook(bookToPersist: Book) {
    const updated = { ...bookToPersist, updatedAt: new Date().toISOString() }
    const payload = JSON.stringify(updated, null, 2)
    const fileName = (await invoke('save_book', { bookId: updated.id, payload })) as string
    setBook(updated)
    setActiveFileName(fileName)
    await refreshLibrary()
    return updated
  }

  async function importRoyalSocietyIssueToDesktop() {
    setArchiveBusy(true)
    setArchiveError('')
    try {
      const parsedUrl = new URL(archiveIssueUrl.trim())
      if (!parsedUrl.hostname.includes('royalsocietypublishing.org')) {
        throw new Error('Enter a Royal Society Publishing issue URL.')
      }
      const response = await fetch(parsedUrl.toString(), {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      })
      if (!response.ok) {
        throw new Error(`Royal Society issue request failed: ${response.status}`)
      }
      const issue = parseRoyalSocietyIssueHtml(await response.text(), parsedUrl.toString())
      if (!issue.articles.length) {
        throw new Error('No article DOI links were found on this issue page.')
      }
      setArchiveIssues((current) => [issue, ...current.filter((entry) => entry.id !== issue.id)])
      setStatusText(`Imported ${issue.articles.length} article records from ${issue.journalName}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setArchiveError(message)
      setStatusText(message)
    } finally {
      setArchiveBusy(false)
    }
  }

  async function importArchiveArticleToBook(issue: JournalArchiveIssue, article: JournalArchiveArticle) {
    const now = new Date().toISOString()
    const overview = createNode('chapter', 'Article Overview', [
      {
        ...createNode('section', 'Source and Reading Plan'),
        intent: 'Keep the archive source attached and prepare this article for reading, explanation, and translation.',
        summary: article.title,
        content: [
          `Journal: ${article.journalName}`,
          `Publisher: ${article.publisherName}`,
          article.year ? `Year: ${article.year}` : '',
          article.volume ? `Volume: ${article.volume}` : '',
          article.issue ? `Issue: ${article.issue}` : '',
          `Article ID: ${article.articleId}`,
          '',
          'Open the source/PDF from Resources, read or extract the article, then use the Translation Lab workflow for translation and package export.',
        ].filter(Boolean).join('\n'),
        keywords: ['archive article', article.journalName, article.year ?? '', article.articleId].filter(Boolean),
        persona: 'college',
        resources: [
          {
            id: `source-${article.id}`,
            type: 'link',
            label: 'Article Page',
            value: article.sourceUrl,
            description: article.articleId,
          },
          ...(article.pdfUrl ? [{
            id: `pdf-${article.id}`,
            type: 'pdf' as ResourceType,
            label: 'Article PDF',
            value: article.pdfUrl,
            description: 'Royal Society PDF URL',
          }] : []),
          {
            id: `issue-${issue.id}`,
            type: 'link',
            label: 'Issue Page',
            value: issue.issueUrl,
            description: issue.issueTitle,
          },
        ],
      },
    ])
    const archiveBook: Book = {
      id: `archive-${article.id}`,
      title: article.title,
      synopsis: `Archive article from ${article.journalName}. ${article.articleId}`,
      audience: 'Research reader',
      tone: 'Academic',
      tags: ['Archive Article', article.publisherName, article.journalName, article.year ?? ''].filter(Boolean),
      outline: [overview],
      createdAt: now,
      updatedAt: now,
    }
    const saved = await persistBook(archiveBook)
    setActiveNodeId(findFirstNodeId(saved.outline))
    setActiveWorkspaceTab('contents')
    setArchiveIssues((current) => current.map((entry) =>
      entry.id === issue.id
        ? {
            ...entry,
            articles: entry.articles.map((item) =>
              item.id === article.id ? { ...item, importedBookId: saved.id } : item
            ),
          }
        : entry
    ))
    setStatusText(`Imported archive article "${saved.title}".`)
  }

  function openCreateBookModal(options: { tab?: WorkspaceTab } = {}) {
    const next = createInitialBook()
    setBookSettingsMode('create')
    setBookSettingsDraft(next)
    if (options.tab) {
      setActiveWorkspaceTab(options.tab)
    }
    setStatusText('Preparing a new book.')
  }

  function openEditBookModal(entry?: LibraryEntry) {
    if (entry) {
      const opened = normalizeBook(entry.book)
      setBook(opened)
      setActiveFileName(entry.fileName)
      setActiveNodeId(findFirstNodeId(opened.outline))
      setBookSettingsMode('edit')
      setBookSettingsDraft(opened)
      setStatusText(`Editing ${opened.title}.`)
      return
    }

    setBookSettingsMode('edit')
    setBookSettingsDraft(book)
  }

  function closeBookSettingsModal() {
    setBookSettingsDraft(null)
  }

  function updateBookSettingsDraft<K extends keyof Book>(field: K, value: Book[K]) {
    setBookSettingsDraft((current) => {
      if (!current) return current
      return { ...current, [field]: value, updatedAt: new Date().toISOString() }
    })
  }

  async function saveBookSettingsDraft() {
    if (!bookSettingsDraft) return
    try {
      const saved = await persistBook(bookSettingsDraft)
      setBookSettingsDraft(null)
      setStatusText(bookSettingsMode === 'create' ? `Added ${saved.title}.` : `Saved ${saved.title}.`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveToLocal() {
    try {
      const saved = await persistBook(book)
      setStatusText(`Saved ${saved.title}.`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  function openBook(entry: LibraryEntry, tab?: WorkspaceTab) {
    const opened = normalizeBook(entry.book)
    setBook(opened)
    setActiveFileName(entry.fileName)
    setActiveNodeId(findFirstNodeId(opened.outline))
    if (tab) {
      setActiveWorkspaceTab(tab)
    }
    setStatusText(`Opened ${opened.title}.`)
  }

  function openBookTab(bookTab: BookTab, tab?: WorkspaceTab) {
    if (!bookTab.fileName) {
      if (tab) {
        setActiveWorkspaceTab(tab)
      }
      return
    }
    const entry = library.find((item) => item.fileName === bookTab.fileName)
    if (entry) {
      openBook(entry, tab)
    }
  }

  function openDeleteBookDialog(entry: LibraryEntry) {
    setDeleteConfirm({
      entry,
      step: 1,
      typedTitle: '',
      busy: false,
    })
  }

  function closeDeleteBookDialog() {
    if (!deleteConfirm?.busy) {
      setDeleteConfirm(null)
    }
  }

  async function confirmDeleteBook() {
    if (!deleteConfirm) return

    if (deleteConfirm.step === 1) {
      setDeleteConfirm((current) => current ? { ...current, step: 2, typedTitle: '' } : current)
      return
    }

    if (!deleteConfirmTitleMatches) return

    try {
      const entry = deleteConfirm.entry
      setDeleteConfirm((current) => current ? { ...current, busy: true } : current)
      await invoke('delete_book', { fileName: entry.fileName })
      if (entry.fileName === activeFileName) {
        newBook()
      }
      await refreshLibrary()
      setStatusText(`Deleted ${entry.book.title}.`)
      setDeleteConfirm(null)
    } catch (error) {
      setDeleteConfirm((current) => current ? { ...current, busy: false } : current)
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  function removeCurrentBook() {
    if (activeLibraryEntry) {
      openDeleteBookDialog(activeLibraryEntry)
      return
    }

    const confirmed = window.confirm(`Discard "${book.title}"?`)
    if (!confirmed) return
    newBook()
  }

  function exportStructure() {
    const payload = JSON.stringify(book, null, 2)
    downloadTextFile(`${book.title || 'bookforge'}.json`, payload, 'application/json;charset=utf-8')
  }

  function openPreview(mode: PreviewMode = 'reader') {
    setPreviewMode(mode)
    setActiveWorkspaceTab('preview')
  }

  function addChapter() {
    const chapter = createNode('chapter', 'New Chapter', [createNode('section', 'New Section')])
    commitBook((current) => ({ ...current, outline: [...current.outline, chapter] }))
    setActiveNodeId(chapter.id)
  }

  function addChildNode(parentId: string) {
    const parent = findNode(book.outline, parentId)?.node
    const child = createNode('section', parent?.type === 'chapter' ? 'New Section' : 'New Subsection')
    commitBook((current) => ({ ...current, outline: appendChildren(current.outline, parentId, [child]) }))
    setActiveNodeId(child.id)
  }

  function removeOutlineNode(id: string) {
    if (itemCount <= 1) return
    const nextOutline = removeNode(book.outline, id)
    const fallbackId = findFirstNodeId(nextOutline)
    commitBook((current) => ({ ...current, outline: nextOutline }))
    if (id === activeNodeId) {
      setActiveNodeId(fallbackId)
    }
  }

  function addResource() {
    updateActiveNode((node) => ({ ...node, resources: [...node.resources, createResource()] }))
  }

  function updateResource(resourceId: string, updater: (resource: Resource) => Resource) {
    updateActiveNode((node) => ({
      ...node,
      resources: node.resources.map((resource) => (resource.id === resourceId ? updater(resource) : resource)),
    }))
  }

  function removeResource(resourceId: string) {
    updateActiveNode((node) => ({ ...node, resources: node.resources.filter((resource) => resource.id !== resourceId) }))
  }

  function buildSuggestionPrompt(targetId: string | null) {
    const target = targetId ? findNode(book.outline, targetId) : null
    const targetTitle = target?.node.title ?? book.title
    const targetKind = target?.node.type ?? 'book'
    const existingChildren = target ? target.node.children.map((child) => child.title).join(', ') : book.outline.map((node) => node.title).join(', ')

    return [
      `Book title: ${book.title}`,
      `Audience: ${book.audience || 'Not specified'}`,
      `Tone: ${book.tone || 'Neutral'}`,
      `Synopsis: ${book.synopsis || 'Not specified'}`,
      `Target ${targetKind}: ${targetTitle}`,
      target ? `Target path: ${target.path.join(' > ')}` : 'Target path: Book root',
      target?.node.summary ? `Target summary: ${target.node.summary}` : '',
      target?.node.intent ? `Target intent: ${target.node.intent}` : '',
      existingChildren ? `Existing children to avoid duplicating: ${existingChildren}` : '',
      'Suggest useful child topics and subtopics for this target.',
      'Return JSON only with this shape: {"items":[{"title":"Topic","summary":"Short useful description","children":[{"title":"Subtopic","summary":"Short useful description","children":[]}]}]}.',
      'Keep titles concise. Prefer 4 to 8 top-level suggestions and 0 to 5 child suggestions each.',
    ].filter(Boolean).join('\n')
  }

  async function fetchSuggestions(targetId: string | null) {
    const prompt = buildSuggestionPrompt(targetId)

    try {
      const content = (await invoke('suggest_outline_topics', {
        endpoint: routerEndpoint,
        model: routerModel.trim() || 'default',
        prompt,
      })) as string
      return normalizeSuggestionItems(extractJsonPayload(content))
    } catch {
      // Browser preview cannot use Tauri commands; fall back to direct fetch for that case.
    }

    const url = routerCompletionsUrl(routerEndpoint)
    if (!url) throw new Error('Enter an LLM router endpoint.')

    const payload = {
      model: routerModel.trim() || 'default',
      messages: [
        {
          role: 'system',
          content: 'You are a book outline architect. Return only strict JSON. Do not include markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }

    const send = (body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    let response = await send(payload)
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const { response_format: _responseFormat, ...fallbackPayload } = payload
      response = await send(fallbackPayload)
    }
    if (!response.ok) {
      throw new Error(`LLM router request failed: ${response.status} ${await response.text()}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('LLM router response did not include choices[0].message.content.')
    }
    return normalizeSuggestionItems(extractJsonPayload(content))
  }

  async function openSuggestModal(targetId: string | null) {
    const target = targetId ? findNode(book.outline, targetId) : null
    setSuggestTargetId(targetId)
    setSuggestTargetLabel(target ? target.path.join(' > ') : book.title)
    setSuggestOpen(true)
    setSuggestBusy(true)
    setSuggestError('')
    setSuggestions([])
    setSelectedSuggestionIds(new Set())

    try {
      const items = await fetchSuggestions(targetId)
      setSuggestions(items)
      setSelectedSuggestionIds(new Set(flattenSuggestionIds(items)))
      if (!items.length) {
        setSuggestError('The model returned no suggestions.')
      }
    } catch (error) {
      setSuggestError(error instanceof Error ? error.message : String(error))
    } finally {
      setSuggestBusy(false)
    }
  }

  function toggleSuggestion(id: string) {
    setSelectedSuggestionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addSelectedSuggestions() {
    const rootType: OutlineNodeType = suggestTargetId ? 'section' : 'chapter'
    const nodes = materializeSuggestions(suggestions, selectedSuggestionIds, rootType)
    if (!nodes.length) return

    commitBook((current) => ({
      ...current,
      outline: appendChildren(current.outline, suggestTargetId, nodes),
    }))
    setActiveNodeId(nodes[0].id)
    setSuggestOpen(false)
    setStatusText(`Added ${nodes.length} suggested item${nodes.length === 1 ? '' : 's'}.`)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-overline">Author Workspace</p>
          <h1 className="app-title">BookForge Designer</h1>
        </div>
        <div className="header-actions">
          <button className="button" onClick={saveToLocal} type="button">
            Save
          </button>
          <button className="button secondary" onClick={exportStructure} type="button">
            Export JSON
          </button>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Workspace">
        <button
          className={activeWorkspaceTab === 'books' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveWorkspaceTab('books')}
          type="button"
        >
          Books
        </button>
        <button
          className={activeWorkspaceTab === 'contents' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveWorkspaceTab('contents')}
          type="button"
        >
          Contents
        </button>
        <button
          className={activeWorkspaceTab === 'preview' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveWorkspaceTab('preview')}
          type="button"
        >
          Preview
        </button>
        <button
          className={activeWorkspaceTab === 'archive' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveWorkspaceTab('archive')}
          type="button"
        >
          Archive
        </button>
        <button
          className={activeWorkspaceTab === 'translation' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveWorkspaceTab('translation')}
          type="button"
        >
          Translation Lab
        </button>
      </nav>

      {activeWorkspaceTab === 'books' ? (
        <main className="books-view">
          <section className="panel books-manager-panel">
            <div className="book-tabs-header">
              <div>
                <h2>Books</h2>
                <p className="panel-subtitle">
                  Select a book, add a new book, or edit book metadata.
                </p>
              </div>
              <div className="book-actions">
                <button className="button secondary" onClick={() => openCreateBookModal()} type="button">
                  Add Book
                </button>
                <button className="button secondary" onClick={() => openEditBookModal()} type="button">
                  Edit Selected
                </button>
                <button className="button danger" onClick={removeCurrentBook} type="button">
                  Delete Selected
                </button>
                <button className="button secondary" onClick={() => void refreshLibrary()} type="button" disabled={libraryBusy}>
                  {libraryBusy ? 'Refreshing...' : 'Refresh'}
                </button>
                <button className="button" onClick={() => setActiveWorkspaceTab('contents')} type="button">
                  Open Contents
                </button>
              </div>
            </div>

            <div className="books-table-wrap">
              <table className="books-table">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Audience</th>
                    <th scope="col">Chapters</th>
                    <th scope="col">Items</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookTabs.map((tab) => {
                    const entry = tab.fileName ? library.find((item) => item.fileName === tab.fileName) : undefined
                    const isActive = tab.fileName === activeFileName || (!tab.fileName && !activeFileName)
                    return (
                      <tr key={tab.key} className={isActive ? 'active' : undefined}>
                        <td>
                          <button
                            className="table-title-button"
                            onClick={() => openBookTab(tab)}
                            type="button"
                            title={`${tab.label || 'Untitled Book'}${tab.updatedAt ? ` - updated ${formatDate(tab.updatedAt)}` : ''}`}
                          >
                            {tab.label || 'Untitled Book'}
                          </button>
                          <span className="table-file-name">{tab.fileName ?? 'Unsaved draft'}</span>
                        </td>
                        <td>{tab.audience || '-'}</td>
                        <td>{tab.chapterCount}</td>
                        <td>{tab.itemCount}</td>
                        <td>{formatDate(tab.updatedAt)}</td>
                        <td>
                          <span className={tab.fileName ? 'book-status saved' : 'book-status draft'}>
                            {tab.fileName ? 'Saved' : 'Draft'}
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            <button className="mini-button" onClick={() => openBookTab(tab)} type="button">
                              Open
                            </button>
                            <button className="mini-button" onClick={() => entry ? openEditBookModal(entry) : openEditBookModal()} type="button">
                              Edit
                            </button>
                            {entry ? (
                              <button className="mini-button danger-text" onClick={() => openDeleteBookDialog(entry)} type="button">
                                Delete
                              </button>
                            ) : (
                              <button className="mini-button danger-text" onClick={removeCurrentBook} type="button">
                                Discard
                              </button>
                            )}
                            <button className="mini-button" onClick={() => openBookTab(tab, 'contents')} type="button">
                              Contents
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {statusText ? <p className="status">{statusText}</p> : null}
          </section>
        </main>
      ) : activeWorkspaceTab === 'contents' ? (
        <div className="contents-grid">
          <section className="panel content-book-panel">
            <div className="content-book-header">
              <div>
                <h2>{book.title || 'Untitled Book'}</h2>
                <p className="panel-subtitle">
                  {activeFileName ? `Saved as ${activeFileName}` : 'Unsaved draft'} · {chapterCount} chapters, {itemCount} items
                </p>
              </div>
              <div className="book-actions">
                <button className="button secondary" onClick={() => openPreview('reader')} type="button">
                  Preview Book
                </button>
                <button className="button secondary" onClick={() => openEditBookModal()} type="button">
                  Edit Book
                </button>
                <button className="button secondary" onClick={() => void openSuggestModal(null)} type="button">
                  Suggest Chapters
                </button>
                <button className="button" onClick={addChapter} type="button">
                  + Chapter
                </button>
              </div>
            </div>

            <div className="book-tabs compact" role="tablist" aria-label="Select book for contents">
              {bookTabs.map((tab) => {
                const isActive = tab.fileName === activeFileName || (!tab.fileName && !activeFileName)
                return (
                  <button
                    key={tab.key}
                    className={isActive ? 'book-tab active' : 'book-tab'}
                    onClick={() => openBookTab(tab)}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={`${tab.label || 'Untitled Book'}${tab.updatedAt ? ` - updated ${formatDate(tab.updatedAt)}` : ''}`}
                  >
                    <span className="book-tab-title">{tab.label || 'Untitled Book'}</span>
                    <span className="book-tab-meta">
                      {tab.isCurrentDraft ? 'Draft' : `${tab.chapterCount} ch / ${tab.itemCount} items`}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <aside className="panel outline-panel">
            <div>
              <div className="panel-heading horizontal">
                <div>
                  <h2>Outline</h2>
                  <p className="panel-subtitle">{chapterCount} chapters, {itemCount} items</p>
                </div>
                <button className="button secondary" onClick={addChapter} type="button">
                  + Chapter
                </button>
              </div>
              <OutlineTree
                nodes={book.outline}
                activeId={activeNodeId}
                onSelect={setActiveNodeId}
                onAddChild={addChildNode}
                onSuggest={(id) => void openSuggestModal(id)}
                onRemove={removeOutlineNode}
              />
            </div>
          </aside>

          <main className="panel detail-panel">
            {activeNode ? (
              <section className="editor-section">
                <header className="section-header">
                  <div>
                    <h2>{activeNode.type === 'chapter' ? 'Chapter' : 'Section'} Details</h2>
                    <p>{selectedLocation?.path.join(' > ')}</p>
                  </div>
                  <div className="section-actions">
                    <button className="button secondary" onClick={() => addChildNode(activeNode.id)} type="button">
                      + {activeNode.type === 'chapter' ? 'Section' : 'Subsection'}
                    </button>
                    <button className="button secondary" onClick={() => void openSuggestModal(activeNode.id)} type="button">
                      Suggest
                    </button>
                    <button className="button danger" onClick={() => removeOutlineNode(activeNode.id)} disabled={itemCount <= 1} type="button">
                      Remove
                    </button>
                  </div>
                </header>

                <div className="form-grid">
                  <label>
                    <span>Type</span>
                    <select
                      value={activeNode.type}
                      onChange={(event) => {
                        const type = event.currentTarget.value as OutlineNodeType
                        updateActiveNode((node) => ({ ...node, type }))
                      }}
                    >
                      <option value="chapter">Chapter</option>
                      <option value="section">Section</option>
                    </select>
                  </label>
                  <label>
                    <span>Title</span>
                    <input
                      value={activeNode.title}
                      onChange={(event) => {
                        const title = event.currentTarget.value
                        updateActiveNode((node) => ({ ...node, title }))
                      }}
                    />
                  </label>
                  <label>
                    <span>Persona</span>
                    <select
                      value={activeNode.persona}
                      onChange={(event) => {
                        const persona = event.currentTarget.value as NodePersona
                        updateActiveNode((node) => ({ ...node, persona }))
                      }}
                    >
                      {personas.map((persona) => (
                        <option key={persona} value={persona}>{persona}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Duration</span>
                    <input
                      type="number"
                      min={1}
                      value={activeNode.durationMinutes ?? ''}
                      onChange={(event) => {
                        const minutes = Number.parseInt(event.currentTarget.value, 10)
                        updateActiveNode((node) => ({ ...node, durationMinutes: Number.isNaN(minutes) ? undefined : minutes }))
                      }}
                    />
                  </label>
                  <label className="full-width">
                    <span>Intent / goals</span>
                    <textarea
                      value={activeNode.intent}
                      onChange={(event) => {
                        const intent = event.currentTarget.value
                        updateActiveNode((node) => ({ ...node, intent }))
                      }}
                      rows={3}
                    />
                  </label>
                  <label className="full-width">
                    <span>Summary</span>
                    <textarea
                      value={activeNode.summary}
                      onChange={(event) => {
                        const summary = event.currentTarget.value
                        updateActiveNode((node) => ({ ...node, summary }))
                      }}
                      rows={3}
                    />
                  </label>
                  <label className="full-width">
                    <span>Content draft</span>
                    <textarea
                      value={activeNode.content}
                      onChange={(event) => {
                        const content = event.currentTarget.value
                        updateActiveNode((node) => ({ ...node, content }))
                      }}
                      rows={7}
                    />
                  </label>
                  <label className="full-width">
                    <span>Keywords</span>
                    <input
                      value={keywordsValue}
                      onChange={(event) => {
                        const keywords = event.currentTarget.value.split(',').map((keyword) => keyword.trim()).filter(Boolean)
                        updateActiveNode((node) => ({
                          ...node,
                          keywords,
                        }))
                      }}
                    />
                  </label>
                </div>

                <div className="resources">
                  <div className="resources-header">
                    <h3>Resources</h3>
                    <button className="button secondary" onClick={addResource} type="button">
                      + Resource
                    </button>
                  </div>
                  {!activeNode.resources.length ? <p className="muted">No resources attached.</p> : null}
                  {activeNode.resources.map((resource) => (
                    <div key={resource.id} className="resource-row">
                      <select
                        value={resource.type}
                        onChange={(event) => {
                          const type = event.currentTarget.value as ResourceType
                          updateResource(resource.id, (entry) => ({ ...entry, type }))
                        }}
                      >
                        {resourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                      <input
                        value={resource.label}
                        onChange={(event) => {
                          const label = event.currentTarget.value
                          updateResource(resource.id, (entry) => ({ ...entry, label }))
                        }}
                      />
                      <input
                        value={resource.value}
                        onChange={(event) => {
                          const value = event.currentTarget.value
                          updateResource(resource.id, (entry) => ({ ...entry, value }))
                        }}
                      />
                      <input
                        value={resource.description ?? ''}
                        onChange={(event) => {
                          const description = event.currentTarget.value
                          updateResource(resource.id, (entry) => ({ ...entry, description }))
                        }}
                      />
                      <button className="icon-button" onClick={() => removeResource(resource.id)} type="button">x</button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </main>

          <aside className="panel assist-panel">
            <section className="assist-box">
              <h2>LLM Suggestions</h2>
              <label>
                <span>Router endpoint</span>
                <input value={routerEndpoint} onChange={(event) => setRouterEndpoint(event.currentTarget.value)} />
              </label>
              <label>
                <span>Model</span>
                <input value={routerModel} onChange={(event) => setRouterModel(event.currentTarget.value)} />
              </label>
              <div className="stack-actions">
                <button className="button" onClick={() => void openSuggestModal(activeNode?.id ?? null)} type="button">
                  Suggest For Selection
                </button>
                <button className="button secondary" onClick={() => void openSuggestModal(null)} type="button">
                  Suggest Chapters
                </button>
              </div>
              {statusText ? <p className="status">{statusText}</p> : null}
            </section>

            <section className="assist-box preview-box">
              <h2>Structure Preview</h2>
              <pre className="preview-json">{JSON.stringify(book, null, 2)}</pre>
            </section>
          </aside>
        </div>
      ) : activeWorkspaceTab === 'archive' ? (
        <main className="archive-view">
          <section className="panel archive-import-panel">
            <div className="content-book-header">
              <div>
                <h2>Journal Archive</h2>
                <p className="panel-subtitle">
                  Build a local catalog of journal issues, then import articles as reader entries for explanation and translation.
                </p>
              </div>
              <div className="book-actions">
                <button className="button secondary" onClick={() => window.open(archiveIssueUrl, '_blank', 'noopener,noreferrer')} type="button">
                  Browse Issue
                </button>
              </div>
            </div>

            <div className="archive-import-card">
              <label className="full-width">
                <span>Royal Society issue URL</span>
                <input
                  value={archiveIssueUrl}
                  onChange={(event) => setArchiveIssueUrl(event.currentTarget.value)}
                  placeholder="https://royalsocietypublishing.org/rstl/issue/1/8"
                />
              </label>
              <div className="stack-actions">
                <button className="button" onClick={() => void importRoyalSocietyIssueToDesktop()} disabled={!archiveIssueUrl.trim() || archiveBusy} type="button">
                  {archiveBusy ? 'Importing...' : 'Import Issue'}
                </button>
                <button className="button secondary" onClick={() => window.open(archiveIssueUrl, '_blank', 'noopener,noreferrer')} disabled={!archiveIssueUrl.trim()} type="button">
                  Open in Browser
                </button>
              </div>
              {archiveError ? <p className="status error">{archiveError}</p> : null}
              <p className="muted">
                First target: Philosophical Transactions, volume 1, issue 8. The importer stores article DOI IDs and source/PDF URLs when the issue page exposes them.
              </p>
            </div>
          </section>

          <section className="panel archive-catalog-panel">
            <div className="panel-heading horizontal">
              <div>
                <h2>Local Journal Catalog</h2>
                <p className="panel-subtitle">
                  {archiveIssues.length ? `${archiveIssues.length} issue${archiveIssues.length === 1 ? '' : 's'} saved locally.` : 'No issues imported yet.'}
                </p>
              </div>
            </div>

            {!archiveIssues.length ? (
              <p className="muted">Import the Royal Society issue above to create local article records.</p>
            ) : null}

            <div className="archive-issue-list">
              {archiveIssues.map((issue) => (
                <article key={issue.id} className="archive-issue-card">
                  <header className="archive-issue-header">
                    <div>
                      <h3>{issue.journalName || issue.issueTitle}</h3>
                      <p className="muted">
                        {[issue.publisherName, issue.year, issue.month ? `Month ${issue.month}` : '', issue.volume ? `Vol. ${issue.volume}` : '', issue.issue ? `Issue ${issue.issue}` : '', `${issue.articles.length} articles`].filter(Boolean).join(' - ')}
                      </p>
                    </div>
                    <button className="mini-button" onClick={() => window.open(issue.issueUrl, '_blank', 'noopener,noreferrer')} type="button">
                      Open Issue
                    </button>
                  </header>

                  <div className="archive-article-list">
                    {issue.articles.map((article) => (
                      <div key={article.id} className="archive-article-row">
                        <div>
                          <strong>{article.title}</strong>
                          <span>{article.articleId}{article.importedBookId ? ' - Imported' : ''}</span>
                        </div>
                        <div className="table-actions">
                          <button className="mini-button" onClick={() => window.open(article.sourceUrl, '_blank', 'noopener,noreferrer')} type="button">
                            Source
                          </button>
                          {article.pdfUrl ? (
                            <button className="mini-button" onClick={() => window.open(article.pdfUrl, '_blank', 'noopener,noreferrer')} type="button">
                              PDF
                            </button>
                          ) : null}
                          <button
                            className="mini-button"
                            onClick={() => void importArchiveArticleToBook(issue, article)}
                            type="button"
                          >
                            {article.importedBookId ? 'Import Again' : 'Import Article'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            {statusText ? <p className="status">{statusText}</p> : null}
          </section>
        </main>
      ) : activeWorkspaceTab === 'translation' ? (
        <TranslationWorkspace />
      ) : (
        <main className="preview-view">
          <section className="panel preview-workspace-panel">
            <div className="content-book-header">
              <div>
                <h2>{book.title || 'Untitled Book'}</h2>
                <p className="panel-subtitle">
                  {activeFileName ? `Saved as ${activeFileName}` : 'Unsaved draft'} · {chapterCount} chapters, {itemCount} items
                </p>
              </div>
              <div className="book-actions">
                <button className="button secondary" onClick={() => setActiveWorkspaceTab('contents')} type="button">
                  Edit Contents
                </button>
                <button className="button secondary" onClick={exportStructure} type="button">
                  Export JSON
                </button>
              </div>
            </div>

            <BookPreviewContent
              book={book}
              previewMode={previewMode}
              onPreviewModeChange={setPreviewMode}
            />
          </section>
        </main>
      )}

      {bookSettingsOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel book-settings-modal">
            <header className="modal-header">
              <div>
                <h2>{bookSettingsMode === 'create' ? 'Add Book' : 'Edit Book'}</h2>
                <p>
                  {bookSettingsMode === 'create'
                    ? 'New book record'
                    : activeFileName
                      ? `Saved as ${activeFileName}`
                      : 'Unsaved draft'}
                </p>
              </div>
              <button className="icon-button" onClick={closeBookSettingsModal} type="button">x</button>
            </header>
            <div className="form-grid">
              <label>
                <span>Title</span>
                <input
                  value={bookSettingsDraft?.title ?? ''}
                  onChange={(event) => updateBookSettingsDraft('title', event.currentTarget.value)}
                />
              </label>
              <label>
                <span>Primary audience</span>
                <input
                  value={bookSettingsDraft?.audience ?? ''}
                  onChange={(event) => updateBookSettingsDraft('audience', event.currentTarget.value)}
                />
              </label>
              <label>
                <span>Preferred tone</span>
                <select
                  value={bookSettingsDraft?.tone ?? 'Neutral'}
                  onChange={(event) => updateBookSettingsDraft('tone', event.currentTarget.value)}
                >
                  <option value="Neutral">Neutral</option>
                  <option value="Conversational">Conversational</option>
                  <option value="Formal">Formal</option>
                  <option value="Playful">Playful</option>
                  <option value="Inspiring">Inspiring</option>
                </select>
              </label>
              <label className="full-width">
                <span>Synopsis</span>
                <textarea
                  value={bookSettingsDraft?.synopsis ?? ''}
                  onChange={(event) => updateBookSettingsDraft('synopsis', event.currentTarget.value)}
                  rows={4}
                />
              </label>
              <label className="full-width">
                <span>Tags</span>
                <input
                  value={bookSettingsTagsValue}
                  onChange={(event) =>
                    updateBookSettingsDraft(
                      'tags',
                      event.currentTarget.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                    )
                  }
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button className="button secondary" onClick={closeBookSettingsModal} type="button">
                Cancel
              </button>
              <button
                className="button"
                onClick={() => void saveBookSettingsDraft()}
                type="button"
              >
                {bookSettingsMode === 'create' ? 'Create Book' : 'Save Book'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteConfirm ? (
        <div className="modal-backdrop">
          <section className="modal-panel delete-modal">
            <header className="modal-header">
              <div>
                <h2>Delete Book</h2>
                <p>{deleteConfirm.entry.book.title}</p>
              </div>
              <button className="icon-button" onClick={closeDeleteBookDialog} disabled={deleteConfirm.busy} type="button">x</button>
            </header>

            {deleteConfirm.step === 1 ? (
              <div className="delete-confirm-body">
                <p>
                  This removes the local JSON file for this book. Export it first if you need a separate copy.
                </p>
                <dl className="delete-book-summary">
                  <div>
                    <dt>File</dt>
                    <dd>{deleteConfirm.entry.fileName}</dd>
                  </div>
                  <div>
                    <dt>Contents</dt>
                    <dd>{deleteConfirm.entry.chapterCount} chapters, {deleteConfirm.entry.itemCount} items</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="delete-confirm-body">
                <p>Type the book title to confirm deletion.</p>
                <label>
                  <span>Book title</span>
                  <input
                    value={deleteConfirm.typedTitle}
                    onChange={(event) => {
                      const typedTitle = event.currentTarget.value
                      setDeleteConfirm((current) => current ? { ...current, typedTitle } : current)
                    }}
                    disabled={deleteConfirm.busy}
                    autoFocus
                  />
                </label>
              </div>
            )}

            <footer className="modal-footer">
              <button className="button secondary" onClick={closeDeleteBookDialog} disabled={deleteConfirm.busy} type="button">
                Cancel
              </button>
              <button
                className="button danger"
                onClick={() => void confirmDeleteBook()}
                disabled={deleteConfirm.busy || (deleteConfirm.step === 2 && !deleteConfirmTitleMatches)}
                type="button"
              >
                {deleteConfirm.step === 1 ? 'Continue' : deleteConfirm.busy ? 'Deleting...' : 'Delete Book'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {suggestOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel">
            <header className="modal-header">
              <div>
                <h2>Suggested Children</h2>
                <p>{suggestTargetLabel}</p>
              </div>
              <button className="icon-button" onClick={() => setSuggestOpen(false)} type="button">x</button>
            </header>

            {suggestBusy ? <p className="muted">Requesting topic suggestions from the router...</p> : null}
            {suggestError ? <p className="error-text">{suggestError}</p> : null}
            {!suggestBusy && suggestions.length ? (
              <>
                <div className="modal-toolbar">
                  <button className="mini-button" onClick={() => setSelectedSuggestionIds(new Set(flattenSuggestionIds(suggestions)))} type="button">
                    Select all
                  </button>
                  <button className="mini-button" onClick={() => setSelectedSuggestionIds(new Set())} type="button">
                    Clear
                  </button>
                </div>
                <SuggestionChecklist items={suggestions} selectedIds={selectedSuggestionIds} onToggle={toggleSuggestion} />
              </>
            ) : null}

            <footer className="modal-footer">
              <button className="button secondary" onClick={() => setSuggestOpen(false)} type="button">
                Cancel
              </button>
              <button className="button" onClick={addSelectedSuggestions} disabled={!selectedSuggestionIds.size || suggestBusy} type="button">
                Add Selected
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
