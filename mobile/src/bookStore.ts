import * as FileSystem from "expo-file-system";
import { deletePaperAssets } from "./paperAssets";
import type {
  AiNote,
  AiNoteKind,
  Book,
  BookSource,
  NodePersona,
  OutlineNode,
  OutlineNodeType,
  Resource,
  ResourceType,
  TokenUsage,
} from "./types";

const resourceTypes: ResourceType[] = ["image", "video", "link", "prompt", "download", "pdf"];
const personas: NodePersona[] = ["default", "kids", "beginner", "formal", "college"];
const aiNoteKinds: AiNoteKind[] = ["paper", "concept", "section", "summary", "method", "critique", "question"];

export const createId = () => `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeTokenUsage(value: unknown): TokenUsage | undefined {
  const raw = asRecord(value);
  const usage = {
    inputTokens: asOptionalNumber(raw.inputTokens),
    outputTokens: asOptionalNumber(raw.outputTokens),
    totalTokens: asOptionalNumber(raw.totalTokens),
  };

  return usage.inputTokens !== undefined || usage.outputTokens !== undefined || usage.totalTokens !== undefined
    ? usage
    : undefined;
}

function stableId(prefix: string, fallback: string, value: unknown) {
  const existing = asString(value).trim();
  return existing || `${prefix}-${fallback}`;
}

function normalizeResource(value: unknown, index: number): Resource {
  const raw = asRecord(value);
  const type = asString(raw.type, "link") as ResourceType;
  return {
    id: stableId("resource", String(index + 1), raw.id),
    type: resourceTypes.includes(type) ? type : "link",
    label: asString(raw.label, "Resource"),
    value: asString(raw.value),
    description: asString(raw.description),
  };
}

export function createOutlineNode(type: OutlineNodeType, title?: string, children: OutlineNode[] = []): OutlineNode {
  return {
    id: createId(),
    type,
    title: title ?? (type === "chapter" ? "New Chapter" : "New Section"),
    intent: "",
    summary: "",
    content: "",
    keywords: [],
    persona: "default",
    durationMinutes: undefined,
    resources: [],
    children,
  };
}

export function createInitialBook(): Book {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: "Untitled Book",
    synopsis: "",
    audience: "",
    tone: "Neutral",
    tags: [],
    outline: [createOutlineNode("chapter", "New Chapter", [createOutlineNode("section", "New Section")])],
    createdAt: now,
    updatedAt: now,
    source: { type: "bookforge" },
    aiNotes: [],
  };
}

function normalizeOutlineNode(value: unknown, fallbackType: OutlineNodeType, index: number): OutlineNode {
  const raw = asRecord(value);
  const rawType = asString(raw.type, fallbackType) as OutlineNodeType;
  const type: OutlineNodeType = rawType === "chapter" || rawType === "section" ? rawType : fallbackType;
  const persona = asString(raw.persona, "default") as NodePersona;
  const legacySections = Array.isArray(raw.sections) ? raw.sections : undefined;
  const rawChildren = Array.isArray(raw.children) ? raw.children : legacySections;
  const children = rawChildren
    ? rawChildren.map((child, childIndex) => normalizeOutlineNode(child, "section", childIndex))
    : [];

  return {
    id: stableId(type, String(index + 1), raw.id),
    type,
    title: asString(raw.title, type === "chapter" ? `Chapter ${index + 1}` : `Section ${index + 1}`),
    intent: asString(raw.intent) || asString(raw.goals),
    summary: asString(raw.summary) || asString(raw.synopsis),
    content: asString(raw.content),
    keywords: asStringArray(raw.keywords),
    persona: personas.includes(persona) ? persona : "default",
    durationMinutes: asOptionalNumber(raw.durationMinutes),
    resources: Array.isArray(raw.resources)
      ? raw.resources.map((resource, resourceIndex) => normalizeResource(resource, resourceIndex))
      : [],
    children,
  };
}

function normalizeLegacyChapter(value: unknown, index: number): OutlineNode {
  const raw = asRecord(value);
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((section, sectionIndex) => normalizeOutlineNode(section, "section", sectionIndex))
    : [];

  return normalizeOutlineNode(
    {
      ...raw,
      type: "chapter",
      intent: asString(raw.goals),
      summary: asString(raw.synopsis),
      children: sections.length ? sections : [normalizeOutlineNode({}, "section", 0)],
    },
    "chapter",
    index,
  );
}

function normalizeSource(value: unknown): BookSource | undefined {
  const raw = asRecord(value);
  const type = asString(raw.type);
  if (!["bookforge", "arxiv", "open-web", "pdf", "archive-article"].includes(type)) {
    return undefined;
  }

  return {
    type: type as BookSource["type"],
    id: asString(raw.id) || undefined,
    url: asString(raw.url) || undefined,
    htmlUrl: asString(raw.htmlUrl) || undefined,
    pdfUrl: asString(raw.pdfUrl) || undefined,
    localHtmlPath: asString(raw.localHtmlPath) || undefined,
    localPdfPath: asString(raw.localPdfPath) || undefined,
    localTextPath: asString(raw.localTextPath) || undefined,
    authors: asStringArray(raw.authors),
    publishedAt: asString(raw.publishedAt) || undefined,
    journal: asString(raw.journal) || undefined,
    issueVolume: asString(raw.issueVolume) || undefined,
    issueNumber: asString(raw.issueNumber) || undefined,
    articleId: asString(raw.articleId) || undefined,
    archiveProvider: asString(raw.archiveProvider) || undefined,
    offlineStatus: asStringArray(raw.offlineStatus),
  };
}

function normalizeAiNote(value: unknown, index: number): AiNote {
  const raw = asRecord(value);
  const kind = asString(raw.kind, "section") as AiNoteKind;
  return {
    id: stableId("note", String(index + 1), raw.id),
    kind: aiNoteKinds.includes(kind) ? kind : "section",
    title: asString(raw.title, `AI Note ${index + 1}`),
    content: asString(raw.content),
    createdAt: asString(raw.createdAt) || new Date(0).toISOString(),
    sourceSectionId: asString(raw.sourceSectionId) || undefined,
    sourceSectionTitle: asString(raw.sourceSectionTitle) || undefined,
    question: asString(raw.question) || undefined,
    model: asString(raw.model) || undefined,
    tokenUsage: normalizeTokenUsage(raw.tokenUsage),
    tags: asStringArray(raw.tags),
  };
}

export function normalizeBook(value: unknown): Book {
  const raw = asRecord(value);
  const legacyOutline = Array.isArray(raw.chapters)
    ? raw.chapters.map((chapter, index) => normalizeLegacyChapter(chapter, index))
    : [];
  const outline = Array.isArray(raw.outline)
    ? raw.outline.map((node, index) => normalizeOutlineNode(node, "chapter", index))
    : legacyOutline;
  const title = asString(raw.title).trim();

  if (!title) {
    throw new Error("Book JSON must include a title.");
  }

  if (!outline.length) {
    throw new Error("Book JSON must include at least one outline item.");
  }

  return {
    id: stableId("book", title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "imported", raw.id),
    title,
    synopsis: asString(raw.synopsis),
    audience: asString(raw.audience),
    tone: asString(raw.tone, "Neutral"),
    tags: asStringArray(raw.tags),
    outline,
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) || new Date().toISOString(),
    source: normalizeSource(raw.source),
    aiNotes: Array.isArray(raw.aiNotes)
      ? raw.aiNotes.map((note, index) => normalizeAiNote(note, index))
      : [],
  };
}

export function outlineItemCount(book: Book) {
  const countNodes = (nodes: OutlineNode[]): number =>
    nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
  return countNodes(book.outline);
}

function prepareBookForSave(book: Book): Book {
  const now = new Date().toISOString();
  return {
    ...book,
    createdAt: book.createdAt || now,
    updatedAt: now,
    outline: book.outline.length ? book.outline : createInitialBook().outline,
  };
}

function bookDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error("Device document storage is unavailable.");
  }
  return `${FileSystem.documentDirectory}books/`;
}

function bookPath(bookId: string) {
  const safeId = bookId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return `${bookDirectory()}${safeId}.json`;
}

async function ensureBookDirectory() {
  const directory = bookDirectory();
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

export async function loadStoredBooks() {
  const directory = await ensureBookDirectory();
  const entries = await FileSystem.readDirectoryAsync(directory);
  const books: Book[] = [];

  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      const raw = await FileSystem.readAsStringAsync(`${directory}${entry}`);
      books.push(normalizeBook(JSON.parse(raw)));
    } catch {
      // Ignore malformed local files and keep the reader usable.
    }
  }

  return books.sort((left, right) => left.title.localeCompare(right.title));
}

export async function saveStoredBook(book: Book) {
  await ensureBookDirectory();
  const prepared = prepareBookForSave(book);
  await FileSystem.writeAsStringAsync(bookPath(prepared.id), JSON.stringify(prepared, null, 2));
}

export async function deleteStoredBook(bookId: string) {
  const path = bookPath(bookId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path);
  }
  await deletePaperAssets(bookId);
}
