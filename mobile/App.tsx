import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  type TextInputSelectionChangeEventData,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import {
  createInitialBook,
  createOutlineNode,
  deleteStoredBook,
  loadStoredBooks,
  normalizeBook,
  outlineItemCount,
  saveStoredBook,
} from "./src/bookStore";
import {
  buildAssistPrompt,
  fetchAssistModels,
  localAssistFallback,
  runOpenAiCompatibleAssist,
  type AssistMode,
  type AssistModelOption,
} from "./src/llmAssist";
import { readBookSourceText, readSelectableBookSourceText } from "./src/paperAssets";
import { importPaperFromInput } from "./src/paperImport";
import { deleteInstalledPackage, installPackageFromUrl, loadInstalledPackages } from "./src/packageStore";
import { importRoyalSocietyIssue } from "./src/archiveImport";
import {
  loadJournalArchiveIssues,
  markArchiveArticleImported,
  type JournalArchiveArticle,
  type JournalArchiveIssue,
} from "./src/archiveStore";
import { sampleBook } from "./src/sampleBook";
import { defaultReaderSettings, loadReaderSettings, saveReaderSettings } from "./src/settingsStore";
import type { InstalledPackage, PortableBookPage, PortablePageTranslation } from "./src/packageTypes";
import type { AiNote, AiNoteKind, Book, OutlineNode, Resource, Section, TokenUsage } from "./src/types";

type ThemeId = "paper" | "sepia" | "night";
type AddMode = "book" | "paper" | "archive" | "package" | "json";

const themes: Record<ThemeId, {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
}> = {
  paper: {
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#111827",
    muted: "#64748b",
    border: "#dbe3ee",
    accent: "#2563eb",
    accentText: "#ffffff",
  },
  sepia: {
    background: "#f4ecd9",
    surface: "#fff8e8",
    text: "#2f2417",
    muted: "#7c6a53",
    border: "#ddcaa8",
    accent: "#8b5e2b",
    accentText: "#fff8e8",
  },
  night: {
    background: "#101418",
    surface: "#171d24",
    text: "#edf2f7",
    muted: "#9aa7b4",
    border: "#2d3845",
    accent: "#7dd3fc",
    accentText: "#071016",
  },
};

type Theme = (typeof themes)[ThemeId];

type FlatSection = {
  nodeId: string;
  depth: number;
  path: string[];
  chapterTitle: string;
  chapter?: Section;
  section: Section;
};

type SuggestionItem = {
  title: string;
  summary: string;
  children: SuggestionItem[];
};

type ResearchArchiveSource = {
  id: string;
  title: string;
  description: string;
  homeUrl: string;
  searchUrl: (query: string) => string;
};

const mobileAssistModels: AssistModelOption[] = [
  {
    id: "google/gemma-4-12b-qat",
    label: "Local LLM (Gemma)",
    provider: "lmstudio",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT 5.4 Nano",
    provider: "openai",
  },
];

const mobileAssistModelIds = new Set(mobileAssistModels.map((model) => model.id));

const researchArchiveSources: ResearchArchiveSource[] = [
  {
    id: "fraser",
    title: "FRASER / FRS",
    description: "Federal Reserve archival economic history, speeches, reports, and old policy documents.",
    homeUrl: "https://fraser.stlouisfed.org/",
    searchUrl: (query) => `https://fraser.stlouisfed.org/search?searchtype=keyword&text=${encodeURIComponent(query)}`,
  },
  {
    id: "royal-society",
    title: "Royal Society Archive",
    description: "Historic scientific papers, including Philosophical Transactions and Proceedings.",
    homeUrl: "https://royalsocietypublishing.org/action/showPublications",
    searchUrl: (query) => `https://royalsocietypublishing.org/action/doSearch?AllField=${encodeURIComponent(query)}`,
  },
  {
    id: "ieee",
    title: "IEEE Xplore",
    description: "Engineering, computing, electronics, standards, journals, and conference papers.",
    homeUrl: "https://ieeexplore.ieee.org/",
    searchUrl: (query) => `https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${encodeURIComponent(query)}`,
  },
  {
    id: "arxiv",
    title: "arXiv",
    description: "Open preprints across computing, mathematics, physics, quantitative biology, and more.",
    homeUrl: "https://arxiv.org/",
    searchUrl: (query) => `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`,
  },
  {
    id: "pubmed",
    title: "PubMed",
    description: "Biomedical and life-science literature with strong metadata and abstract coverage.",
    homeUrl: "https://pubmed.ncbi.nlm.nih.gov/",
    searchUrl: (query) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`,
  },
];

function normalizeMobileAssistModel(model: string) {
  return mobileAssistModelIds.has(model.trim()) ? model.trim() : defaultReaderSettings.assistModel;
}

function mobileAllowedModelsFromRouter(models: AssistModelOption[]) {
  return mobileAssistModels.map((allowed) => {
    const routerModel = models.find((model) => model.id === allowed.id);
    return routerModel ? { ...allowed, ...routerModel, label: allowed.label } : allowed;
  });
}

function flattenBook(book: Book): FlatSection[] {
  const walk = (
    nodes: OutlineNode[],
    depth: number,
    path: string[],
    currentChapter: Section | undefined,
  ): FlatSection[] =>
    nodes.flatMap((node) => {
      const chapter = node.type === "chapter" ? node : currentChapter;
      const nextPath = [...path, node.title || "Untitled"];
      return [
        {
          nodeId: node.id,
          depth,
          path: nextPath,
          chapterTitle: chapter?.title ?? "Book",
          chapter,
          section: node,
        },
        ...walk(node.children, depth + 1, nextPath, chapter),
      ];
    });

  return walk(book.outline, 0, [], undefined);
}

function sectionBody(section: Section) {
  return (
    section.content.trim() ||
    section.summary.trim() ||
    section.intent.trim() ||
    "This section has no readable content yet. Create or edit it in this app, then save the book."
  );
}

function splitParagraphs(content: string) {
  return content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function packageTranslationRows(pkg: InstalledPackage | undefined, language: string) {
  if (!pkg) return [];
  return pkg.translations[language] ?? pkg.translations[pkg.defaultLanguage] ?? Object.values(pkg.translations)[0] ?? [];
}

function packagePageNumbers(pkg: InstalledPackage | undefined, language: string) {
  return packageTranslationRows(pkg, language)
    .map((row) => row.pageNumber)
    .sort((left, right) => left - right);
}

function choosePackageTranslation(translations: PortablePageTranslation[]) {
  return translations.find((entry) => entry.complexity === "simplified")
    ?? translations.find((entry) => entry.complexity === "original")
    ?? translations[0];
}

function packagePageMetadata(pkg: InstalledPackage | undefined, pageNumber: number): PortableBookPage | undefined {
  return pkg?.pages.find((page) => page.pageNumber === pageNumber);
}

function sourceResources(book: Book): Resource[] {
  const resources: Resource[] = [];
  if (book.source?.localHtmlPath) {
    resources.push({ id: "book-local-html", type: "link", label: "Offline Text", value: book.source.localHtmlPath });
  }
  if (book.source?.localPdfPath) {
    resources.push({ id: "book-local-pdf", type: "pdf", label: "Offline PDF", value: book.source.localPdfPath });
  }
  if (book.source?.url) {
    resources.push({ id: "book-source", type: "link", label: "Source", value: book.source.url });
  }
  if (book.source?.pdfUrl && !book.source.localPdfPath) {
    resources.push({ id: "book-pdf", type: "pdf", label: "PDF", value: book.source.pdfUrl });
  }
  return resources;
}

function uniqueResources(resources: Resource[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.label}:${resource.value}`;
    if (!resource.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readingResourcesForBook(book: Book, section: Section) {
  const sectionResources = book.source?.localPdfPath
    ? section.resources.filter((resource) => resource.type !== "pdf" || resource.value !== book.source?.pdfUrl)
    : section.resources;

  return uniqueResources([...sectionResources, ...sourceResources(book)]);
}

function updateOutlineNode(
  nodes: OutlineNode[],
  id: string,
  updater: (node: OutlineNode) => OutlineNode,
): OutlineNode[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node);
    return { ...node, children: updateOutlineNode(node.children, id, updater) };
  });
}

function appendOutlineChild(nodes: OutlineNode[], parentId: string, child: OutlineNode): OutlineNode[] {
  return updateOutlineNode(nodes, parentId, (node) => ({ ...node, children: [...node.children, child] }));
}

function removeOutlineNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: removeOutlineNode(node.children, id) }));
}

function moveOutlineNode(nodes: OutlineNode[], id: string, direction: -1 | 1): { nodes: OutlineNode[]; moved: boolean } {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) {
      return { nodes, moved: false };
    }
    const next = [...nodes];
    const current = next[index];
    next[index] = next[target];
    next[target] = current;
    return { nodes: next, moved: true };
  }

  let moved = false;
  const nextNodes = nodes.map((node) => {
    if (moved) return node;
    const result = moveOutlineNode(node.children, id, direction);
    if (!result.moved) return node;
    moved = true;
    return { ...node, children: result.nodes };
  });

  return { nodes: nextNodes, moved };
}

function suggestionToNode(item: SuggestionItem, type: OutlineNode["type"]): OutlineNode {
  return {
    ...createOutlineNode(type, item.title, item.children.map((child) => suggestionToNode(child, "section"))),
    summary: item.summary,
    intent: item.summary,
  };
}

function parseSuggestionItems(value: unknown): SuggestionItem[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)
      ? (value as { items: unknown[] }).items
      : [];

  return source
    .map((entry): SuggestionItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (!title) return null;
      return {
        title,
        summary: typeof raw.summary === "string"
          ? raw.summary
          : typeof raw.description === "string"
            ? raw.description
            : "",
        children: parseSuggestionItems(raw.children),
      };
    })
    .filter((entry): entry is SuggestionItem => Boolean(entry));
}

function extractJsonPayload(text: string) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("The model did not return valid JSON suggestions.");
  }
}

async function requestOutlineSuggestions({
  apiKey,
  book,
  endpoint,
  model,
  target,
}: {
  apiKey: string;
  book: Book;
  endpoint: string;
  model: string;
  target: OutlineNode;
}) {
  const cleanEndpoint = endpoint.trim().replace(/\/$/, "");
  if (!cleanEndpoint) {
    throw new Error("Configure the Assist endpoint before requesting suggestions.");
  }
  const url = cleanEndpoint.endsWith("/chat/completions") ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;
  const existingChildren = target.children.map((child) => child.title).filter(Boolean).join(", ");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: model.trim() || defaultReaderSettings.assistModel,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You are a book outline architect. Return only strict JSON. Do not include markdown.",
          },
          {
            role: "user",
            content: [
              `Book title: ${book.title}`,
              book.audience ? `Audience: ${book.audience}` : "",
              book.tone ? `Tone: ${book.tone}` : "",
              book.synopsis ? `Synopsis: ${book.synopsis}` : "",
              `Target ${target.type}: ${target.title}`,
              target.summary ? `Target summary: ${target.summary}` : "",
              existingChildren ? `Existing children to avoid duplicating: ${existingChildren}` : "",
              "Suggest useful child topics and subtopics for this target.",
              "Return JSON only with this shape: {\"items\":[{\"title\":\"Topic\",\"summary\":\"Short useful description\",\"children\":[{\"title\":\"Subtopic\",\"summary\":\"Short useful description\",\"children\":[]}]}]}.",
              "Keep titles concise. Prefer 3 to 6 suggestions.",
            ].filter(Boolean).join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Suggestion request failed: ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Suggestion response did not include content.");
    }
    const suggestions = parseSuggestionItems(extractJsonPayload(content));
    if (!suggestions.length) {
      throw new Error("The model did not return any suggestions.");
    }
    return suggestions;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Suggestion request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function notesForSection(book: Book, section: Section) {
  return (book.aiNotes ?? []).filter((note) => note.sourceSectionId === section.id);
}

function buildNotebookContext(notes: AiNote[]) {
  return notes
    .slice(0, 6)
    .map((note, index) => {
      return `${index + 1}. ${note.title}: ${note.content.slice(0, 900)}`;
    })
    .join("\n\n");
}

type LocatedOutlineNode = {
  node: OutlineNode;
  ancestors: OutlineNode[];
  siblings: OutlineNode[];
  siblingIndex: number;
};

function compactPromptText(value: string | undefined, limit: number) {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trim()}...`;
}

function nodeContextLine(node: OutlineNode, prefix = "") {
  const descriptor = compactPromptText(node.summary || node.intent || node.content, 220);
  return `${prefix}${node.type}: ${node.title}${descriptor ? ` - ${descriptor}` : ""}`;
}

function findOutlineNode(
  nodes: OutlineNode[],
  targetId: string,
  ancestors: OutlineNode[] = [],
): LocatedOutlineNode | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === targetId) {
      return {
        node,
        ancestors,
        siblings: nodes,
        siblingIndex: index,
      };
    }

    const found = findOutlineNode(node.children, targetId, [...ancestors, node]);
    if (found) return found;
  }

  return undefined;
}

function nearbySiblingNodes(siblings: OutlineNode[], selectedIndex: number, radius = 3) {
  const start = Math.max(0, selectedIndex - radius);
  const end = Math.min(siblings.length, selectedIndex + radius + 1);
  return siblings.slice(start, end);
}

function buildAssistOutlineContext(book: Book, selectedNodeId: string) {
  const located = findOutlineNode(book.outline, selectedNodeId);
  if (!located) return "";

  const path = [...located.ancestors.map((node) => node.title), located.node.title].filter(Boolean).join(" > ");
  const parentLines = located.ancestors.map((node, index) => `${index + 1}. ${nodeContextLine(node)}`);
  const siblingLines = nearbySiblingNodes(located.siblings, located.siblingIndex).map((node, index) => {
    const marker = node.id === located.node.id ? "selected" : "sibling";
    return `${index + 1}. [${marker}] ${nodeContextLine(node)}`;
  });
  const childLines = located.node.children.slice(0, 8).map((node, index) => `${index + 1}. ${nodeContextLine(node)}`);

  return [
    `Selected path: ${path || located.node.title}`,
    `Selected node type: ${located.node.type}`,
    parentLines.length ? "Parents:" : "",
    ...parentLines,
    siblingLines.length ? "Sibling context:" : "",
    ...siblingLines,
    childLines.length ? "Direct child nodes:" : "",
    ...childLines,
  ].filter(Boolean).join("\n");
}

function noteKindForMode(mode: AssistMode): AiNoteKind {
  if (mode === "paper") return "paper";
  if (mode === "concept") return "concept";
  if (mode === "summary") return "summary";
  if (mode === "method") return "method";
  if (mode === "critique") return "critique";
  if (mode === "custom") return "question";
  return "section";
}

function noteTitleForMode(mode: AssistMode, section: Section, question: string) {
  const cleanQuestion = question.trim().replace(/\s+/g, " ");
  if (mode === "paper") return "Paper Explanation";
  if (mode === "concept") return cleanQuestion ? `Concept: ${cleanQuestion.slice(0, 72)}` : "Concept Explanation";
  if (mode === "custom") return cleanQuestion ? `Question: ${cleanQuestion.slice(0, 72)}` : "Question";
  if (mode === "summary") return `Summary: ${section.title}`;
  if (mode === "method") return `Method: ${section.title}`;
  if (mode === "critique") return `Critique: ${section.title}`;
  return `Study Notes: ${section.title}`;
}

function normalizedQuestion(question: string | undefined) {
  return (question ?? "").trim().replace(/\s+/g, " ");
}

function noteMatchesAssist(
  note: AiNote,
  section: Section,
  mode: AssistMode,
  question: string,
  model: string,
) {
  return note.sourceSectionId === section.id
    && note.kind === noteKindForMode(mode)
    && note.tags.includes(mode)
    && normalizedQuestion(note.question) === normalizedQuestion(question)
    && (note.model ?? "") === model;
}

function findAssistNote(book: Book, section: Section, mode: AssistMode, question: string, model: string) {
  return (book.aiNotes ?? []).find((note) => noteMatchesAssist(note, section, mode, question, model));
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([sampleBook]);
  const [publishedPackages, setPublishedPackages] = useState<InstalledPackage[]>([]);
  const [archiveIssues, setArchiveIssues] = useState<JournalArchiveIssue[]>([]);
  const [storedBookIds, setStoredBookIds] = useState<string[]>([]);
  const [activeReaderKind, setActiveReaderKind] = useState<"custom" | "published">("custom");
  const [activeBookId, setActiveBookId] = useState(sampleBook.id);
  const [activePackageId, setActivePackageId] = useState("");
  const [activePackageLanguage, setActivePackageLanguage] = useState("");
  const [activePackagePageNumber, setActivePackagePageNumber] = useState(1);
  const [activeNodeId, setActiveNodeId] = useState(() => flattenBook(sampleBook)[0]?.nodeId ?? "");
  const [themeId, setThemeId] = useState<ThemeId>("sepia");
  const [fontSize, setFontSize] = useState(19);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("book");
  const [importText, setImportText] = useState("");
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveIssueUrl, setArchiveIssueUrl] = useState("https://royalsocietypublishing.org/rstl/issue/1/8");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [packageUrl, setPackageUrl] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const [paperInput, setPaperInput] = useState("");
  const [paperBusy, setPaperBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webCurrentUrl, setWebCurrentUrl] = useState("");
  const [webTitle, setWebTitle] = useState("Source");
  const [paperTextOpen, setPaperTextOpen] = useState(false);
  const [paperText, setPaperText] = useState("");
  const [paperTextBusy, setPaperTextBusy] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistMode, setAssistMode] = useState<AssistMode>("augment");
  const [assistQuestion, setAssistQuestion] = useState("");
  const [assistEndpoint, setAssistEndpoint] = useState(defaultReaderSettings.assistEndpoint);
  const [assistApiKey, setAssistApiKey] = useState("");
  const [assistModel, setAssistModel] = useState(defaultReaderSettings.assistModel);
  const [assistModels, setAssistModels] = useState<AssistModelOption[]>(mobileAssistModels);
  const [assistModelsBusy, setAssistModelsBusy] = useState(false);
  const [assistModelsError, setAssistModelsError] = useState("");
  const [assistAnswer, setAssistAnswer] = useState("");
  const [assistUsage, setAssistUsage] = useState<TokenUsage | undefined>(undefined);
  const [assistBusy, setAssistBusy] = useState(false);

  const theme = themes[themeId];

  const refreshBooks = async () => {
    try {
      const [storedBooks, installedPackages, storedArchiveIssues] = await Promise.all([
        loadStoredBooks(),
        loadInstalledPackages(),
        loadJournalArchiveIssues(),
      ]);
      const storedSample = storedBooks.find((book) => book.id === sampleBook.id);
      setBooks([storedSample ?? sampleBook, ...storedBooks.filter((book) => book.id !== sampleBook.id)]);
      setStoredBookIds(storedBooks.map((book) => book.id));
      setPublishedPackages(installedPackages);
      setArchiveIssues(storedArchiveIssues);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    refreshBooks();
    loadReaderSettings().then((settings) => {
      setAssistEndpoint(settings.assistEndpoint);
      setAssistModel(normalizeMobileAssistModel(settings.assistModel));
    });
  }, []);

  useEffect(() => {
    if (assistOpen) {
      void refreshAssistModels();
    }
  }, [assistOpen]);

  const activeBook = books.find((book) => book.id === activeBookId) ?? books[0] ?? sampleBook;
  const activePackage = publishedPackages.find((pkg) => pkg.packageId === activePackageId);
  const activePackageLanguageValue = activePackageLanguage || activePackage?.defaultLanguage || activePackage?.languages[0] || "";
  const activePackagePageNumbers = useMemo(
    () => packagePageNumbers(activePackage, activePackageLanguageValue),
    [activePackage, activePackageLanguageValue],
  );
  const activePackagePageIndex = Math.max(0, activePackagePageNumbers.indexOf(activePackagePageNumber));
  const activePackageCurrentPageNumber = activePackagePageNumbers[activePackagePageIndex] ?? activePackagePageNumbers[0] ?? 1;
  const activePackageRows = packageTranslationRows(activePackage, activePackageLanguageValue);
  const activePackageRow = activePackageRows.find((row) => row.pageNumber === activePackageCurrentPageNumber);
  const activePackageTranslation = choosePackageTranslation(activePackageRow?.translations ?? []);
  const activePackagePage = packagePageMetadata(activePackage, activePackageCurrentPageNumber);
  const readingPublishedPackage = activeReaderKind === "published" && Boolean(activePackage);
  const flatSections = useMemo(() => flattenBook(activeBook), [activeBook]);
  const activeFlatIndex = Math.max(0, flatSections.findIndex((entry) => entry.nodeId === activeNodeId));
  const activeFlatSection = flatSections[activeFlatIndex] ?? flatSections[0];
  const activeChapter = activeFlatSection?.chapter;
  const activeSection = activeFlatSection?.section ?? activeBook.outline[0];
  const progressLabel = `${Math.min(activeFlatIndex + 1, flatSections.length)} / ${flatSections.length}`;
  const contentParagraphs = splitParagraphs(sectionBody(activeSection));
  const readingResources = readingResourcesForBook(activeBook, activeSection);
  const activeTopicNotes = useMemo(() => notesForSection(activeBook, activeSection), [activeBook, activeSection]);
  const aiNoteCount = activeTopicNotes.length;
  const activeAssistModel = normalizeMobileAssistModel(assistModel);
  const readerChapterLabel = readingPublishedPackage
    ? activePackage?.author || "Published Book"
    : activeChapter?.title ?? "Chapter";
  const readerSectionTitle = readingPublishedPackage
    ? activePackageTranslation?.title || activePackagePage?.sectionTitle || `Page ${activePackageCurrentPageNumber}`
    : activeSection.title;
  const readerParagraphs = readingPublishedPackage
    ? activePackageTranslation?.paragraphs.length
      ? activePackageTranslation.paragraphs
      : ["No readable text is available for this page."]
    : contentParagraphs;
  const cachedAssistNote = useMemo(
    () => findAssistNote(activeBook, activeSection, assistMode, assistQuestion, activeAssistModel),
    [activeBook, activeSection, assistMode, assistQuestion, activeAssistModel],
  );

  useEffect(() => {
    if (!assistOpen || assistBusy) return;
    setAssistAnswer(cachedAssistNote?.content ?? "");
    setAssistUsage(cachedAssistNote?.tokenUsage);
  }, [assistOpen, assistBusy, cachedAssistNote?.id, cachedAssistNote?.content, cachedAssistNote?.tokenUsage, assistMode, assistQuestion, activeAssistModel, activeSection.id]);

  useEffect(() => {
    if (flatSections.length && !flatSections.some((entry) => entry.nodeId === activeNodeId)) {
      setActiveNodeId(flatSections[0].nodeId);
    }
  }, [activeBook.id, activeNodeId, flatSections]);

  const openBook = (book: Book) => {
    const firstSection = flattenBook(book)[0];
    setActiveReaderKind("custom");
    setActiveBookId(book.id);
    setActiveNodeId(firstSection?.nodeId ?? book.outline[0]?.id ?? "");
    setLibraryOpen(false);
    setStatusText("");
  };

  const openPackage = (pkg: InstalledPackage) => {
    const language = pkg.languages.includes(pkg.defaultLanguage) ? pkg.defaultLanguage : pkg.languages[0] ?? "";
    const pageNumbers = packagePageNumbers(pkg, language);
    setActiveReaderKind("published");
    setActivePackageId(pkg.packageId);
    setActivePackageLanguage(language);
    setActivePackagePageNumber(pageNumbers[0] ?? 1);
    setLibraryOpen(false);
    setStatusText("");
  };

  const moveSection = (delta: number) => {
    if (readingPublishedPackage) {
      const nextPage = activePackagePageNumbers[activePackagePageIndex + delta];
      if (nextPage) setActivePackagePageNumber(nextPage);
      return;
    }
    const next = flatSections[activeFlatIndex + delta];
    if (!next) return;
    setActiveNodeId(next.nodeId);
  };

  const refreshAssistModels = async () => {
    const endpoint = assistEndpoint.trim();
    if (!endpoint) {
      setAssistModels([]);
      setAssistModelsError("");
      return;
    }

    setAssistModelsBusy(true);
    setAssistModelsError("");
    try {
      const models = await fetchAssistModels({
        endpoint,
        apiKey: assistApiKey,
      });
      const allowedModels = mobileAllowedModelsFromRouter(models);
      setAssistModels(allowedModels);
      if (!mobileAssistModelIds.has(assistModel.trim()) && allowedModels[0]) {
        setAssistModel(allowedModels[0].id);
      }
    } catch (error) {
      setAssistModels(mobileAssistModels);
      if (!mobileAssistModelIds.has(assistModel.trim())) {
        setAssistModel(defaultReaderSettings.assistModel);
      }
      const message = error instanceof Error ? error.message : String(error);
      setAssistModelsError(message);
      setStatusText(`Model list error: ${message}`);
    } finally {
      setAssistModelsBusy(false);
    }
  };

  const importBook = async () => {
    try {
      const parsed = normalizeBook(JSON.parse(importText));
      await saveStoredBook(parsed);
      setImportText("");
      setAddOpen(false);
      await refreshBooks();
      openBook(parsed);
      setStatusText(`Imported "${parsed.title}".`);
    } catch (error) {
      Alert.alert("Import failed", error instanceof Error ? error.message : String(error));
    }
  };

  const createBook = async (draft: Book) => {
    try {
      const parsed = normalizeBook({
        ...draft,
        title: draft.title.trim(),
        source: draft.source ?? { type: "bookforge" },
      });
      await saveStoredBook(parsed);
      setAddOpen(false);
      await refreshBooks();
      openBook(parsed);
      setStatusText(`Created "${parsed.title}".`);
    } catch (error) {
      Alert.alert("Create book failed", error instanceof Error ? error.message : String(error));
    }
  };

  const updateBook = async (draft: Book) => {
    try {
      const parsed = normalizeBook({
        ...draft,
        title: draft.title.trim(),
        source: draft.source ?? { type: "bookforge" },
      });
      await saveStoredBook(parsed);
      setEditOpen(false);
      await refreshBooks();
      openBook(parsed);
      setStatusText(`Updated "${parsed.title}".`);
    } catch (error) {
      Alert.alert("Update book failed", error instanceof Error ? error.message : String(error));
    }
  };

  const importPaper = async () => {
    setPaperBusy(true);
    try {
      const parsed = await importPaperFromInput(paperInput);
      await saveStoredBook(parsed);
      setPaperInput("");
      setAddOpen(false);
      await refreshBooks();
      openBook(parsed);
      setStatusText(`Imported paper "${parsed.title}". ${offlineSummary(parsed)}`);
    } catch (error) {
      Alert.alert("Paper import failed", error instanceof Error ? error.message : String(error));
    } finally {
      setPaperBusy(false);
    }
  };

  const importPackage = async () => {
    setPackageBusy(true);
    try {
      const installed = await installPackageFromUrl(packageUrl);
      setPackageUrl("");
      setAddOpen(false);
      await refreshBooks();
      openPackage(installed);
      setStatusText(`Installed "${installed.title}".`);
    } catch (error) {
      Alert.alert("Package import failed", error instanceof Error ? error.message : String(error));
    } finally {
      setPackageBusy(false);
    }
  };

  const importArchiveIssue = async () => {
    setArchiveBusy(true);
    try {
      const issue = await importRoyalSocietyIssue(archiveIssueUrl);
      await refreshBooks();
      setStatusText(`Imported ${issue.articles.length} article records from ${issue.journalName}.`);
    } catch (error) {
      Alert.alert("Issue import failed", error instanceof Error ? error.message : String(error));
    } finally {
      setArchiveBusy(false);
    }
  };

  const importArchiveArticle = async (issue: JournalArchiveIssue, article: JournalArchiveArticle) => {
    setPaperBusy(true);
    try {
      const parsed = await importPaperFromInput(article.sourceUrl);
      const enriched: Book = {
        ...parsed,
        title: parsed.title || article.title,
        tags: Array.from(new Set([...parsed.tags, issue.publisherName, article.journalName, "Archive Article"].filter(Boolean))),
        source: {
          ...parsed.source,
          type: "archive-article",
          id: article.articleId,
          url: article.sourceUrl,
          pdfUrl: parsed.source?.pdfUrl || article.pdfUrl,
          journal: article.journalName,
          publishedAt: article.publishedAt,
          issueVolume: article.volume,
          issueNumber: article.issue,
          articleId: article.articleId,
          archiveProvider: article.provider,
        },
      };
      await saveStoredBook(enriched);
      await markArchiveArticleImported(issue.id, article.id, enriched.id);
      await refreshBooks();
      openBook(enriched);
      setStatusText(`Imported archive article "${enriched.title}". ${offlineSummary(enriched)}`);
    } catch (error) {
      Alert.alert("Article import failed", error instanceof Error ? error.message : String(error));
    } finally {
      setPaperBusy(false);
    }
  };

  const removeBook = async (book: Book) => {
    if (!storedBookIds.includes(book.id)) return;
    await deleteStoredBook(book.id);
    await refreshBooks();
    if (book.id === activeBookId) {
      openBook(sampleBook);
    }
  };

  const removePackage = async (pkg: InstalledPackage) => {
    await deleteInstalledPackage(pkg.packageId);
    await refreshBooks();
    if (pkg.packageId === activePackageId) {
      setActiveReaderKind("custom");
      openBook(sampleBook);
    }
  };

  const openResource = (resource: Resource) => {
    setWebTitle(resource.label || "Source");
    setWebUrl(resource.value);
    setWebCurrentUrl(resource.value);
  };

  const openArchiveUrl = (title: string, url: string) => {
    setWebTitle(title);
    setWebUrl(url);
    setWebCurrentUrl(url);
    setAddOpen(false);
  };

  const importCurrentWebPage = () => {
    const currentUrl = (webCurrentUrl || webUrl).trim();
    if (!currentUrl) return;
    setPaperInput(currentUrl);
    setAddMode("paper");
    setAddOpen(true);
    setWebUrl("");
    setWebCurrentUrl("");
    setStatusText("Archive page copied into Paper import. Import it when the article page is ready.");
  };

  const openPaperText = async () => {
    setPaperTextOpen(true);
    setPaperTextBusy(true);
    try {
      const text = await readSelectableBookSourceText(activeBook);
      setPaperText(text || "No extracted paper text is available for this paper.");
    } catch (error) {
      setPaperText(error instanceof Error ? error.message : String(error));
    } finally {
      setPaperTextBusy(false);
    }
  };

  const persistAssistAnswer = async (
    answer: string,
    mode: AssistMode,
    question: string,
    model: string,
    tokenUsage?: TokenUsage,
  ) => {
    const cleanAnswer = answer.trim();
    if (!cleanAnswer) return null;

    const existing = findAssistNote(activeBook, activeSection, mode, question, model);
    const note: AiNote = {
      id: existing?.id ?? `ai-note-${Date.now()}`,
      kind: noteKindForMode(mode),
      title: noteTitleForMode(mode, activeSection, question),
      content: cleanAnswer,
      createdAt: new Date().toISOString(),
      sourceSectionId: activeSection.id,
      sourceSectionTitle: activeSection.title,
      question: normalizedQuestion(question) || undefined,
      model,
      tokenUsage,
      tags: [mode, ...activeSection.keywords.slice(0, 3)],
    };

    const updatedBook: Book = {
      ...activeBook,
      aiNotes: [
        note,
        ...(activeBook.aiNotes ?? []).filter((entry) => !noteMatchesAssist(entry, activeSection, mode, question, model)),
      ],
    };

    await saveStoredBook(updatedBook);
    setBooks((current) => current.map((book) => book.id === updatedBook.id ? updatedBook : book));
    setStoredBookIds((current) => current.includes(updatedBook.id) ? current : [...current, updatedBook.id]);
    setActiveBookId(updatedBook.id);
    return note;
  };

  const runAssist = async (overrides?: { mode?: AssistMode; question?: string }) => {
    setAssistBusy(true);
    try {
      const endpoint = assistEndpoint.trim();
      const model = normalizeMobileAssistModel(assistModel);
      const mode = overrides?.mode ?? assistMode;
      const question = overrides?.question ?? assistQuestion;
      const cachedNote = findAssistNote(activeBook, activeSection, mode, question, model);
      setAssistModel(model);
      if (overrides?.mode) {
        setAssistMode(overrides.mode);
      }
      if (overrides?.question !== undefined) {
        setAssistQuestion(overrides.question);
      }
      await saveReaderSettings({
        assistEndpoint: endpoint,
        assistModel: model,
      });
      if (cachedNote) {
        setAssistAnswer(cachedNote.content);
        setAssistUsage(cachedNote.tokenUsage);
        setStatusText("Loaded saved AI note for this topic.");
        return;
      }
      const savedSourceText = mode === "paper" ? await readBookSourceText(activeBook) : "";
      const outlineContext = buildAssistOutlineContext(activeBook, activeSection.id);
      const savedNotesContext = buildNotebookContext(activeTopicNotes);
      const prompt = buildAssistPrompt(
        activeBook,
        activeChapter,
        activeSection,
        mode,
        question,
        outlineContext,
        savedSourceText,
        savedNotesContext,
      );
      if (!endpoint.trim()) {
        setAssistAnswer(localAssistFallback(prompt));
        setAssistUsage(undefined);
      } else {
        const result = await runOpenAiCompatibleAssist({
          endpoint,
          apiKey: assistApiKey,
          model,
          prompt,
        });
        const answer = result.content;
        setAssistAnswer(answer);
        setAssistUsage(result.tokenUsage);
        await persistAssistAnswer(answer, mode, question, model, result.tokenUsage);
        setStatusText("Saved AI response to this topic.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAssistAnswer(message);
      setStatusText(`Assist error: ${message}`);
      Alert.alert("Assist error", message);
    } finally {
      setAssistBusy(false);
    }
  };

  const saveAssistAsNote = async () => {
    const answer = assistAnswer.trim();
    if (!answer) return;
    try {
      await persistAssistAnswer(
        answer,
        assistMode,
        assistQuestion,
        normalizeMobileAssistModel(assistModel),
        assistUsage,
      );
      setAssistOpen(false);
      setStatusText("Saved AI note to this topic.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Save note error: ${message}`);
      Alert.alert("Save note failed", message);
    }
  };

  const askAboutSelectedText = async (action: "explain" | "summarize" | "define", selectedText: string) => {
    const cleanSelection = selectedText.trim().replace(/\s+/g, " ");
    if (!cleanSelection) return;

    const question =
      action === "explain"
        ? `Explain this selected text from the current paper note: "${cleanSelection}"`
        : action === "summarize"
          ? `Summarize this selected text from the current paper note: "${cleanSelection}"`
          : `Define the key terms and concepts in this selected text: "${cleanSelection}"`;
    const mode: AssistMode = action === "summarize" ? "summary" : "concept";
    await runAssist({ mode, question });
  };

  const askAboutPaperTextSelection = async (action: "explain" | "summarize" | "define", selectedText: string) => {
    const cleanSelection = selectedText.trim().replace(/\s+/g, " ");
    if (!cleanSelection) return;

    const question =
      action === "explain"
        ? `Explain this selected passage from the paper text: "${cleanSelection}"`
        : action === "summarize"
          ? `Summarize this selected passage from the paper text: "${cleanSelection}"`
          : `Define the key terms and concepts in this selected passage from the paper text: "${cleanSelection}"`;
    const mode: AssistMode = action === "summarize" ? "summary" : "concept";
    setPaperTextOpen(false);
    setAssistOpen(true);
    await runAssist({ mode, question });
  };

  const removeAiNote = async (noteId: string) => {
    const updatedBook: Book = {
      ...activeBook,
      aiNotes: (activeBook.aiNotes ?? []).filter((note) => note.id !== noteId),
    };

    await saveStoredBook(updatedBook);
    setBooks((current) => current.map((book) => book.id === updatedBook.id ? updatedBook : book));
    setActiveBookId(updatedBook.id);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={themeId === "night" ? "light-content" : "dark-content"} />
      <View style={[styles.header, { borderColor: theme.border }]}>
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.eyebrow, { color: theme.muted }]}>BookForge Reader</Text>
          <Text numberOfLines={2} style={[styles.headerTitle, { color: theme.text }]}>
            {readingPublishedPackage ? activePackage?.title : activeBook.title}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <AppButton label="Library" onPress={() => setLibraryOpen(true)} theme={theme} variant="ghost" compact />
          {!readingPublishedPackage ? (
            <AppButton label="Edit" onPress={() => setEditOpen(true)} theme={theme} variant="ghost" compact />
          ) : null}
          <AppButton label="Add" onPress={() => setAddOpen(true)} theme={theme} compact />
        </View>
      </View>

      <ScrollView
        style={styles.reader}
        contentContainerStyle={styles.readerContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.chapterTitle, { color: theme.muted }]}>
          {readerChapterLabel}
        </Text>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          {readerSectionTitle}
        </Text>

        <View style={styles.metaRow}>
          {readingPublishedPackage ? (
            <>
              <Pill text={activePackageLanguageValue || "language"} theme={theme} />
              <Pill text={`Page ${activePackageCurrentPageNumber}`} theme={theme} />
              {activePackage?.version ? <Pill text={`v${activePackage.version} r${activePackage.revision}`} theme={theme} /> : null}
            </>
          ) : (
            <>
              <Pill text={activeSection.persona} theme={theme} />
              {activeBook.source?.type ? <Pill text={activeBook.source.type} theme={theme} /> : null}
              {activeSection.durationMinutes ? (
                <Pill text={`${activeSection.durationMinutes} min`} theme={theme} />
              ) : null}
              {activeSection.keywords.slice(0, 3).map((keyword) => (
                <Pill key={keyword} text={keyword} theme={theme} />
              ))}
            </>
          )}
        </View>

        <View style={[styles.readingSurface, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {readerParagraphs.map((paragraph, index) => (
            <Text
              key={readingPublishedPackage ? `package-${activePackage?.packageId}-${activePackageCurrentPageNumber}-${index}` : `${activeSection.id}-${index}`}
              style={[styles.paragraph, { color: theme.text, fontSize, lineHeight: Math.round(fontSize * 1.58) }]}
            >
              {paragraph}
            </Text>
          ))}
        </View>

        {readingPublishedPackage ? (
          <>
            {activePackage?.glossary.length ? (
              <View style={styles.resourcePanel}>
                <Text style={[styles.resourceTitle, { color: theme.muted }]}>Glossary</Text>
                {activePackage.glossary.slice(0, 10).map((term) => (
                  <Text key={`${term.sourceTerm}-${term.translatedTerm}`} style={[styles.libraryMeta, { color: theme.muted }]}>
                    {term.sourceTerm} {"->"} {term.translatedTerm}{term.explanation ? `: ${term.explanation}` : ""}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <TopicNotesAccordion
              notes={activeTopicNotes}
              onAskSelection={(action, selectedText) => {
                setAssistOpen(true);
                void askAboutSelectedText(action, selectedText);
              }}
              onRemove={removeAiNote}
              theme={theme}
            />

            {readingResources.length || activeBook.source?.localTextPath ? (
              <View style={styles.resourcePanel}>
                <Text style={[styles.resourceTitle, { color: theme.muted }]}>Sources</Text>
                <View style={styles.resourceButtons}>
                  {activeBook.source?.localTextPath ? (
                    <AppButton
                      label="Paper Text"
                      onPress={openPaperText}
                      theme={theme}
                      variant="ghost"
                      compact
                    />
                  ) : null}
                  {readingResources.map((resource) => (
                    <AppButton
                      key={`${resource.label}-${resource.value}`}
                      label={resource.label || resource.type}
                      onPress={() => openResource(resource)}
                      theme={theme}
                      variant="ghost"
                      compact
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <View style={styles.footerTopRow}>
          <AppButton
            label="Prev"
            onPress={() => moveSection(-1)}
            disabled={readingPublishedPackage ? activePackagePageIndex <= 0 : activeFlatIndex <= 0}
            theme={theme}
            variant="ghost"
          />
          <Text style={[styles.progress, { color: theme.muted }]}>
            {readingPublishedPackage
              ? `${Math.min(activePackagePageIndex + 1, activePackagePageNumbers.length)} / ${activePackagePageNumbers.length}`
              : progressLabel}
          </Text>
          <AppButton
            label="Next"
            onPress={() => moveSection(1)}
            disabled={readingPublishedPackage ? activePackagePageIndex >= activePackagePageNumbers.length - 1 : activeFlatIndex >= flatSections.length - 1}
            theme={theme}
          />
        </View>
        <View style={styles.controlsRow}>
          {!readingPublishedPackage ? (
            <>
              <AppButton label="Assist" onPress={() => setAssistOpen(true)} theme={theme} />
              <AppButton label={aiNoteCount ? `Notes ${aiNoteCount}` : "Notes"} onPress={() => setNotesOpen(true)} theme={theme} variant="ghost" />
            </>
          ) : null}
          <AppButton label="A-" onPress={() => setFontSize((value) => Math.max(15, value - 1))} theme={theme} variant="ghost" compact />
          <AppButton label="A+" onPress={() => setFontSize((value) => Math.min(28, value + 1))} theme={theme} variant="ghost" compact />
          {(["paper", "sepia", "night"] as ThemeId[]).map((id) => (
            <AppButton
              key={id}
              label={id}
              onPress={() => setThemeId(id)}
              theme={theme}
              variant={themeId === id ? "solid" : "ghost"}
              compact
            />
          ))}
        </View>
        {statusText ? <Text style={[styles.status, { color: theme.muted }]}>{statusText}</Text> : null}
      </View>

      <LibraryModal
        activePackageId={activePackageId}
        books={books}
        packages={publishedPackages}
        storedBookIds={storedBookIds}
        activeBookId={activeBookId}
        onClose={() => setLibraryOpen(false)}
        onOpen={openBook}
        onOpenPackage={openPackage}
        onEdit={(book) => {
          openBook(book);
          setEditOpen(true);
        }}
        onRemove={removeBook}
        onRemovePackage={removePackage}
        open={libraryOpen}
        theme={theme}
      />

      <AddReadingModal
        addMode={addMode}
        apiKey={assistApiKey}
        archiveBusy={archiveBusy}
        archiveIssueUrl={archiveIssueUrl}
        archiveIssues={archiveIssues}
        archiveQuery={archiveQuery}
        createBook={createBook}
        endpoint={assistEndpoint}
        importBook={importBook}
        importPackage={importPackage}
        importPaper={importPaper}
        importText={importText}
        model={activeAssistModel}
        onClose={() => setAddOpen(false)}
        onImportArchiveArticle={importArchiveArticle}
        onImportArchiveIssue={importArchiveIssue}
        onOpenArchiveUrl={openArchiveUrl}
        open={addOpen}
        paperBusy={paperBusy}
        paperInput={paperInput}
        packageBusy={packageBusy}
        packageUrl={packageUrl}
        setAddMode={setAddMode}
        setArchiveIssueUrl={setArchiveIssueUrl}
        setArchiveQuery={setArchiveQuery}
        setImportText={setImportText}
        setPackageUrl={setPackageUrl}
        setPaperInput={setPaperInput}
        theme={theme}
      />

      <BookEditModal
        apiKey={assistApiKey}
        book={activeBook}
        endpoint={assistEndpoint}
        model={activeAssistModel}
        onClose={() => setEditOpen(false)}
        onSave={updateBook}
        open={editOpen}
        theme={theme}
      />

      <PaperTextModal
        busy={paperTextBusy}
        onAskSelection={askAboutPaperTextSelection}
        onClose={() => setPaperTextOpen(false)}
        open={paperTextOpen}
        text={paperText}
        theme={theme}
        title={activeBook.title}
      />

      <AssistModal
        answer={assistAnswer}
        apiKey={assistApiKey}
        busy={assistBusy}
        endpoint={assistEndpoint}
        mode={assistMode}
        model={assistModel}
        modelError={assistModelsError}
        models={assistModels}
        modelsBusy={assistModelsBusy}
        onAnswerChange={setAssistAnswer}
        onAskSelection={askAboutSelectedText}
        onClose={() => setAssistOpen(false)}
        onRefreshModels={refreshAssistModels}
        onRun={runAssist}
        open={assistOpen}
        question={assistQuestion}
        setApiKey={setAssistApiKey}
        usage={assistUsage}
        setEndpoint={setAssistEndpoint}
        setMode={setAssistMode}
        setModel={setAssistModel}
        setQuestion={setAssistQuestion}
        onSaveAnswer={saveAssistAsNote}
        canSaveAnswer={Boolean(assistAnswer.trim())}
        theme={theme}
      />

      <NotesModal
        notes={activeTopicNotes}
        onAskSelection={(action, selectedText) => {
          setNotesOpen(false);
          setAssistOpen(true);
          void askAboutSelectedText(action, selectedText);
        }}
        onClose={() => setNotesOpen(false)}
        onRemove={removeAiNote}
        open={notesOpen}
        theme={theme}
        topicTitle={activeSection.title}
      />

      <Modal animationType="slide" visible={Boolean(webUrl)} presentationStyle="fullScreen">
        <SafeAreaView style={[styles.webShell, { backgroundColor: theme.background }]}>
          <View style={[styles.webHeader, { borderColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.webTitle, { color: theme.text }]}>{webTitle}</Text>
            <View style={styles.webHeaderActions}>
              <AppButton label="Import" onPress={importCurrentWebPage} theme={theme} compact />
              <AppButton
                label="Close"
                onPress={() => {
                  setWebUrl("");
                  setWebCurrentUrl("");
                }}
                theme={theme}
                variant="ghost"
                compact
              />
            </View>
          </View>
          {webUrl ? (
            <WebView
              originWhitelist={["*"]}
              onNavigationStateChange={(event) => {
                if (event.url) setWebCurrentUrl(event.url);
                if (event.title) setWebTitle(event.title);
              }}
              source={{ uri: webUrl }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webLoading}>
                  <ActivityIndicator />
                </View>
              )}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function offlineSummary(book: Book) {
  const saved = [
    book.source?.localPdfPath ? "PDF" : "",
    book.source?.localHtmlPath ? "HTML" : "",
    book.source?.localTextPath ? "text" : "",
  ].filter(Boolean);

  return saved.length ? `Offline saved: ${saved.join(", ")}.` : "Source links are online only.";
}

function noteDateLabel(note: AiNote) {
  const date = new Date(note.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function AppButton({
  compact,
  disabled,
  label,
  onPress,
  theme,
  variant = "solid",
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  theme: Theme;
  variant?: "solid" | "ghost";
}) {
  const solid = variant === "solid";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        {
          backgroundColor: solid ? theme.accent : "transparent",
          borderColor: solid ? theme.accent : theme.border,
          opacity: disabled ? 0.38 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: solid ? theme.accentText : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Pill({ text, theme }: { text: string; theme: Theme }) {
  return (
    <View style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.pillText, { color: theme.muted }]}>{text}</Text>
    </View>
  );
}

function AddReadingModal({
  addMode,
  apiKey,
  archiveBusy,
  archiveIssueUrl,
  archiveIssues,
  archiveQuery,
  createBook,
  endpoint,
  importBook,
  importPackage,
  importPaper,
  importText,
  model,
  onClose,
  onImportArchiveArticle,
  onImportArchiveIssue,
  onOpenArchiveUrl,
  open,
  paperBusy,
  paperInput,
  packageBusy,
  packageUrl,
  setAddMode,
  setArchiveIssueUrl,
  setArchiveQuery,
  setImportText,
  setPackageUrl,
  setPaperInput,
  theme,
}: {
  addMode: AddMode;
  apiKey: string;
  archiveBusy: boolean;
  archiveIssueUrl: string;
  archiveIssues: JournalArchiveIssue[];
  archiveQuery: string;
  createBook: (book: Book) => void;
  endpoint: string;
  importBook: () => void;
  importPackage: () => void;
  importPaper: () => void;
  importText: string;
  model: string;
  onClose: () => void;
  onImportArchiveArticle: (issue: JournalArchiveIssue, article: JournalArchiveArticle) => void;
  onImportArchiveIssue: () => void;
  onOpenArchiveUrl: (title: string, url: string) => void;
  open: boolean;
  paperBusy: boolean;
  paperInput: string;
  packageBusy: boolean;
  packageUrl: string;
  setAddMode: (mode: AddMode) => void;
  setArchiveIssueUrl: (value: string) => void;
  setArchiveQuery: (value: string) => void;
  setImportText: (value: string) => void;
  setPackageUrl: (value: string) => void;
  setPaperInput: (value: string) => void;
  theme: Theme;
}) {
  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Add Reading</Text>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <View style={styles.segmentRow}>
          <AppButton label="Book" onPress={() => setAddMode("book")} theme={theme} variant={addMode === "book" ? "solid" : "ghost"} />
          <AppButton label="Paper" onPress={() => setAddMode("paper")} theme={theme} variant={addMode === "paper" ? "solid" : "ghost"} />
          <AppButton label="Archive" onPress={() => setAddMode("archive")} theme={theme} variant={addMode === "archive" ? "solid" : "ghost"} />
          <AppButton label="Package" onPress={() => setAddMode("package")} theme={theme} variant={addMode === "package" ? "solid" : "ghost"} />
          <AppButton label="JSON" onPress={() => setAddMode("json")} theme={theme} variant={addMode === "json" ? "solid" : "ghost"} />
        </View>

        {addMode === "book" ? (
          <BookEditorForm
            apiKey={apiKey}
            endpoint={endpoint}
            mode="create"
            model={model}
            onSave={createBook}
            open={open}
            saveLabel="Create Book"
            theme={theme}
          />
        ) : addMode === "paper" ? (
          <View style={styles.modalBody}>
            <Text style={[styles.helperText, { color: theme.muted }]}>
              Paste an arXiv URL, arXiv ID, DOI landing page, or open-journal paper URL. The app saves metadata, a readable text snapshot, and the PDF when the source allows it.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPaperInput}
              placeholder="https://arxiv.org/abs/1706.03762"
              placeholderTextColor={theme.muted}
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={paperInput}
            />
            <AppButton label={paperBusy ? "Importing..." : "Import Paper"} onPress={importPaper} disabled={!paperInput.trim() || paperBusy} theme={theme} />
          </View>
        ) : addMode === "archive" ? (
          <ScrollView contentContainerStyle={styles.archiveList} keyboardShouldPersistTaps="handled">
            <Text style={[styles.helperText, { color: theme.muted }]}>
              Browse research archives, search for older papers, then tap Import in the browser when you reach an article, PDF, or landing page.
            </Text>
            <View style={[styles.archiveCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <Text style={[styles.libraryTitle, { color: theme.text }]}>Royal Society Issue Import</Text>
              <Text style={[styles.libraryMeta, { color: theme.muted }]}>
                Save a local article catalog for a journal issue, including journal name, volume, issue, DOI/article ID, source URL, and PDF URL when detected.
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setArchiveIssueUrl}
                placeholder="https://royalsocietypublishing.org/rstl/issue/1/8"
                placeholderTextColor={theme.muted}
                style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background, marginTop: 10 }]}
                value={archiveIssueUrl}
              />
              <View style={styles.libraryActions}>
                <AppButton
                  label={archiveBusy ? "Importing..." : "Import Issue"}
                  onPress={onImportArchiveIssue}
                  disabled={!archiveIssueUrl.trim() || archiveBusy}
                  theme={theme}
                  compact
                />
                <AppButton
                  label="Browse"
                  onPress={() => onOpenArchiveUrl("Royal Society Issue", archiveIssueUrl)}
                  disabled={!archiveIssueUrl.trim()}
                  theme={theme}
                  variant="ghost"
                  compact
                />
              </View>
            </View>

            {archiveIssues.length ? (
              <>
                <Text style={[styles.previewLabel, { color: theme.muted }]}>Local Journal Catalog</Text>
                {archiveIssues.map((issue) => (
                  <View key={issue.id} style={[styles.archiveCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                    <Text style={[styles.libraryTitle, { color: theme.text }]}>{issue.journalName || issue.issueTitle}</Text>
                    <Text style={[styles.libraryMeta, { color: theme.muted }]}>
                      {[
                        issue.publisherName,
                        issue.year,
                        issue.month ? `Month ${issue.month}` : "",
                        issue.volume ? `Vol. ${issue.volume}` : "",
                        issue.issue ? `Issue ${issue.issue}` : "",
                        `${issue.articles.length} articles`,
                      ].filter(Boolean).join(" - ")}
                    </Text>
                    <View style={styles.libraryActions}>
                      <AppButton label="Open Issue" onPress={() => onOpenArchiveUrl(issue.issueTitle, issue.issueUrl)} theme={theme} variant="ghost" compact />
                    </View>
                    {issue.articles.slice(0, 12).map((article) => (
                      <View key={article.id} style={[styles.archiveArticleRow, { borderColor: theme.border }]}>
                        <View style={styles.archiveArticleText}>
                          <Text numberOfLines={2} style={[styles.outlineEditorTitle, { color: theme.text }]}>{article.title}</Text>
                          <Text numberOfLines={1} style={[styles.libraryMeta, { color: theme.muted }]}>
                            {article.articleId}{article.importedBookId ? " - Imported" : ""}
                          </Text>
                        </View>
                        <AppButton
                          label={article.importedBookId ? "Open" : "Import"}
                          onPress={() => article.importedBookId
                            ? onOpenArchiveUrl(article.title, article.sourceUrl)
                            : onImportArchiveArticle(issue, article)}
                          disabled={paperBusy}
                          theme={theme}
                          compact
                        />
                      </View>
                    ))}
                    {issue.articles.length > 12 ? (
                      <Text style={[styles.libraryMeta, { color: theme.muted }]}>
                        Showing 12 of {issue.articles.length}. Use Browse to navigate the full issue.
                      </Text>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}

            <Text style={[styles.previewLabel, { color: theme.muted }]}>Browse Archives</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setArchiveQuery}
              placeholder="Search old research, authors, topics, years"
              placeholderTextColor={theme.muted}
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={archiveQuery}
            />
            {researchArchiveSources.map((source) => {
              const query = archiveQuery.trim();
              return (
                <View key={source.id} style={[styles.archiveCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                  <Text style={[styles.libraryTitle, { color: theme.text }]}>{source.title}</Text>
                  <Text style={[styles.libraryMeta, { color: theme.muted }]}>{source.description}</Text>
                  <View style={styles.libraryActions}>
                    <AppButton
                      label="Open"
                      onPress={() => onOpenArchiveUrl(source.title, source.homeUrl)}
                      theme={theme}
                      variant="ghost"
                      compact
                    />
                    <AppButton
                      label="Search"
                      onPress={() => onOpenArchiveUrl(`${source.title}: ${query}`, source.searchUrl(query))}
                      disabled={!query}
                      theme={theme}
                      compact
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : addMode === "package" ? (
          <View style={styles.modalBody}>
            <Text style={[styles.helperText, { color: theme.muted }]}>
              Install a published `.bookpkg` from TamilSteam or any HTTPS URL. The readable text is saved offline and appears in the Published section of the library.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPackageUrl}
              placeholder="https://example.com/books/my-book-ta.bookpkg"
              placeholderTextColor={theme.muted}
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={packageUrl}
            />
            <AppButton label={packageBusy ? "Installing..." : "Install Package"} onPress={importPackage} disabled={!packageUrl.trim() || packageBusy} theme={theme} />
          </View>
        ) : (
          <View style={styles.modalBody}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setImportText}
              placeholder="Paste exported BookForge JSON"
              placeholderTextColor={theme.muted}
              style={[styles.importInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              textAlignVertical="top"
              value={importText}
            />
            <AppButton label="Import JSON" onPress={importBook} disabled={!importText.trim()} theme={theme} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function BookEditModal({
  apiKey,
  book,
  endpoint,
  model,
  onClose,
  onSave,
  open,
  theme,
}: {
  apiKey: string;
  book: Book;
  endpoint: string;
  model: string;
  onClose: () => void;
  onSave: (book: Book) => void;
  open: boolean;
  theme: Theme;
}) {
  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Book</Text>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <BookEditorForm
          apiKey={apiKey}
          endpoint={endpoint}
          initialBook={book}
          mode="edit"
          model={model}
          onSave={onSave}
          open={open}
          saveLabel="Save Book"
          theme={theme}
        />
      </SafeAreaView>
    </Modal>
  );
}

function BookEditorForm({
  apiKey,
  endpoint,
  initialBook,
  mode,
  model,
  onSave,
  open,
  saveLabel,
  theme,
}: {
  apiKey: string;
  endpoint: string;
  initialBook?: Book;
  mode: "create" | "edit";
  model: string;
  onSave: (book: Book) => void;
  open: boolean;
  saveLabel: string;
  theme: Theme;
}) {
  const [draft, setDraft] = useState<Book>(() => initialBook ? normalizeBook(initialBook) : createInitialBook());
  const [activeDraftNodeId, setActiveDraftNodeId] = useState("");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const flatDraft = useMemo(() => flattenBook(draft), [draft]);
  const activeEntry = flatDraft.find((entry) => entry.nodeId === activeDraftNodeId) ?? flatDraft[0];
  const activeNode = activeEntry?.section;
  const tagsValue = draft.tags.join(", ");
  const keywordsValue = activeNode?.keywords.join(", ") ?? "";

  useEffect(() => {
    if (!open) return;
    const next = initialBook ? normalizeBook(initialBook) : createInitialBook();
    setDraft(next);
    setActiveDraftNodeId(flattenBook(next)[0]?.nodeId ?? "");
  }, [initialBook?.id, mode, open]);

  useEffect(() => {
    if (flatDraft.length && !flatDraft.some((entry) => entry.nodeId === activeDraftNodeId)) {
      setActiveDraftNodeId(flatDraft[0].nodeId);
    }
  }, [activeDraftNodeId, flatDraft]);

  const updateDraft = (updater: (book: Book) => Book) => {
    setDraft((current) => ({ ...updater(current), updatedAt: new Date().toISOString() }));
  };

  const updateDraftNode = (id: string, updater: (node: OutlineNode) => OutlineNode) => {
    updateDraft((book) => ({ ...book, outline: updateOutlineNode(book.outline, id, updater) }));
  };

  const addChapter = () => {
    const chapter = createOutlineNode("chapter", "New Chapter", [createOutlineNode("section", "New Section")]);
    updateDraft((book) => ({ ...book, outline: [...book.outline, chapter] }));
    setActiveDraftNodeId(chapter.id);
  };

  const addChild = (parent: OutlineNode) => {
    const title = parent.type === "chapter" ? "New Section" : "New Subsection";
    const child = createOutlineNode("section", title);
    updateDraft((book) => ({ ...book, outline: appendOutlineChild(book.outline, parent.id, child) }));
    setActiveDraftNodeId(child.id);
  };

  const moveNode = (id: string, direction: -1 | 1) => {
    updateDraft((book) => {
      const result = moveOutlineNode(book.outline, id, direction);
      return result.moved ? { ...book, outline: result.nodes } : book;
    });
    setActiveDraftNodeId(id);
  };

  const suggestChildren = async (target: OutlineNode) => {
    setSuggestBusy(true);
    try {
      const suggestions = await requestOutlineSuggestions({
        apiKey,
        book: draft,
        endpoint,
        model,
        target,
      });
      const children = suggestions.map((item) => suggestionToNode(item, "section"));
      updateDraft((book) => ({ ...book, outline: appendOutlineChild(book.outline, target.id, children[0]) }));
      if (children.length > 1) {
        updateDraft((book) => ({
          ...book,
          outline: children.slice(1).reduce(
            (outline, child) => appendOutlineChild(outline, target.id, child),
            book.outline,
          ),
        }));
      }
      setActiveDraftNodeId(children[0]?.id ?? target.id);
      Alert.alert("Suggestions added", `Added ${children.length} suggested item${children.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("Suggestion failed", message);
    } finally {
      setSuggestBusy(false);
    }
  };

  const removeNode = (id: string) => {
    if (flatDraft.length <= 1) return;
    const nextOutline = removeOutlineNode(draft.outline, id);
    const nextBook = { ...draft, outline: nextOutline.length ? nextOutline : createInitialBook().outline };
    const nextActive = flattenBook(nextBook)[0]?.nodeId ?? "";
    setDraft(nextBook);
    setActiveDraftNodeId(nextActive);
  };

  const createDisabled = !draft.title.trim() || !draft.outline.length;

  return (
    <ScrollView contentContainerStyle={styles.bookCreatorContent} keyboardShouldPersistTaps="handled">
      <TextInput
        onChangeText={(value) => updateDraft((book) => ({ ...book, title: value }))}
        placeholder="Book title"
        placeholderTextColor={theme.muted}
        style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
        value={draft.title}
      />
      <TextInput
        onChangeText={(value) => updateDraft((book) => ({ ...book, audience: value }))}
        placeholder="Audience"
        placeholderTextColor={theme.muted}
        style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
        value={draft.audience}
      />
      <TextInput
        onChangeText={(value) => updateDraft((book) => ({ ...book, tone: value }))}
        placeholder="Tone"
        placeholderTextColor={theme.muted}
        style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
        value={draft.tone}
      />
      <TextInput
        multiline
        onChangeText={(value) => updateDraft((book) => ({ ...book, synopsis: value }))}
        placeholder="Synopsis"
        placeholderTextColor={theme.muted}
        style={[styles.questionInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
        textAlignVertical="top"
        value={draft.synopsis}
      />
      <TextInput
        onChangeText={(value) =>
          updateDraft((book) => ({
            ...book,
            tags: value.split(",").map((tag) => tag.trim()).filter(Boolean),
          }))
        }
        placeholder="Tags, comma separated"
        placeholderTextColor={theme.muted}
        style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
        value={tagsValue}
      />

      <View style={styles.creatorSectionHeader}>
        <Text style={[styles.previewLabel, { color: theme.muted }]}>Contents</Text>
        <AppButton label="+ Chapter" onPress={addChapter} theme={theme} variant="ghost" compact />
      </View>
      <View style={[styles.outlineEditor, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        {flatDraft.map((entry) => {
          const selected = entry.nodeId === activeDraftNodeId;
          return (
            <Pressable
              key={entry.nodeId}
              onPress={() => setActiveDraftNodeId(entry.nodeId)}
              style={[
                styles.outlineEditorRow,
                {
                  borderColor: theme.border,
                  paddingLeft: 10 + entry.depth * 14,
                  backgroundColor: selected ? theme.accent : "transparent",
                },
              ]}
            >
              <View style={styles.outlineEditorText}>
                <Text style={[styles.outlineEditorType, { color: selected ? theme.accentText : theme.muted }]}>
                  {entry.section.type}
                </Text>
                <Text numberOfLines={1} style={[styles.outlineEditorTitle, { color: selected ? theme.accentText : theme.text }]}>
                  {entry.section.title || "Untitled"}
                </Text>
              </View>
              <View style={styles.outlineEditorActions}>
                <AppButton label="Up" onPress={() => moveNode(entry.nodeId, -1)} theme={theme} variant="ghost" compact />
                <AppButton label="Down" onPress={() => moveNode(entry.nodeId, 1)} theme={theme} variant="ghost" compact />
                <AppButton label="+" onPress={() => addChild(entry.section)} theme={theme} variant={selected ? "solid" : "ghost"} compact />
                <AppButton label="x" onPress={() => removeNode(entry.nodeId)} theme={theme} variant="ghost" compact disabled={flatDraft.length <= 1} />
              </View>
            </Pressable>
          );
        })}
      </View>

      {activeNode ? (
        <View style={[styles.nodeEditor, { borderColor: theme.border }]}>
          <View style={styles.creatorSectionHeader}>
            <Text style={[styles.previewLabel, { color: theme.muted }]}>Selected Item</Text>
            <AppButton
              label={suggestBusy ? "Suggesting..." : "Suggest"}
              onPress={() => void suggestChildren(activeNode)}
              disabled={suggestBusy}
              theme={theme}
              variant="ghost"
              compact
            />
          </View>
          <TextInput
            onChangeText={(value) => updateDraftNode(activeNode.id, (node) => ({ ...node, title: value }))}
            placeholder="Title"
            placeholderTextColor={theme.muted}
            style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            value={activeNode.title}
          />
          <TextInput
            multiline
            onChangeText={(value) => updateDraftNode(activeNode.id, (node) => ({ ...node, summary: value }))}
            placeholder="Summary"
            placeholderTextColor={theme.muted}
            style={[styles.questionInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            textAlignVertical="top"
            value={activeNode.summary}
          />
          <TextInput
            multiline
            onChangeText={(value) => updateDraftNode(activeNode.id, (node) => ({ ...node, content: value }))}
            placeholder="Readable content"
            placeholderTextColor={theme.muted}
            style={[styles.contentInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            textAlignVertical="top"
            value={activeNode.content}
          />
          <TextInput
            onChangeText={(value) =>
              updateDraftNode(activeNode.id, (node) => ({
                ...node,
                keywords: value.split(",").map((keyword) => keyword.trim()).filter(Boolean),
              }))
            }
            placeholder="Keywords, comma separated"
            placeholderTextColor={theme.muted}
            style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            value={keywordsValue}
          />
        </View>
      ) : null}

      <AppButton label={saveLabel} onPress={() => onSave(draft)} disabled={createDisabled} theme={theme} />
    </ScrollView>
  );
}

function PaperTextModal({
  busy,
  onAskSelection,
  onClose,
  open,
  text,
  theme,
  title,
}: {
  busy: boolean;
  onAskSelection: (action: "explain" | "summarize" | "define", selectedText: string) => void;
  onClose: () => void;
  open: boolean;
  text: string;
  theme: Theme;
  title: string;
}) {
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    setSelectedText("");
  }, [open, text]);

  const updateSelectedText = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    const { start, end } = event.nativeEvent.selection;
    const selected = start === end ? "" : text.slice(Math.min(start, end), Math.max(start, end));
    setSelectedText(selected);
  };

  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <View style={styles.noteTitleBlock}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Paper Text</Text>
            <Text numberOfLines={1} style={[styles.noteMeta, { color: theme.muted }]}>{title}</Text>
          </View>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        {busy ? (
          <View style={styles.webLoading}>
            <ActivityIndicator />
          </View>
        ) : (
          <View style={styles.paperTextBody}>
            <Text style={[styles.helperText, { color: theme.muted }]}>
              Select a passage from the saved paper text, then ask Assist to explain, summarize, or define it.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={() => undefined}
              onSelectionChange={updateSelectedText}
              scrollEnabled
              showSoftInputOnFocus={false}
              style={[styles.paperTextInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              textAlignVertical="top"
              value={text}
            />
            {selectedText.trim() ? (
              <View style={styles.selectionActions}>
                <AppButton label="Explain" onPress={() => onAskSelection("explain", selectedText)} theme={theme} compact />
                <AppButton label="Summarize" onPress={() => onAskSelection("summarize", selectedText)} theme={theme} variant="ghost" compact />
                <AppButton label="Define" onPress={() => onAskSelection("define", selectedText)} theme={theme} variant="ghost" compact />
              </View>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function AssistModal({
  answer,
  apiKey,
  busy,
  endpoint,
  mode,
  model,
  modelError,
  models,
  modelsBusy,
  onAnswerChange,
  onAskSelection,
  onClose,
  onRefreshModels,
  onRun,
  open,
  question,
  setApiKey,
  usage,
  setEndpoint,
  setMode,
  setModel,
  setQuestion,
  onSaveAnswer,
  canSaveAnswer,
  theme,
}: {
  answer: string;
  apiKey: string;
  busy: boolean;
  endpoint: string;
  mode: AssistMode;
  model: string;
  modelError: string;
  models: AssistModelOption[];
  modelsBusy: boolean;
  onAnswerChange: (value: string) => void;
  onAskSelection: (action: "explain" | "summarize" | "define", selectedText: string) => void;
  onClose: () => void;
  onRefreshModels: () => void;
  onRun: () => void;
  open: boolean;
  question: string;
  setApiKey: (value: string) => void;
  usage?: TokenUsage;
  setEndpoint: (value: string) => void;
  setMode: (value: AssistMode) => void;
  setModel: (value: string) => void;
  setQuestion: (value: string) => void;
  onSaveAnswer: () => void;
  canSaveAnswer: boolean;
  theme: Theme;
}) {
  const modes: AssistMode[] = ["paper", "concept", "augment", "summary", "kids", "method", "critique", "custom"];
  const [modelsOpen, setModelsOpen] = useState(false);
  const [selectedAnswerText, setSelectedAnswerText] = useState("");

  useEffect(() => {
    setSelectedAnswerText("");
  }, [answer]);

  const updateSelectedAnswerText = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    const { start, end } = event.nativeEvent.selection;
    const selected = start === end ? "" : answer.slice(Math.min(start, end), Math.max(start, end));
    setSelectedAnswerText(selected);
  };

  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
          style={styles.keyboardAvoiding}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Assist</Text>
            <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
          </View>
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.assistContent}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.helperText, { color: theme.muted }]}>
              Defaults to the BookForge router. Load models from the router, then choose the model to send with every Assist request.
            </Text>
            <View style={styles.modeGrid}>
              {modes.map((entry) => (
                <AppButton
                  key={entry}
                  label={entry}
                  onPress={() => setMode(entry)}
                  theme={theme}
                  variant={mode === entry ? "solid" : "ghost"}
                  compact
                />
              ))}
            </View>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setEndpoint}
              placeholder="http://100.66.32.111:1235/v1"
              placeholderTextColor={theme.muted}
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={endpoint}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={false}
              onChangeText={setModel}
              placeholder="Model"
              placeholderTextColor={theme.muted}
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={model}
            />
            <View style={styles.modelPickerActions}>
              <AppButton
                label={modelsBusy ? "Loading..." : "Load Models"}
                onPress={onRefreshModels}
                disabled={modelsBusy || !endpoint.trim()}
                theme={theme}
                variant="ghost"
                compact
              />
              <AppButton
                label={modelsOpen ? "Hide Models" : `Models ${models.length || ""}`.trim()}
                onPress={() => setModelsOpen((value) => !value)}
                disabled={!models.length}
                theme={theme}
                variant="ghost"
                compact
              />
            </View>
            {modelError ? (
              <Text style={[styles.helperText, { color: theme.muted }]}>
                {modelError}
              </Text>
            ) : null}
            {modelsOpen && models.length ? (
              <View style={[styles.modelDropdown, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {models.map((entry) => {
                  const selected = entry.id === model;
                  return (
                    <Pressable
                      key={`${entry.provider ?? "provider"}-${entry.id}`}
                      onPress={() => {
                        setModel(entry.id);
                        setModelsOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.modelOption,
                        {
                          borderColor: theme.border,
                          backgroundColor: selected ? theme.accent : "transparent",
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.modelOptionTitle, { color: selected ? theme.accentText : theme.text }]}>
                        {entry.label || entry.id}
                      </Text>
                      {entry.id || entry.provider || entry.upstreamId ? (
                        <Text style={[styles.modelOptionMeta, { color: selected ? theme.accentText : theme.muted }]}>
                          {[entry.id, entry.provider, entry.upstreamId ? `upstream ${entry.upstreamId}` : ""].filter(Boolean).join(" - ")}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setApiKey}
              placeholder="API key (optional for local servers)"
              placeholderTextColor={theme.muted}
              secureTextEntry
              style={[styles.singleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={apiKey}
            />
            <TextInput
              multiline
              onChangeText={setQuestion}
              placeholder="Optional question, e.g. what is the paper's main claim?"
              placeholderTextColor={theme.muted}
              style={[styles.questionInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              textAlignVertical="top"
              value={question}
            />
            <View style={styles.assistActions}>
              <AppButton label={busy ? "Thinking..." : "Run Assist"} onPress={onRun} disabled={busy} theme={theme} />
              <AppButton label="Save Note" onPress={onSaveAnswer} disabled={!canSaveAnswer || busy} theme={theme} variant="ghost" />
            </View>
            {usage ? <TokenUsageBadge usage={usage} theme={theme} /> : null}
            {answer ? (
              <>
                <View style={[styles.assistAnswer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Text style={[styles.previewLabel, { color: theme.muted }]}>Preview</Text>
                  <MarkdownPreview content={answer} theme={theme} />
                </View>
                <View style={[styles.assistAnswer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Text style={[styles.previewLabel, { color: theme.muted }]}>Markdown Source</Text>
                  <TextInput
                    multiline
                    onChangeText={onAnswerChange}
                    onSelectionChange={updateSelectedAnswerText}
                    style={[styles.markdownEditor, { color: theme.text, borderColor: theme.border }]}
                    textAlignVertical="top"
                    value={answer}
                  />
                  {selectedAnswerText.trim() ? (
                    <View style={styles.selectionActions}>
                      <AppButton label="Explain" onPress={() => onAskSelection("explain", selectedAnswerText)} disabled={busy} theme={theme} compact />
                      <AppButton label="Summarize" onPress={() => onAskSelection("summarize", selectedAnswerText)} disabled={busy} theme={theme} variant="ghost" compact />
                      <AppButton label="Define" onPress={() => onAskSelection("define", selectedAnswerText)} disabled={busy} theme={theme} variant="ghost" compact />
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
function MarkdownPreview({ content, theme }: { content: string; theme: Theme }) {
  const blocks: React.ReactNode[] = [];
  const paragraph: string[] = [];
  const codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) {
      blocks.push(
        <Text key={`p-${blocks.length}`} style={[styles.markdownParagraph, { color: theme.text }]}>
          {renderInlineMarkdown(text, theme, `p-${blocks.length}`)}
        </Text>,
      );
    }
    paragraph.length = 0;
  };

  const flushCodeBlock = () => {
    if (!codeLines.length) return;
    blocks.push(
      <Text key={`code-${blocks.length}`} style={[styles.markdownCodeBlock, { color: theme.text, borderColor: theme.border }]}>
        {codeLines.join("\n")}
      </Text>,
    );
    codeLines.length = 0;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push(
        <Text
          key={`h-${blocks.length}`}
          style={[
            level <= 2 ? styles.markdownHeadingLarge : styles.markdownHeadingSmall,
            { color: theme.text },
          ]}
        >
          {renderInlineMarkdown(heading[2], theme, `h-${blocks.length}`)}
        </Text>,
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(
        <View key={`b-${blocks.length}`} style={styles.markdownListRow}>
          <Text style={[styles.markdownListMarker, { color: theme.muted }]}>{"\u2022"}</Text>
          <Text style={[styles.markdownListText, { color: theme.text }]}>
            {renderInlineMarkdown(bullet[1], theme, `b-${blocks.length}`)}
          </Text>
        </View>,
      );
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push(
        <View key={`n-${blocks.length}`} style={styles.markdownListRow}>
          <Text style={[styles.markdownListMarker, { color: theme.muted }]}>{numbered[1]}.</Text>
          <Text style={[styles.markdownListText, { color: theme.text }]}>
            {renderInlineMarkdown(numbered[2], theme, `n-${blocks.length}`)}
          </Text>
        </View>,
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      blocks.push(
        <Text key={`q-${blocks.length}`} style={[styles.markdownQuote, { color: theme.muted, borderLeftColor: theme.border }]}>
          {renderInlineMarkdown(trimmed.replace(/^>\s?/, ""), theme, `q-${blocks.length}`)}
        </Text>,
      );
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushCodeBlock();

  return <View style={styles.markdownPreview}>{blocks}</View>;
}

function renderInlineMarkdown(text: string, theme: Theme, keyPrefix: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={`${keyPrefix}-strong-${index}`} style={styles.markdownStrong}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <Text key={`${keyPrefix}-em-${index}`} style={styles.markdownEmphasis}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={`${keyPrefix}-code-${index}`} style={[styles.markdownInlineCode, { borderColor: theme.border }]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return part;
  });
}

function TokenUsageBadge({ usage, theme }: { usage: TokenUsage; theme: Theme }) {
  const parts = [
    usage.inputTokens !== undefined ? `Input ${usage.inputTokens}` : "",
    usage.outputTokens !== undefined ? `Output ${usage.outputTokens}` : "",
    usage.totalTokens !== undefined ? `Total ${usage.totalTokens}` : "",
  ].filter(Boolean);

  if (!parts.length) return null;

  return (
    <View style={[styles.tokenUsageBadge, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.tokenUsageText, { color: theme.muted }]}>
        {parts.join(" - ")} tokens
      </Text>
    </View>
  );
}

function tokenUsageLabel(usage: TokenUsage | undefined) {
  if (!usage) return "";
  const parts = [
    usage.inputTokens !== undefined ? `in ${usage.inputTokens}` : "",
    usage.outputTokens !== undefined ? `out ${usage.outputTokens}` : "",
    usage.totalTokens !== undefined ? `total ${usage.totalTokens}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "";
}

function TopicNotesAccordion({
  notes,
  onAskSelection,
  onRemove,
  theme,
}: {
  notes: AiNote[];
  onAskSelection: (action: "explain" | "summarize" | "define", selectedText: string) => void;
  onRemove: (noteId: string) => void;
  theme: Theme;
}) {
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const noteIds = notes.map((note) => note.id).join("|");

  useEffect(() => {
    setExpandedNotes((current) => {
      const next: Record<string, boolean> = {};
      notes.forEach((note, index) => {
        next[note.id] = current[note.id] ?? index === 0;
      });
      return next;
    });
  }, [noteIds]);

  if (!notes.length) return null;

  const toggleNote = (noteId: string) => {
    setExpandedNotes((current) => ({ ...current, [noteId]: !current[noteId] }));
  };

  return (
    <View style={[styles.topicNotesPanel, { borderColor: theme.border }]}>
      <View style={styles.topicNotesHeader}>
        <View>
          <Text style={[styles.resourceTitle, { color: theme.muted }]}>Topic Notes</Text>
          <Text style={[styles.noteMeta, { color: theme.muted }]}>
            {notes.length} saved for this node
          </Text>
        </View>
      </View>
      <View style={styles.topicNotesList}>
        {notes.map((note) => {
          const expanded = expandedNotes[note.id] ?? false;
          return (
            <View key={note.id} style={[styles.noteCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.noteHeader}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => toggleNote(note.id)}
                  style={styles.noteAccordionToggle}
                >
                  <Text style={[styles.noteTitle, { color: theme.text }]}>{note.title}</Text>
                  <Text style={[styles.noteMeta, { color: theme.muted }]}>
                    {[note.kind, note.model, tokenUsageLabel(note.tokenUsage), noteDateLabel(note)].filter(Boolean).join(" - ")}
                  </Text>
                </Pressable>
                <View style={styles.noteAccordionActions}>
                  <AppButton label={expanded ? "Hide" : "Show"} onPress={() => toggleNote(note.id)} theme={theme} variant="ghost" compact />
                  <AppButton label="Delete" onPress={() => onRemove(note.id)} theme={theme} variant="ghost" compact />
                </View>
              </View>
              {expanded ? (
                <>
                  {note.question ? (
                    <Text style={[styles.noteQuestion, { borderLeftColor: theme.border, color: theme.muted }]}>{note.question}</Text>
                  ) : null}
                  <View style={styles.noteContent}>
                    <MarkdownPreview content={note.content} theme={theme} />
                  </View>
                  <SelectableNoteText content={note.content} onAskSelection={onAskSelection} theme={theme} />
                </>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function NotesModal({
  notes,
  onAskSelection,
  onClose,
  onRemove,
  open,
  theme,
  topicTitle,
}: {
  notes: AiNote[];
  onAskSelection: (action: "explain" | "summarize" | "define", selectedText: string) => void;
  onClose: () => void;
  onRemove: (noteId: string) => void;
  open: boolean;
  theme: Theme;
  topicTitle: string;
}) {
  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <View style={styles.noteTitleBlock}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Topic Notes</Text>
            <Text style={[styles.noteMeta, { color: theme.muted }]}>
              {topicTitle} - {notes.length} saved
            </Text>
          </View>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <ScrollView contentContainerStyle={styles.notesList}>
          {notes.length ? notes.map((note) => (
            <View key={note.id} style={[styles.noteCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.noteHeader}>
                <View style={styles.noteTitleBlock}>
                  <Text style={[styles.noteTitle, { color: theme.text }]}>{note.title}</Text>
                  <Text style={[styles.noteMeta, { color: theme.muted }]}>
                    {[note.kind, note.sourceSectionTitle, note.model, tokenUsageLabel(note.tokenUsage), noteDateLabel(note)].filter(Boolean).join(" - ")}
                  </Text>
                </View>
                <AppButton label="Delete" onPress={() => onRemove(note.id)} theme={theme} variant="ghost" compact />
              </View>
              {note.question ? (
                <Text style={[styles.noteQuestion, { borderLeftColor: theme.border, color: theme.muted }]}>{note.question}</Text>
              ) : null}
              <View style={styles.noteContent}>
                <MarkdownPreview content={note.content} theme={theme} />
              </View>
              <SelectableNoteText content={note.content} onAskSelection={onAskSelection} theme={theme} />
            </View>
          )) : (
            <View style={[styles.emptyNotes, { borderColor: theme.border }]}>
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Run Assist on this topic, then save explanations, concepts, and references here.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function SelectableNoteText({
  content,
  onAskSelection,
  theme,
}: {
  content: string;
  onAskSelection: (action: "explain" | "summarize" | "define", selectedText: string) => void;
  theme: Theme;
}) {
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    setSelectedText("");
  }, [content]);

  const updateSelectedText = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    const { start, end } = event.nativeEvent.selection;
    const selected = start === end ? "" : content.slice(Math.min(start, end), Math.max(start, end));
    setSelectedText(selected);
  };

  return (
    <View style={[styles.noteSelectableText, { borderColor: theme.border }]}>
      <Text style={[styles.previewLabel, { color: theme.muted }]}>Selectable Note Text</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        onChangeText={() => undefined}
        onSelectionChange={updateSelectedText}
        scrollEnabled
        showSoftInputOnFocus={false}
        style={[styles.noteTextInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
        textAlignVertical="top"
        value={content}
      />
      {selectedText.trim() ? (
        <View style={styles.selectionActions}>
          <AppButton label="Explain" onPress={() => onAskSelection("explain", selectedText)} theme={theme} compact />
          <AppButton label="Summarize" onPress={() => onAskSelection("summarize", selectedText)} theme={theme} variant="ghost" compact />
          <AppButton label="Define" onPress={() => onAskSelection("define", selectedText)} theme={theme} variant="ghost" compact />
        </View>
      ) : null}
    </View>
  );
}

function LibraryModal({
  activeBookId,
  activePackageId,
  books,
  packages,
  onClose,
  onEdit,
  onOpen,
  onOpenPackage,
  onRemove,
  onRemovePackage,
  open,
  storedBookIds,
  theme,
}: {
  activeBookId: string;
  activePackageId: string;
  books: Book[];
  packages: InstalledPackage[];
  onClose: () => void;
  onEdit: (book: Book) => void;
  onOpen: (book: Book) => void;
  onOpenPackage: (pkg: InstalledPackage) => void;
  onRemove: (book: Book) => void;
  onRemovePackage: (pkg: InstalledPackage) => void;
  open: boolean;
  storedBookIds: string[];
  theme: Theme;
}) {
  const storedBooks = books.filter((book) => storedBookIds.includes(book.id));
  const starterBooks = books.filter((book) => !storedBookIds.includes(book.id));

  const renderBook = (book: Book) => {
    const stored = storedBookIds.includes(book.id);
    return (
      <View
        key={book.id}
        style={[styles.libraryItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={styles.libraryItemText}>
          <Text style={[styles.libraryTitle, { color: theme.text }]}>{book.title}</Text>
          <Text numberOfLines={2} style={[styles.libraryMeta, { color: theme.muted }]}>
            {book.audience || "Reader"} - {book.outline.length} chapters - {outlineItemCount(book)} items
            {book.source?.type ? ` - ${book.source.type}` : ""}
            {book.id === activeBookId ? " - Open" : ""}
          </Text>
        </View>
        <View style={styles.libraryActions}>
          <AppButton label="Read" onPress={() => onOpen(book)} theme={theme} compact />
          <AppButton label="Edit" onPress={() => onEdit(book)} theme={theme} variant="ghost" compact />
          {stored ? (
            <AppButton label="Delete" onPress={() => onRemove(book)} theme={theme} variant="ghost" compact />
          ) : null}
        </View>
      </View>
    );
  };

  const renderPackage = (pkg: InstalledPackage) => (
    <View
      key={pkg.packageId}
      style={[styles.libraryItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <View style={styles.libraryItemText}>
        <Text style={[styles.libraryTitle, { color: theme.text }]}>{pkg.title}</Text>
        <Text numberOfLines={2} style={[styles.libraryMeta, { color: theme.muted }]}>
          {pkg.languages.join(", ") || pkg.defaultLanguage} - {pkg.pages.length} pages - v{pkg.version} r{pkg.revision}
          {pkg.manifest.publisher?.name ? ` - ${pkg.manifest.publisher.name}` : ""}
          {pkg.packageId === activePackageId ? " - Open" : ""}
        </Text>
      </View>
      <View style={styles.libraryActions}>
        <AppButton label="Read" onPress={() => onOpenPackage(pkg)} theme={theme} compact />
        <AppButton label="Delete" onPress={() => onRemovePackage(pkg)} theme={theme} variant="ghost" compact />
      </View>
    </View>
  );

  return (
    <Modal animationType="slide" visible={open} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalShell, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <View style={styles.noteTitleBlock}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Books</Text>
            <Text style={[styles.noteMeta, { color: theme.muted }]}>
              {storedBooks.length} custom - {packages.length} published
            </Text>
          </View>
          <AppButton label="Close" onPress={onClose} theme={theme} variant="ghost" />
        </View>
        <ScrollView contentContainerStyle={styles.libraryList}>
          <Text style={[styles.previewLabel, { color: theme.muted }]}>My Books</Text>
          {storedBooks.length ? storedBooks.map(renderBook) : (
            <View style={[styles.emptyNotes, { borderColor: theme.border }]}>
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Created and imported books will appear here.
              </Text>
            </View>
          )}
          <Text style={[styles.previewLabel, { color: theme.muted }]}>Published</Text>
          {packages.length ? packages.map(renderPackage) : (
            <View style={[styles.emptyNotes, { borderColor: theme.border }]}>
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Installed translated packages will appear here.
              </Text>
            </View>
          )}
          {starterBooks.length ? (
            <>
              <Text style={[styles.previewLabel, { color: theme.muted }]}>Starter Books</Text>
              {starterBooks.map(renderBook)}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 23,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  reader: {
    flex: 1,
  },
  readerContent: {
    padding: 16,
    paddingBottom: 26,
  },
  chapterTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 34,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "capitalize",
  },
  readingSurface: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  paragraph: {
    fontWeight: "400",
    letterSpacing: 0,
    marginBottom: 18,
  },
  resourcePanel: {
    marginTop: 14,
  },
  resourceTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  resourceButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  packageLanguageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  topicNotesPanel: {
    borderTopWidth: 1,
    marginTop: 18,
    paddingTop: 14,
  },
  topicNotesHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  topicNotesList: {
    gap: 10,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  footerTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progress: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  controlsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  status: {
    fontSize: 12,
    marginTop: 8,
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  buttonCompact: {
    minHeight: 34,
    paddingHorizontal: 11,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "capitalize",
  },
  modalShell: {
    flex: 1,
    padding: 16,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
  },
  modalBody: {
    flex: 1,
    gap: 14,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
  },
  singleInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  questionInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 92,
    padding: 12,
  },
  importInput: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
    padding: 12,
  },
  bookCreatorContent: {
    gap: 12,
    paddingBottom: 32,
  },
  creatorSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  outlineEditor: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  outlineEditorRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 58,
    paddingRight: 8,
    paddingVertical: 8,
  },
  outlineEditorText: {
    flex: 1,
  },
  outlineEditorType: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  outlineEditorTitle: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0,
    marginTop: 2,
  },
  outlineEditorActions: {
    flexDirection: "row",
    gap: 6,
  },
  nodeEditor: {
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 12,
  },
  contentInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 150,
    padding: 12,
  },
  paperTextBody: {
    flex: 1,
    gap: 12,
  },
  paperTextInput: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    padding: 12,
  },
  libraryList: {
    gap: 10,
    paddingBottom: 24,
  },
  libraryItem: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  libraryItemText: {
    marginBottom: 12,
  },
  libraryTitle: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
  },
  libraryMeta: {
    fontSize: 13,
    marginTop: 4,
  },
  libraryActions: {
    flexDirection: "row",
    gap: 8,
  },
  archiveList: {
    gap: 12,
    paddingBottom: 32,
  },
  archiveCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  archiveArticleRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
  },
  archiveArticleText: {
    flex: 1,
  },
  notesList: {
    gap: 12,
    paddingBottom: 32,
  },
  noteCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  noteHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  noteAccordionToggle: {
    flex: 1,
  },
  noteAccordionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
  },
  noteTitleBlock: {
    flex: 1,
  },
  noteTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
  },
  noteMeta: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  noteQuestion: {
    borderLeftWidth: 2,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    paddingLeft: 10,
  },
  noteContent: {
    marginTop: 12,
  },
  noteSelectableText: {
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 12,
  },
  noteTextInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontFamily: "Menlo",
    fontSize: 12,
    lineHeight: 18,
    maxHeight: 180,
    minHeight: 92,
    padding: 10,
  },
  emptyNotes: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  assistContent: {
    gap: 12,
    paddingBottom: 180,
  },
  modeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modelPickerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modelDropdown: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  modelOption: {
    borderBottomWidth: 1,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modelOptionTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
  },
  modelOptionMeta: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  assistActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  assistAnswer: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  markdownEditor: {
    borderRadius: 8,
    borderWidth: 1,
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 19,
    maxHeight: 220,
    minHeight: 130,
    padding: 10,
  },
  selectionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  tokenUsageBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tokenUsageText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  markdownPreview: {
    gap: 7,
  },
  markdownHeadingLarge: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 24,
    marginTop: 4,
  },
  markdownHeadingSmall: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 21,
    marginTop: 3,
  },
  markdownParagraph: {
    fontSize: 14,
    lineHeight: 21,
  },
  markdownListRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  markdownListMarker: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 21,
    minWidth: 20,
  },
  markdownListText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
  markdownQuote: {
    borderLeftWidth: 3,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 21,
    paddingLeft: 10,
  },
  markdownCodeBlock: {
    borderRadius: 8,
    borderWidth: 1,
    fontFamily: "Menlo",
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  markdownStrong: {
    fontWeight: "800",
  },
  markdownEmphasis: {
    fontStyle: "italic",
  },
  markdownInlineCode: {
    borderRadius: 5,
    borderWidth: 1,
    fontFamily: "Menlo",
    fontSize: 12,
    paddingHorizontal: 3,
  },
  webShell: {
    flex: 1,
  },
  webHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  webTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
    paddingRight: 12,
  },
  webHeaderActions: {
    flexDirection: "row",
    gap: 8,
  },
  webLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
