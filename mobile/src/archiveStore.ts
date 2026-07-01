import * as FileSystem from "expo-file-system";

export type ArchiveProvider = "royal-society" | "fraser" | "ieee" | "arxiv" | "pubmed" | "open-web";

export type JournalArchiveArticle = {
  id: string;
  provider: ArchiveProvider;
  journalName: string;
  issueTitle: string;
  issueUrl: string;
  articleId: string;
  title: string;
  authors: string[];
  year?: string;
  month?: string;
  publishedAt?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  sourceUrl: string;
  pdfUrl?: string;
  importedBookId?: string;
};

export type JournalArchiveIssue = {
  id: string;
  provider: ArchiveProvider;
  publisherName: string;
  journalName: string;
  issueTitle: string;
  issueUrl: string;
  year?: string;
  month?: string;
  volume?: string;
  issue?: string;
  importedAt: string;
  articles: JournalArchiveArticle[];
};

function assertDocumentDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error("Device document storage is unavailable.");
  }
  return FileSystem.documentDirectory;
}

function archiveDirectory() {
  return `${assertDocumentDirectory()}journal-archives/`;
}

function safePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-") || "archive";
}

function archivePath(issueId: string) {
  return `${archiveDirectory()}${safePathPart(issueId)}.json`;
}

async function ensureArchiveDirectory() {
  const directory = archiveDirectory();
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeArticle(value: unknown): JournalArchiveArticle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  const sourceUrl = typeof raw.sourceUrl === "string" ? raw.sourceUrl : "";
  if (!id || !title || !sourceUrl) return null;

  return {
    id,
    provider: raw.provider === "royal-society" ? "royal-society" : "open-web",
    journalName: typeof raw.journalName === "string" ? raw.journalName : "",
    issueTitle: typeof raw.issueTitle === "string" ? raw.issueTitle : "",
    issueUrl: typeof raw.issueUrl === "string" ? raw.issueUrl : "",
    articleId: typeof raw.articleId === "string" ? raw.articleId : id,
    title,
    authors: normalizeStringArray(raw.authors),
    year: typeof raw.year === "string" ? raw.year : undefined,
    month: typeof raw.month === "string" ? raw.month : undefined,
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : undefined,
    volume: typeof raw.volume === "string" ? raw.volume : undefined,
    issue: typeof raw.issue === "string" ? raw.issue : undefined,
    pages: typeof raw.pages === "string" ? raw.pages : undefined,
    sourceUrl,
    pdfUrl: typeof raw.pdfUrl === "string" ? raw.pdfUrl : undefined,
    importedBookId: typeof raw.importedBookId === "string" ? raw.importedBookId : undefined,
  };
}

function normalizeIssue(value: unknown): JournalArchiveIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const issueUrl = typeof raw.issueUrl === "string" ? raw.issueUrl : "";
  if (!id || !issueUrl) return null;

  return {
    id,
    provider: raw.provider === "royal-society" ? "royal-society" : "open-web",
    publisherName: typeof raw.publisherName === "string" ? raw.publisherName : "",
    journalName: typeof raw.journalName === "string" ? raw.journalName : "",
    issueTitle: typeof raw.issueTitle === "string" ? raw.issueTitle : "",
    issueUrl,
    year: typeof raw.year === "string" ? raw.year : undefined,
    month: typeof raw.month === "string" ? raw.month : undefined,
    volume: typeof raw.volume === "string" ? raw.volume : undefined,
    issue: typeof raw.issue === "string" ? raw.issue : undefined,
    importedAt: typeof raw.importedAt === "string" ? raw.importedAt : new Date(0).toISOString(),
    articles: Array.isArray(raw.articles)
      ? raw.articles.map(normalizeArticle).filter((entry): entry is JournalArchiveArticle => Boolean(entry))
      : [],
  };
}

export async function loadJournalArchiveIssues() {
  const directory = await ensureArchiveDirectory();
  const entries = await FileSystem.readDirectoryAsync(directory);
  const issues: JournalArchiveIssue[] = [];

  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      const issue = normalizeIssue(JSON.parse(await FileSystem.readAsStringAsync(`${directory}${entry}`)));
      if (issue) issues.push(issue);
    } catch {
      // Ignore malformed local catalog files.
    }
  }

  return issues.sort((left, right) =>
    right.importedAt.localeCompare(left.importedAt) || left.journalName.localeCompare(right.journalName)
  );
}

export async function saveJournalArchiveIssue(issue: JournalArchiveIssue) {
  await ensureArchiveDirectory();
  await FileSystem.writeAsStringAsync(archivePath(issue.id), JSON.stringify(issue, null, 2));
  return issue;
}

export async function markArchiveArticleImported(issueId: string, articleId: string, importedBookId: string) {
  const issues = await loadJournalArchiveIssues();
  const issue = issues.find((entry) => entry.id === issueId);
  if (!issue) return;
  await saveJournalArchiveIssue({
    ...issue,
    articles: issue.articles.map((article) =>
      article.id === articleId ? { ...article, importedBookId } : article
    ),
  });
}
