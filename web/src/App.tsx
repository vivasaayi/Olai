import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import antiqueFolioUrl from './assets/mock-antique-folio.png'
import {
  complexityOptions,
  createPageSnapshotRecord,
  createQuestionRecord,
  createTranslationRecord,
  getDemoTranslationParagraphs,
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
  type TranslationComplexity,
  type TranslationGlossaryEntry,
  type TranslationJobState,
  type TranslationLanguage,
  type TranslationMemoryEntry,
} from './oldBooksStore'
import {
  listVisionModels,
  requestTextTranslation,
  requestVisionAnswer,
  requestVisionTranslation,
  type LocalVisionModel,
  type VisionTranslationResult,
} from './localVision'
import { getPdfPageCount, renderPdfPageSnapshot, renderPdfPageSnapshotsStream, type RenderedPdfSnapshot } from './pdfPageSnapshot'
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

type WorkspaceTab = 'books' | 'contents' | 'preview' | 'translation'
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

const resourceTypes: ResourceType[] = ['link', 'image', 'video', 'prompt', 'download']
const personas: NodePersona[] = ['default', 'kids', 'beginner', 'formal', 'college']
const llmRouterEndpoint = '/api/llm-router/v1'
const llmRouterModel = 'gpt-5.4-nano'
const legacyRouterEndpoint = 'http://localhost:1235'
const legacyRouterModel = 'gpt-5.4-nano'
const defaultRouterEndpoint = llmRouterEndpoint
const defaultRouterModel = llmRouterModel

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

function getStoredTranslation(
  book: OldBookRecord,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  sectionTitle: string,
) {
  const exactSection = book.translations.find((translation) =>
    translation.pageNumber === book.pageNumber
    && translation.sectionTitle === sectionTitle
    && translation.complexity === complexity
    && translation.language === language
  )

  if (exactSection) return exactSection

  return book.translations.find((translation) =>
    translation.pageNumber === book.pageNumber
    && translation.complexity === complexity
    && translation.language === language
  )
}

function getTranslatedPageCount(
  book: OldBookRecord | undefined,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
) {
  if (!book?.pdfBlobId) return 0
  return new Set(
    book.translations
      .filter((translation) => translation.complexity === complexity && translation.language === language)
      .map((translation) => translation.pageNumber),
  ).size
}

function getCanonicalOriginalTranslation(book: OldBookRecord | undefined, pageNumber = book?.pageNumber) {
  if (!book || !pageNumber) return undefined
  return book.translations.find((translation) =>
    translation.pageNumber === pageNumber
    && translation.complexity === 'original'
    && translation.language === 'en'
  )
}

function getPreviousOriginalTranslation(book: OldBookRecord | undefined) {
  if (!book || book.pageNumber <= 1) return undefined
  return getCanonicalOriginalTranslation(book, book.pageNumber - 1)
}

function getPreviousPageTranslation(
  book: OldBookRecord | undefined,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
) {
  if (!book || book.pageNumber <= 1) return undefined
  return book.translations.find((translation) =>
    translation.pageNumber === book.pageNumber - 1
    && translation.complexity === complexity
    && translation.language === language
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
      approved: false,
      createdAt: now,
      updatedAt: now,
    }))

  return additions.length ? [...memory, ...additions] : memory
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
    ),
  ]
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function TranslationWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const translationAbortRef = useRef<AbortController | null>(null)
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
  const [availableVisionModels, setAvailableVisionModels] = useState<LocalVisionModel[]>([])
  const [visionModelsLoading, setVisionModelsLoading] = useState(false)
  const [visionModelsStatus, setVisionModelsStatus] = useState('')
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [activeSnapshotPage, setActiveSnapshotPage] = useState<number | null>(null)
  const [snapshotViewMode, setSnapshotViewMode] = useState<'all' | 'page'>('all')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [sourceInspectorOpen, setSourceInspectorOpen] = useState(false)
  const [forceRetranslate, setForceRetranslate] = useState(false)
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
  const activeTranslation = activeBook ? getStoredTranslation(activeBook, complexity, translationLanguage, activeSection) : undefined
  const canonicalOriginalTranslation = getCanonicalOriginalTranslation(activeBook)
  const previousOriginalTranslation = getPreviousOriginalTranslation(activeBook)
  const activePageSnapshot = activeBook?.pageSnapshots.find((snapshot) => snapshot.pageNumber === activeBook.pageNumber)
  const hasImportedPdf = Boolean(activeBook?.pdfBlobId)
  const activePageNumber = activeBook?.pageNumber ?? 1
  const activePageLimit = activeBook?.pages && activeBook.pages > 0 ? activeBook.pages : undefined
  const activePageCount = activePageLimit ?? Math.max(activePageSnapshot?.pageNumber ?? 0, activePageNumber, 1)
  const translatedPageCount = getTranslatedPageCount(activeBook, complexity, translationLanguage)
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

  async function refreshVisionModels(endpointOverride = visionEndpoint, preferredModel = visionModel) {
    setVisionModelsLoading(true)
    setVisionModelsStatus('Loading router models...')
    try {
      const models = await listVisionModels(endpointOverride)
      const modelIds = models.map((entry) => entry.id)
      setAvailableVisionModels(models)
      if (modelIds.length && !modelIds.includes(preferredModel)) {
        setVisionModel(modelIds.includes(llmRouterModel) ? llmRouterModel : modelIds[0])
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
    if (migratedEndpoint !== visionEndpoint) setVisionEndpoint(migratedEndpoint)
    if (migratedModel !== visionModel) setVisionModel(migratedModel)
    void refreshVisionModels(migratedEndpoint, migratedModel)
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

  async function setReaderPage(pageNumber: number) {
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

    try {
      await saveOldBookRecord(updatedBook)
    } catch (error) {
      setOldBookStatus(error instanceof Error ? error.message : String(error))
    }
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

      const snapshotRecords = []
      await renderPdfPageSnapshotsStream(activePdfBlob, {
        maxWidth: 1000,
        pages: missingPages,
        onProgress: async (pageNumber, pageCount, current) => {
          setSnapshotProgress({
            phase: 'rendering',
            current: skippedPages + current,
            total: totalPages,
            message: `Rendering page ${pageNumber} of ${pageCount}`,
          })
          ;({ updatedBook: workingBook, updatedJob } = await persistSnapshotJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            phase: 'rendering',
            completedPages: snapshotRecords.length,
            skippedPages,
            message: `Rendering snapshot ${pageNumber} of ${pageCount}...`,
          }))
          job = updatedJob
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
          snapshotRecords.push(snapshotRecord)
          workingBook = {
            ...workingBook,
            pages: totalPages,
            pageSnapshots: [
              snapshotRecord,
              ...workingBook.pageSnapshots.filter((entry) => entry.pageNumber !== snapshotRecord.pageNumber),
            ],
          }
          ;({ updatedBook: workingBook, updatedJob } = await persistSnapshotJob(workingBook, {
            ...job,
            currentPage: renderedSnapshot.pageNumber,
            totalPages,
            phase: 'saving',
            completedPages: current,
            skippedPages,
            message: `Saved ${current} of ${missingPages.length} missing snapshots. Last saved page ${renderedSnapshot.pageNumber}.`,
          }))
          job = updatedJob
          await yieldToBrowser()
        },
      })

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
      model: visionModel,
      imageDataUrl: snapshotImageDataUrl,
      bookTitle: bookForTranslation.title,
      pageNumber: bookForTranslation.pageNumber,
      complexityLabel: 'Original',
      languageLabel: 'English',
      complexity: 'original',
      language: 'en',
      previousOriginalParagraphs: getPreviousOriginalTranslation(bookForTranslation)?.paragraphs,
      previousSourceLines: getPreviousOriginalTranslation(bookForTranslation)?.sourceLines,
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
      },
    )
  }

  function createPageTranslationFromResult(
    bookForTranslation: OldBookRecord,
    result: VisionTranslationResult,
    outputComplexity = complexity,
    outputLanguage = translationLanguage,
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

        let originalTranslation = getCanonicalOriginalTranslation(updatedBook)
        if (!originalTranslation) {
          setOldBookStatus(`Transcribing source text and creating Original English for page ${updatedBook.pageNumber}...`)
          originalTranslation = await createOriginalTranslationFromSnapshot(updatedBook, snapshot.imageDataUrl, abortController.signal)
          translationsForSave = replaceTranslationRecord(translationsForSave, originalTranslation)
          translationMemoryForSave = mergeTranslationMemorySuggestions(translationMemoryForSave, originalTranslation.glossary)
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
            previousOriginalParagraphs: getPreviousOriginalTranslation(bookForTranslation)?.paragraphs,
            previousTranslatedParagraphs: getPreviousPageTranslation(bookForTranslation, complexity, translationLanguage)?.paragraphs,
            signal: abortController.signal,
          })
          translation = createPageTranslationFromResult(bookForTranslation, rewrittenTranslation)
          translationsForSave = replaceTranslationRecord(translationsForSave, translation)
        }
      }

      if (!translation) {
        translation = createTranslationRecord(bookForTranslation, complexity, translationLanguage, activeSection)
        translationsForSave = replaceTranslationRecord(translationsForSave, translation)
      } else if (complexity === 'original') {
        translationsForSave = replaceTranslationRecord(translationsForSave, translation)
      }

      const translatedPagesAfterSave = getTranslatedPageCount(
        { ...bookForTranslation, translations: translationsForSave },
        complexity,
        translationLanguage,
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
    const reusableJob = !forceRetranslate
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
        message: forceRetranslate ? 'Starting forced Translate All...' : 'Starting Translate All...',
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

      let translatedCount = forceRetranslate ? 0 : job.completedPages
      let skippedCount = forceRetranslate ? 0 : job.skippedPages
      const resumePage = job.phase === 'persist'
        ? (job.currentPage || 1) + 1
        : job.currentPage || 1
      const startPage = forceRetranslate ? 1 : Math.min(Math.max(1, resumePage), totalPages)

      for (let pageNumber = startPage; pageNumber <= totalPages; pageNumber += 1) {
        let pageBook: OldBookRecord = {
          ...workingBook,
          pageNumber,
          section: getStoredTranslation({ ...workingBook, pageNumber }, complexity, translationLanguage, `Page ${pageNumber}`)
            ?.sectionTitle ?? `Page ${pageNumber}, OCR pending`,
        }

        const originalExists = Boolean(getCanonicalOriginalTranslation(pageBook, pageNumber))
        const targetExists = Boolean(pageBook.translations.find((entry) =>
          entry.pageNumber === pageNumber
          && entry.complexity === complexity
          && entry.language === translationLanguage
        ))

        if (!forceRetranslate && originalExists && targetExists) {
          skippedCount += 1
          ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            skippedPages: skippedCount,
            phase: 'persist',
            message: `Skipping page ${pageNumber} of ${totalPages}; already translated.`,
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
          message: `Preparing page ${pageNumber} of ${totalPages}...`,
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
        let originalTranslation = getCanonicalOriginalTranslation(pageBook, pageNumber)

        if (!originalTranslation || (forceRetranslate && complexity === 'original')) {
          ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
            ...job,
            currentPage: pageNumber,
            totalPages,
            phase: 'source',
            completedPages: translatedCount,
            skippedPages: skippedCount,
            message: `Transcribing source text and creating Original English for page ${pageNumber} of ${totalPages}...`,
          }))
          job = updatedJob
          originalTranslation = await createOriginalTranslationFromSnapshot(pageBook, snapshot.imageDataUrl, abortController.signal)
          translationsForSave = replaceTranslationRecord(translationsForSave, originalTranslation)
          memoryForSave = mergeTranslationMemorySuggestions(memoryForSave, originalTranslation.glossary)
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
            message: `Rewriting page ${pageNumber} of ${totalPages} into ${selectedComplexity} ${selectedLanguage}...`,
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
            previousOriginalParagraphs: getPreviousOriginalTranslation(pageBook)?.paragraphs,
            previousTranslatedParagraphs: getPreviousPageTranslation(pageBook, complexity, translationLanguage)?.paragraphs,
            signal: abortController.signal,
          })
          const rewrittenRecord = createPageTranslationFromResult(pageBook, rewrittenTranslation)
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
        )
        ;({ updatedBook: workingBook, updatedJob } = await persistTranslationJob(workingBook, {
          ...job,
          currentPage: pageNumber,
          totalPages,
          phase: 'persist',
          completedPages: translatedCount,
          skippedPages: skippedCount,
          message: `Saving page ${pageNumber} of ${totalPages}...`,
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
              message: `Saved page ${pageNumber} of ${totalPages}.`,
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
        currentPage: totalPages,
        totalPages,
        completedPages: translatedCount,
        skippedPages: skippedCount,
        message: `Translate All complete. Updated ${translatedCount} pages, skipped ${skippedCount}.`,
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
          imageDataUrl: snapshot.imageDataUrl,
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
                  setOldBookStatus('Using the BookForge LLM router at /api/llm-router/v1.')
                  void refreshVisionModels(llmRouterEndpoint, llmRouterModel)
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
              {forceRetranslate ? 'Force Retranslate' : hasResumableTranslationJob ? 'Resume Translate' : 'Translate All'}
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
                <img src={activePageSnapshot.imageDataUrl} alt={`Snapshot of page ${activePageNumber}`} />
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
              <p>{activeTranslation ? 'Stored page translation' : 'Page translation pending'} · Page {activePageNumber}</p>
            </div>
            <div className="progress-summary">
              <span>{currentProgress}%</span>
              <div aria-hidden="true"><i style={{ width: `${currentProgress}%` }} /></div>
            </div>
          </header>

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
                disabled={!currentSourceLines.length && !previousSourceLines.length}
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
            {translatedParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </article>
      </section>

      {sourceInspectorOpen ? (
        <div className="modal-backdrop">
          <section className="modal-panel source-modal">
            <header className="modal-header">
              <div>
                <h2>Source Transcription</h2>
                <p>{activeBook?.title ?? 'Imported book'} · Page {activePageNumber}</p>
              </div>
              <button className="icon-button" onClick={() => setSourceInspectorOpen(false)} type="button">x</button>
            </header>

            <div className="source-inspector-grid">
              <section className="source-lines-panel">
                <header>
                  <strong>Previous page context</strong>
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
                  <strong>Current page source</strong>
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
            </div>
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
              <button className="icon-button" onClick={() => setMemoryOpen(false)} type="button">x</button>
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
                      <img src={snapshot.imageDataUrl} alt="" />
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
                      <a className="mini-button" href={selectedSnapshot.imageDataUrl} target="_blank" rel="noreferrer">
                        Open Image
                      </a>
                    </div>
                    <div className="snapshot-preview-stage">
                      <img src={selectedSnapshot.imageDataUrl} alt={`Snapshot of page ${selectedSnapshot.pageNumber}`} />
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
    const blob = new Blob([payload], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${book.title || 'bookforge'}.json`
    link.click()
    URL.revokeObjectURL(link.href)
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
