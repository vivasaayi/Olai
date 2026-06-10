import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
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

type WorkspaceTab = 'books' | 'contents'
type BookSettingsMode = 'create' | 'edit'

const resourceTypes: ResourceType[] = ['link', 'image', 'video', 'prompt', 'download']
const personas: NodePersona[] = ['default', 'kids', 'beginner', 'formal', 'college']
const defaultRouterEndpoint = 'http://localhost:1235'
const defaultRouterModel = 'gpt-5.4-nano'

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

function App() {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('books')
  const [book, setBook] = useState<Book>(() => createInitialBook())
  const [activeNodeId, setActiveNodeId] = useState(() => findFirstNodeId(book.outline))
  const [activeFileName, setActiveFileName] = useState<string | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [bookSettingsDraft, setBookSettingsDraft] = useState<Book | null>(null)
  const [bookSettingsMode, setBookSettingsMode] = useState<BookSettingsMode>('edit')
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
            const content = (await invoke('load_book', { file_name: fileName })) as string
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
    const fileName = (await invoke('save_book', { book_id: updated.id, payload })) as string
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

  function openEditBookModal() {
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

  async function deleteBook(entry: LibraryEntry) {
    const confirmed = window.confirm(`Delete "${entry.book.title}" from local storage?`)
    if (!confirmed) return

    try {
      await invoke('delete_book', { file_name: entry.fileName })
      if (entry.fileName === activeFileName) {
        newBook()
      }
      await refreshLibrary()
      setStatusText(`Deleted ${entry.book.title}.`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeCurrentBook() {
    if (activeLibraryEntry) {
      await deleteBook(activeLibraryEntry)
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
                  Add
                </button>
                <button className="button secondary" onClick={openEditBookModal} type="button">
                  Edit
                </button>
                <button className="button danger" onClick={() => void removeCurrentBook()} type="button">
                  Remove
                </button>
                <button className="button secondary" onClick={() => void refreshLibrary()} type="button" disabled={libraryBusy}>
                  {libraryBusy ? 'Refreshing...' : 'Refresh'}
                </button>
                <button className="button" onClick={() => setActiveWorkspaceTab('contents')} type="button">
                  Open Contents
                </button>
              </div>
            </div>

            <div className="book-tabs book-tabs-large" role="tablist" aria-label="Books">
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
                      {tab.audience ? ` · ${tab.audience}` : ''}
                    </span>
                  </button>
                )
              })}
              {!bookTabs.length ? <p className="muted">No books available.</p> : null}
            </div>

            {statusText ? <p className="status">{statusText}</p> : null}
          </section>
        </main>
      ) : (
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
                <button className="button secondary" onClick={openEditBookModal} type="button">
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
                      onChange={(event) =>
                        updateActiveNode((node) => ({ ...node, type: event.currentTarget.value as OutlineNodeType }))
                      }
                    >
                      <option value="chapter">Chapter</option>
                      <option value="section">Section</option>
                    </select>
                  </label>
                  <label>
                    <span>Title</span>
                    <input value={activeNode.title} onChange={(event) => updateActiveNode((node) => ({ ...node, title: event.currentTarget.value }))} />
                  </label>
                  <label>
                    <span>Persona</span>
                    <select
                      value={activeNode.persona}
                      onChange={(event) =>
                        updateActiveNode((node) => ({ ...node, persona: event.currentTarget.value as NodePersona }))
                      }
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
                    <textarea value={activeNode.intent} onChange={(event) => updateActiveNode((node) => ({ ...node, intent: event.currentTarget.value }))} rows={3} />
                  </label>
                  <label className="full-width">
                    <span>Summary</span>
                    <textarea value={activeNode.summary} onChange={(event) => updateActiveNode((node) => ({ ...node, summary: event.currentTarget.value }))} rows={3} />
                  </label>
                  <label className="full-width">
                    <span>Content draft</span>
                    <textarea value={activeNode.content} onChange={(event) => updateActiveNode((node) => ({ ...node, content: event.currentTarget.value }))} rows={7} />
                  </label>
                  <label className="full-width">
                    <span>Keywords</span>
                    <input
                      value={keywordsValue}
                      onChange={(event) =>
                        updateActiveNode((node) => ({
                          ...node,
                          keywords: event.currentTarget.value.split(',').map((keyword) => keyword.trim()).filter(Boolean),
                        }))
                      }
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
                      <select value={resource.type} onChange={(event) => updateResource(resource.id, (entry) => ({ ...entry, type: event.currentTarget.value as ResourceType }))}>
                        {resourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                      <input value={resource.label} onChange={(event) => updateResource(resource.id, (entry) => ({ ...entry, label: event.currentTarget.value }))} />
                      <input value={resource.value} onChange={(event) => updateResource(resource.id, (entry) => ({ ...entry, value: event.currentTarget.value }))} />
                      <input value={resource.description ?? ''} onChange={(event) => updateResource(resource.id, (entry) => ({ ...entry, description: event.currentTarget.value }))} />
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
