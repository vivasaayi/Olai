import { saveJournalArchiveIssue, type JournalArchiveArticle, type JournalArchiveIssue } from "./archiveStore";

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function readHtmlTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? stripTags(title) : "";
}

function readMeta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const reversePattern = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i");
  return decodeEntities(html.match(pattern)?.[1] ?? html.match(reversePattern)?.[1] ?? "");
}

function absoluteUrl(baseUrl: string, value: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function stableArchiveId(value: string) {
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "archive";
}

function monthFromDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

function yearFromDate(value: string) {
  const year = value.match(/\b(16|17|18|19|20)\d{2}\b/)?.[0];
  if (year) return year;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : String(date.getUTCFullYear());
}

function royalSocietyJournalName(journalCode: string) {
  const journals: Record<string, string> = {
    rstl: "Philosophical Transactions of the Royal Society of London",
    rsta: "Philosophical Transactions of the Royal Society A",
    rstb: "Philosophical Transactions of the Royal Society B",
    rspa: "Proceedings of the Royal Society A",
    rspb: "Proceedings of the Royal Society B",
    rsos: "Royal Society Open Science",
    rsif: "Journal of The Royal Society Interface",
    rsbl: "Biology Letters",
  };
  return journals[journalCode] ?? "Royal Society Publishing";
}

function parseIssuePath(url: string) {
  try {
    const parsed = new URL(url);
    const [, journalCode = "", issueMarker = "", volume = "", issue = ""] = parsed.pathname.split("/");
    return issueMarker === "issue" ? { journalCode, volume, issue } : { journalCode, volume: "", issue: "" };
  } catch {
    return { journalCode: "", volume: "", issue: "" };
  }
}

function articleTitleNearHref(html: string, href: string) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anchor = html.match(new RegExp(`<a\\s+[^>]*href=["']${escapedHref}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"))?.[1];
  return anchor ? stripTags(anchor) : "";
}

function parseRoyalSocietyArticles(html: string, issueUrl: string, issue: Omit<JournalArchiveIssue, "articles">) {
  const articlesByDoi = new Map<string, JournalArchiveArticle>();
  const hrefPattern = /href=["']([^"']*\/doi\/(?:abs\/|full\/|pdf\/)?(10\.[^"'?#\s<>]+))["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html))) {
    const href = match[1];
    const doi = decodeURIComponent(match[2]);
    if (!doi.startsWith("10.")) continue;
    const sourceUrl = absoluteUrl(issueUrl, href.replace(/\/doi\/pdf\//, "/doi/abs/").replace(/\/doi\/full\//, "/doi/abs/"));
    if (!sourceUrl || articlesByDoi.has(doi)) continue;
    const pdfUrl = absoluteUrl(issueUrl, href.includes("/doi/pdf/") ? href : href.replace(/\/doi\/(?:abs\/|full\/)?/, "/doi/pdf/"));
    const title = articleTitleNearHref(html, href) || `Royal Society article ${doi}`;

    articlesByDoi.set(doi, {
      id: `royal-society-${stableArchiveId(doi)}`,
      provider: "royal-society",
      journalName: issue.journalName,
      issueTitle: issue.issueTitle,
      issueUrl,
      articleId: doi,
      title,
      authors: [],
      year: issue.year,
      month: issue.month,
      publishedAt: issue.year,
      volume: issue.volume,
      issue: issue.issue,
      sourceUrl,
      pdfUrl,
    });
  }

  return Array.from(articlesByDoi.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export async function importRoyalSocietyIssue(issueUrl: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(issueUrl.trim());
  } catch {
    throw new Error("Enter a valid Royal Society issue URL.");
  }

  if (!parsedUrl.hostname.includes("royalsocietypublishing.org")) {
    throw new Error("This importer currently supports Royal Society Publishing issue URLs.");
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`Royal Society issue request failed: ${response.status}`);
  }

  const html = await response.text();
  const pathParts = parseIssuePath(parsedUrl.toString());
  const publishedAt = readMeta(html, "citation_publication_date") || readMeta(html, "dc.Date") || readHtmlTitle(html);
  const journalName = readMeta(html, "citation_journal_title") || royalSocietyJournalName(pathParts.journalCode);
  const issueTitle = readHtmlTitle(html) || `${journalName} Volume ${pathParts.volume} Issue ${pathParts.issue}`;
  const issueBase: Omit<JournalArchiveIssue, "articles"> = {
    id: `royal-society-${stableArchiveId(parsedUrl.pathname)}`,
    provider: "royal-society",
    publisherName: "Royal Society Publishing",
    journalName,
    issueTitle,
    issueUrl: parsedUrl.toString(),
    year: yearFromDate(publishedAt),
    month: monthFromDate(publishedAt),
    volume: pathParts.volume || undefined,
    issue: pathParts.issue || undefined,
    importedAt: new Date().toISOString(),
  };
  const articles = parseRoyalSocietyArticles(html, parsedUrl.toString(), issueBase);
  if (!articles.length) {
    throw new Error("No article DOI links were found on this issue page. Open the issue in Archive browse and import individual article URLs.");
  }

  return saveJournalArchiveIssue({ ...issueBase, articles });
}
