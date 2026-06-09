import * as FileSystem from "expo-file-system";
import type { Book, BookSource, Chapter, Resource, ResourceType, Section, SectionPersona } from "./types";

const resourceTypes: ResourceType[] = ["image", "video", "link", "prompt", "download", "pdf"];
const personas: SectionPersona[] = ["default", "kids", "beginner", "formal", "college"];

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

function normalizeSection(value: unknown, chapterIndex: number, sectionIndex: number): Section {
  const raw = asRecord(value);
  const persona = asString(raw.persona, "default") as SectionPersona;
  return {
    id: stableId("section", `${chapterIndex + 1}-${sectionIndex + 1}`, raw.id),
    title: asString(raw.title, `Section ${sectionIndex + 1}`),
    intent: asString(raw.intent),
    summary: asString(raw.summary),
    content: asString(raw.content),
    keywords: asStringArray(raw.keywords),
    persona: personas.includes(persona) ? persona : "default",
    durationMinutes: asOptionalNumber(raw.durationMinutes),
    resources: Array.isArray(raw.resources)
      ? raw.resources.map((resource, index) => normalizeResource(resource, index))
      : [],
  };
}

function normalizeChapter(value: unknown, index: number): Chapter {
  const raw = asRecord(value);
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((section, sectionIndex) => normalizeSection(section, index, sectionIndex))
    : [];

  return {
    id: stableId("chapter", String(index + 1), raw.id),
    title: asString(raw.title, `Chapter ${index + 1}`),
    synopsis: asString(raw.synopsis),
    goals: asString(raw.goals),
    sections: sections.length ? sections : [normalizeSection({}, index, 0)],
  };
}

function normalizeSource(value: unknown): BookSource | undefined {
  const raw = asRecord(value);
  const type = asString(raw.type);
  if (!["bookforge", "arxiv", "open-web", "pdf"].includes(type)) {
    return undefined;
  }

  return {
    type: type as BookSource["type"],
    id: asString(raw.id) || undefined,
    url: asString(raw.url) || undefined,
    pdfUrl: asString(raw.pdfUrl) || undefined,
    authors: asStringArray(raw.authors),
    publishedAt: asString(raw.publishedAt) || undefined,
    journal: asString(raw.journal) || undefined,
  };
}

export function normalizeBook(value: unknown): Book {
  const raw = asRecord(value);
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters.map((chapter, index) => normalizeChapter(chapter, index))
    : [];

  const title = asString(raw.title).trim();
  if (!title) {
    throw new Error("Book JSON must include a title.");
  }

  if (!chapters.length) {
    throw new Error("Book JSON must include at least one chapter.");
  }

  return {
    id: stableId("book", title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "imported", raw.id),
    title,
    synopsis: asString(raw.synopsis),
    audience: asString(raw.audience),
    tone: asString(raw.tone, "Neutral"),
    tags: asStringArray(raw.tags),
    chapters,
    source: normalizeSource(raw.source),
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
  await FileSystem.writeAsStringAsync(bookPath(book.id), JSON.stringify(book, null, 2));
}

export async function deleteStoredBook(bookId: string) {
  const path = bookPath(bookId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path);
  }
}
