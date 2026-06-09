import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import ModelsPage from './pages/Models'
import ChatPage from './pages/Chat'
import type { Book, Chapter, Resource, ResourceType, Section } from './types'

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2, 10)}`

const createSection = (): Section => ({
  id: createId(),
  title: 'New Section',
  intent: '',
  summary: '',
  content: '',
  keywords: [],
  persona: 'default',
  durationMinutes: undefined,
  resources: [],
})

const createChapter = (): Chapter => ({
  id: createId(),
  title: 'New Chapter',
  synopsis: '',
  goals: '',
  sections: [createSection()],
})

const createInitialBook = (): Book => ({
  id: createId(),
  title: 'Untitled Manuscript',
  synopsis: '',
  audience: '',
  tone: 'Neutral',
  tags: [],
  chapters: [createChapter()],
})

const resourceTypes: ResourceType[] = ['link', 'image', 'video', 'prompt', 'download']

const initialBook = createInitialBook()

function App() {
  const [book, setBook] = useState<Book>(initialBook)
  const [activeChapterId, setActiveChapterId] = useState<string>(initialBook.chapters[0]?.id ?? '')
  const [activeSectionId, setActiveSectionId] = useState<string>(
    initialBook.chapters[0]?.sections[0]?.id ?? '',
  )
  const [page, setPage] = useState<'outline' | 'agents' | 'chat'>('outline')
  const [savedBooks, setSavedBooks] = useState<string[]>([])
  const [selectedSavedBook, setSelectedSavedBook] = useState<string>('')

  useEffect(() => {
    if (!book.chapters.length) {
      const fallbackChapter = createChapter()
      setBook((prev) => ({ ...prev, chapters: [fallbackChapter] }))
      setActiveChapterId(fallbackChapter.id)
      setActiveSectionId(fallbackChapter.sections[0].id)
      return
    }

    const chapter = book.chapters.find((entry) => entry.id === activeChapterId)
    if (!chapter) {
      const fallback = book.chapters[0]
      setActiveChapterId(fallback.id)
      setActiveSectionId(fallback.sections[0].id)
      return
    }

    const section = chapter.sections.find((entry) => entry.id === activeSectionId)
    if (!section) {
      setActiveSectionId(chapter.sections[0].id)
    }
  }, [book, activeChapterId, activeSectionId])

  const activeChapter = book.chapters.find((chapter) => chapter.id === activeChapterId) ?? book.chapters[0]
  const activeSection =
    activeChapter?.sections.find((section) => section.id === activeSectionId) ??
    activeChapter?.sections[0]

  const updateBookMeta = <K extends keyof Book>(field: K, value: Book[K]) => {
    setBook((prev) => ({ ...prev, [field]: value }))
  }

  const updateChapter = (chapterId: string, updater: (chapter: Chapter) => Chapter) => {
    setBook((prev) => ({
      ...prev,
      chapters: prev.chapters.map((chapter) => (chapter.id === chapterId ? updater(chapter) : chapter)),
    }))
  }

  const updateSection = (
    chapterId: string,
    sectionId: string,
    updater: (section: Section) => Section,
  ) => {
    updateChapter(chapterId, (chapter) => ({
      ...chapter,
      sections: chapter.sections.map((section) =>
        section.id === sectionId ? updater(section) : section,
      ),
    }))
  }

  const addChapter = () => {
    const chapter = createChapter()
    setBook((prev) => ({ ...prev, chapters: [...prev.chapters, chapter] }))
    setActiveChapterId(chapter.id)
    setActiveSectionId(chapter.sections[0].id)
  }

  const removeChapter = (chapterId: string) => {
    setBook((prev) => {
      if (prev.chapters.length === 1) {
        return prev
      }

      const chapters = prev.chapters.filter((chapter) => chapter.id !== chapterId)
      const nextBook = { ...prev, chapters }

      if (!chapters.some((chapter) => chapter.id === activeChapterId) && chapters.length) {
        const fallback = chapters[0]
        setActiveChapterId(fallback.id)
        setActiveSectionId(fallback.sections[0].id)
      }

      return nextBook
    })
  }

  const addSection = (chapterId: string) => {
    const section = createSection()
    updateChapter(chapterId, (chapter) => ({
      ...chapter,
      sections: [...chapter.sections, section],
    }))
    setActiveChapterId(chapterId)
    setActiveSectionId(section.id)
  }

  const removeSection = (chapterId: string, sectionId: string) => {
    updateChapter(chapterId, (chapter) => {
      if (chapter.sections.length === 1) {
        return chapter
      }

      const sections = chapter.sections.filter((section) => section.id !== sectionId)
      if (!sections.some((section) => section.id === activeSectionId)) {
        setActiveSectionId(sections[0].id)
      }
      return { ...chapter, sections }
    })
  }

  const addResource = (chapterId: string, sectionId: string) => {
    const resource: Resource = {
      id: createId(),
      type: 'link',
      label: 'Resource title',
      value: '',
      description: '',
    }

    updateSection(chapterId, sectionId, (section) => ({
      ...section,
      resources: [...section.resources, resource],
    }))
  }

  const updateResource = (
    chapterId: string,
    sectionId: string,
    resourceId: string,
    updater: (resource: Resource) => Resource,
  ) => {
    updateSection(chapterId, sectionId, (section) => ({
      ...section,
      resources: section.resources.map((resource) =>
        resource.id === resourceId ? updater(resource) : resource,
      ),
    }))
  }

  const removeResource = (chapterId: string, sectionId: string, resourceId: string) => {
    updateSection(chapterId, sectionId, (section) => ({
      ...section,
      resources: section.resources.filter((resource) => resource.id !== resourceId),
    }))
  }

  const exportStructure = () => {
    const payload = JSON.stringify(book, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${book.title || 'bookforge'}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const refreshSavedBooks = async () => {
    try {
      // list_books returns a Vec<String>
      const items = (await invoke('list_books')) as string[]
      setSavedBooks(items)
      if (items.length && !items.includes(selectedSavedBook)) {
        setSelectedSavedBook(items[0])
      }
    } catch (err) {
      console.error('list_books error', err)
    }
  }

  const saveToLocal = async () => {
    try {
      const payload = JSON.stringify(book, null, 2)
      // save_book(book_id: String, payload: String)
      const name = (await invoke('save_book', { book_id: book.id, payload })) as string
      // result is the filename
      await refreshSavedBooks()
      console.log('Saved to', name)
    } catch (err) {
      console.error('save_book error', err)
    }
  }

  const loadFromLocal = async () => {
    try {
      if (!selectedSavedBook) return
      const content = (await invoke('load_book', { file_name: selectedSavedBook })) as string
      const parsed = JSON.parse(content) as Book
      setBook(parsed)
      // select first chapter/section
      setActiveChapterId(parsed.chapters[0].id)
      setActiveSectionId(parsed.chapters[0].sections[0].id)
    } catch (err) {
      console.error('load_book error', err)
    }
  }

  const tagsValue = book.tags.join(', ')
  const keywordsValue = activeSection?.keywords.join(', ') ?? ''

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-overline">Author Workspace</p>
          <h1 className="app-title">BookForge Designer</h1>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={addChapter} type="button">
            + Chapter
          </button>
            <button className="button" onClick={saveToLocal} type="button">
              Save
            </button>
            <button className="button" onClick={refreshSavedBooks} type="button">
              Refresh
            </button>
            <select value={selectedSavedBook} onChange={(e) => setSelectedSavedBook(e.target.value)}>
              <option value="">(Select saved)</option>
              {savedBooks.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="button" onClick={loadFromLocal} type="button">
              Load
            </button>
          <button className="button" onClick={exportStructure} type="button">
            Export JSON
          </button>
          <button className="button" onClick={() => setPage('agents')} type="button">
            Agents
          </button>
          <button className="button" onClick={() => setPage('chat')} type="button">
            Chat
          </button>
        </div>
      </header>

      <div className="app-main">
        <aside className="panel outline-panel">
          <div className="panel-heading">
            <h2>Outline</h2>
            <p className="panel-subtitle">Manage chapters and sections</p>
          </div>
          <div className="outline-tree">
            {book.chapters.map((chapter) => (
              <div key={chapter.id} className="outline-chapter">
                <div className="outline-chapter-header">
                  <button
                    className={
                      chapter.id === activeChapter?.id ? 'outline-label active' : 'outline-label'
                    }
                    onClick={() => {
                      setActiveChapterId(chapter.id)
                      setActiveSectionId(chapter.sections[0].id)
                    }}
                    type="button"
                  >
                    {chapter.title || 'Untitled chapter'}
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => removeChapter(chapter.id)}
                    disabled={book.chapters.length === 1}
                    title="Remove chapter"
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <div className="outline-section-list">
                  {chapter.sections.map((section) => (
                    <button
                      key={section.id}
                      className={
                        section.id === activeSection?.id
                          ? 'outline-section active'
                          : 'outline-section'
                      }
                      onClick={() => {
                        setActiveChapterId(chapter.id)
                        setActiveSectionId(section.id)
                      }}
                      type="button"
                    >
                      {section.title || 'Untitled section'}
                    </button>
                  ))}
                  <button className="button ghost" onClick={() => addSection(chapter.id)} type="button">
                    + Section
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="panel detail-panel">
          <section className="card">
            <header className="card-header">
              <h2>Book settings</h2>
              <p>Define global tone, audience, and tags.</p>
            </header>
            <div className="form-grid">
              <label>
                <span>Title</span>
                <input
                  value={book.title}
                  onChange={(event) => updateBookMeta('title', event.currentTarget.value)}
                  placeholder="e.g. Fundamentals of Robotics"
                />
              </label>
              <label>
                <span>Primary audience</span>
                <input
                  value={book.audience}
                  onChange={(event) => updateBookMeta('audience', event.currentTarget.value)}
                  placeholder="Kids, Beginners, College..."
                />
              </label>
              <label>
                <span>Preferred tone</span>
                <select
                  value={book.tone}
                  onChange={(event) => updateBookMeta('tone', event.currentTarget.value)}
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
                  value={book.synopsis}
                  onChange={(event) => updateBookMeta('synopsis', event.currentTarget.value)}
                  placeholder="High-level overview of the learning journey."
                  rows={3}
                />
              </label>
              <label className="full-width">
                <span>Tags</span>
                <input
                  value={tagsValue}
                  onChange={(event) => {
                    const tags = event.currentTarget.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                    updateBookMeta('tags', tags)
                  }}
                  placeholder="comma separated (e.g. STEM, robotics, hardware)"
                />
              </label>
            </div>
          </section>

          {activeChapter && (
            <section className="card">
              <header className="card-header">
                <div>
                  <h2>Chapter details</h2>
                  <p>Structure intent and summary for this chapter.</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => addSection(activeChapter.id)}
                  type="button"
                >
                  + Section
                </button>
              </header>
              <div className="form-grid">
                <label>
                  <span>Title</span>
                  <input
                    value={activeChapter.title}
                    onChange={(event) =>
                      updateChapter(activeChapter.id, (chapter) => ({
                        ...chapter,
                        title: event.currentTarget.value,
                      }))
                    }
                    placeholder="Chapter title"
                  />
                </label>
                <label>
                  <span>Goals</span>
                  <textarea
                    value={activeChapter.goals}
                    onChange={(event) =>
                      updateChapter(activeChapter.id, (chapter) => ({
                        ...chapter,
                        goals: event.currentTarget.value,
                      }))
                    }
                    placeholder="Learning outcomes, prerequisite concepts..."
                    rows={3}
                  />
                </label>
                <label className="full-width">
                  <span>Synopsis</span>
                  <textarea
                    value={activeChapter.synopsis}
                    onChange={(event) =>
                      updateChapter(activeChapter.id, (chapter) => ({
                        ...chapter,
                        synopsis: event.currentTarget.value,
                      }))
                    }
                    placeholder="Narrative summary used for AI prompting."
                    rows={3}
                  />
                </label>
              </div>
            </section>
          )}

          {activeChapter && activeSection && (
            <section className="card">
              <header className="card-header">
                <div>
                  <h2>Section content</h2>
                  <p>Create structured prompts, narrative, and supporting assets.</p>
                </div>
                <button
                  className="button danger"
                  onClick={() => removeSection(activeChapter.id, activeSection.id)}
                  disabled={activeChapter.sections.length === 1}
                  type="button"
                >
                  Remove section
                </button>
              </header>
              <div className="form-grid">
                <label>
                  <span>Title</span>
                  <input
                    value={activeSection.title}
                    onChange={(event) =>
                      updateSection(activeChapter.id, activeSection.id, (section) => ({
                        ...section,
                        title: event.currentTarget.value,
                      }))
                    }
                    placeholder="Section title"
                  />
                </label>
                <label>
                  <span>Persona</span>
                  <select
                    value={activeSection.persona}
                    onChange={(event) =>
                      updateSection(activeChapter.id, activeSection.id, (section) => ({
                        ...section,
                        persona: event.currentTarget.value as Section['persona'],
                      }))
                    }
                  >
                    <option value="default">Default</option>
                    <option value="kids">Kids</option>
                    <option value="beginner">Beginner</option>
                    <option value="formal">Formal</option>
                    <option value="college">College</option>
                  </select>
                </label>
                <label>
                  <span>Duration (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    value={activeSection.durationMinutes ?? ''}
                    onChange={(event) =>
                      updateSection(activeChapter.id, activeSection.id, (section) => {
                        const minutes = Number.parseInt(event.currentTarget.value, 10)
                        return {
                          ...section,
                          durationMinutes: Number.isNaN(minutes) ? undefined : minutes,
                        }
                      })
                    }
                    placeholder="Estimated reading time"
                  />
                </label>
                <label className="full-width">
                  <span>Intent & prompts</span>
                  <textarea
                    value={activeSection.intent}
                    onChange={(event) =>
                      updateSection(activeChapter.id, activeSection.id, (section) => ({
                        ...section,
                        intent: event.currentTarget.value,
                      }))
                    }
                    placeholder="Prompt instructions or objectives for the LLM."
                    rows={3}
                  />
                </label>
                <label className="full-width">
                  <span>Summary</span>
                  <textarea
                    value={activeSection.summary}
                    onChange={(event) =>
                      updateSection(activeChapter.id, activeSection.id, (section) => ({
                        ...section,
                        summary: event.currentTarget.value,
                      }))
                    }
                    placeholder="High-level description used for previews."
                    rows={3}
                  />
                </label>
                <label className="full-width">
                  <span>Content draft</span>
                  <textarea
                    value={activeSection.content}
                    onChange={(event) =>
                      updateSection(activeChapter.id, activeSection.id, (section) => ({
                        ...section,
                        content: event.currentTarget.value,
                      }))
                    }
                    placeholder="Author notes, key paragraphs, or LLM output."
                    rows={6}
                  />
                </label>
                <label className="full-width">
                  <span>Keywords</span>
                  <input
                    value={keywordsValue}
                    onChange={(event) => {
                      const keywords = event.currentTarget.value
                        .split(',')
                        .map((keyword) => keyword.trim())
                        .filter(Boolean)
                      updateSection(activeChapter.id, activeSection.id, (section) => ({
                        ...section,
                        keywords,
                      }))
                    }}
                    placeholder="comma separated (e.g. torque, motors, sensors)"
                  />
                </label>
              </div>

              <div className="resources">
                <div className="resources-header">
                  <h3>Resources & media</h3>
                  <button
                    className="button secondary"
                    onClick={() => addResource(activeChapter.id, activeSection.id)}
                    type="button"
                  >
                    + Resource
                  </button>
                </div>

                {!activeSection.resources.length && (
                  <p className="muted">Attach links, images, prompts, or downloads that enhance this section.</p>
                )}

                {activeSection.resources.map((resource) => (
                  <div key={resource.id} className="resource-row">
                    <select
                      value={resource.type}
                      onChange={(event) =>
                        updateResource(activeChapter.id, activeSection.id, resource.id, (entry) => ({
                          ...entry,
                          type: event.currentTarget.value as ResourceType,
                        }))
                      }
                    >
                      {resourceTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <input
                      value={resource.label}
                      onChange={(event) =>
                        updateResource(activeChapter.id, activeSection.id, resource.id, (entry) => ({
                          ...entry,
                          label: event.currentTarget.value,
                        }))
                      }
                      placeholder="Display name"
                    />
                    {resource.type === 'prompt' ? (
                      <textarea
                        value={resource.value}
                        onChange={(event) =>
                          updateResource(activeChapter.id, activeSection.id, resource.id, (entry) => ({
                            ...entry,
                            value: event.currentTarget.value,
                          }))
                        }
                        placeholder="Prompt text"
                        rows={3}
                      />
                    ) : (
                      <input
                        value={resource.value}
                        onChange={(event) =>
                          updateResource(activeChapter.id, activeSection.id, resource.id, (entry) => ({
                            ...entry,
                            value: event.currentTarget.value,
                          }))
                        }
                        placeholder="URL or reference"
                      />
                    )}
                    <input
                      value={resource.description ?? ''}
                      onChange={(event) =>
                        updateResource(activeChapter.id, activeSection.id, resource.id, (entry) => ({
                          ...entry,
                          description: event.currentTarget.value,
                        }))
                      }
                      placeholder="Notes"
                    />
                    <button
                      className="icon-button"
                      onClick={() => removeResource(activeChapter.id, activeSection.id, resource.id)}
                      title="Remove resource"
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {page === 'agents' && (
          <aside className="panel preview-panel">
            <ModelsPage />
          </aside>
        )}

        {page === 'chat' && (
          <aside className="panel preview-panel">
            <ChatPage />
          </aside>
        )}

        <aside className="panel preview-panel">
          <header className="panel-heading">
            <h2>Structure preview</h2>
            <p className="panel-subtitle">Snapshot of the generated JSON.</p>
          </header>
          <pre className="preview-json">{JSON.stringify(book, null, 2)}</pre>
        </aside>
      </div>
    </div>
  )
}

export default App