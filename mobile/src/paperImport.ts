import type { Book, Resource } from "./types";

type HtmlMeta = Record<string, string>;

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readXmlTag(source: string, tag: string) {
  const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function readXmlTags(source: string, tag: string) {
  const matches = source.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"));
  return Array.from(matches, (match) => decodeEntities(match[1])).filter(Boolean);
}

function stripVersion(id: string) {
  return id.replace(/v\d+$/i, "");
}

export function extractArxivId(input: string) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/arxiv\.org\/(?:abs|pdf|html)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (urlMatch) return urlMatch[1];

  const directMatch = trimmed.match(/^(?:arxiv:)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)$/i);
  return directMatch ? directMatch[1] : undefined;
}

function readArxivPdfUrl(entryXml: string, id: string) {
  const pdfLink = entryXml.match(/<link[^>]+title=["']pdf["'][^>]+href=["']([^"']+)["']/i);
  return pdfLink ? decodeEntities(pdfLink[1]) : `https://arxiv.org/pdf/${stripVersion(id)}`;
}

function resource(id: string, label: string, value: string, type: Resource["type"] = "link"): Resource {
  return { id, label, value, type };
}

async function importArxivPaper(id: string): Promise<Book> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error(`arXiv request failed: ${response.status}`);
  }

  const xml = await response.text();
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entryMatch) {
    throw new Error("No arXiv paper found for that ID.");
  }

  const entryXml = entryMatch[1];
  const cleanId = stripVersion(id);
  const title = readXmlTag(entryXml, "title") || `arXiv ${id}`;
  const abstract = readXmlTag(entryXml, "summary");
  const authors = readXmlTags(entryXml, "name");
  const publishedAt = readXmlTag(entryXml, "published");
  const categories = Array.from(entryXml.matchAll(/<category[^>]+term=["']([^"']+)["']/gi), (match) => decodeEntities(match[1]));
  const sourceUrl = `https://arxiv.org/abs/${cleanId}`;
  const pdfUrl = readArxivPdfUrl(entryXml, cleanId);

  return {
    id: `arxiv-${cleanId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
    title,
    synopsis: abstract,
    audience: "Research reader",
    tone: "Academic",
    tags: ["arXiv", ...categories.slice(0, 4)],
    source: {
      type: "arxiv",
      id: cleanId,
      url: sourceUrl,
      pdfUrl,
      authors,
      publishedAt,
    },
    chapters: [
      {
        id: `arxiv-${cleanId}-overview`,
        title: "Paper Overview",
        synopsis: abstract,
        goals: "Capture the paper metadata and reading plan.",
        sections: [
          {
            id: `arxiv-${cleanId}-abstract`,
            title: "Abstract",
            intent: "Read the official abstract before opening the full paper.",
            summary: abstract,
            content: abstract,
            keywords: categories.slice(0, 4),
            persona: "college",
            durationMinutes: Math.max(3, Math.round(abstract.split(/\s+/).length / 160)),
            resources: [
              resource("source", "arXiv Page", sourceUrl),
              resource("pdf", "Original PDF", pdfUrl, "pdf"),
            ],
          },
          {
            id: `arxiv-${cleanId}-reading-route`,
            title: "Reading Route",
            intent: "Convert a dense paper into a practical reading checklist.",
            summary: "Use this checklist while reading the original PDF.",
            content:
              `Authors: ${authors.join(", ") || "Unknown"}\n\n` +
              `Published: ${publishedAt ? publishedAt.slice(0, 10) : "Unknown"}\n\n` +
              "Suggested path:\n\n1. Read the abstract and introduction for the claim.\n\n2. Skim figures, tables, and experiments before reading every proof or implementation detail.\n\n3. Ask the assistant for the paper's assumptions, key contribution, method, evidence, and limitations.\n\n4. Save your own notes as follow-up sections later.",
            keywords: ["reading plan", "method", "limitations"],
            persona: "college",
            durationMinutes: 5,
            resources: [
              resource("source", "arXiv Page", sourceUrl),
              resource("pdf", "Original PDF", pdfUrl, "pdf"),
            ],
          },
        ],
      },
    ],
  };
}

function readHtmlMeta(html: string): HtmlMeta {
  const meta: HtmlMeta = {};
  const matches = html.matchAll(/<meta\s+([^>]+)>/gi);
  for (const match of matches) {
    const attrs = match[1];
    const key = attrs.match(/(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const value = attrs.match(/content=["']([^"']+)["']/i)?.[1];
    if (key && value) {
      meta[key] = decodeEntities(value);
    }
  }
  return meta;
}

function readHtmlTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeEntities(title.replace(/<[^>]+>/g, " ")) : "";
}

async function importOpenJournalPage(url: string): Promise<Book> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter an arXiv ID or a full http(s) paper URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http(s) paper URLs are supported.");
  }

  const response = await fetch(parsedUrl.toString());
  if (!response.ok) {
    throw new Error(`Paper page request failed: ${response.status}`);
  }

  const html = await response.text();
  const meta = readHtmlMeta(html);
  const title =
    meta["citation_title"] ||
    meta["dc.title"] ||
    meta["og:title"] ||
    readHtmlTitle(html) ||
    parsedUrl.hostname;
  const abstract =
    meta["citation_abstract"] ||
    meta["dc.description"] ||
    meta["description"] ||
    meta["og:description"] ||
    "Imported paper page. Open the source and use the assistant while reading.";
  const pdfUrl = meta["citation_pdf_url"];
  const journal = meta["citation_journal_title"] || meta["dc.publisher"];
  const authors = Object.keys(meta)
    .filter((key) => key === "citation_author")
    .map((key) => meta[key])
    .filter(Boolean);

  const safeId = parsedUrl.hostname.replace(/[^a-zA-Z0-9_.-]/g, "-") + "-" + Math.abs(parsedUrl.toString().split("").reduce((sum, char) => sum + char.charCodeAt(0), 0));
  return {
    id: `paper-${safeId}`,
    title,
    synopsis: abstract,
    audience: "Research reader",
    tone: "Academic",
    tags: [journal || parsedUrl.hostname, "Open Journal"].filter(Boolean),
    source: {
      type: pdfUrl ? "pdf" : "open-web",
      url: parsedUrl.toString(),
      pdfUrl,
      authors,
      journal,
    },
    chapters: [
      {
        id: `paper-${safeId}-overview`,
        title: "Paper Overview",
        synopsis: abstract,
        goals: "Import open-journal metadata and keep the source attached.",
        sections: [
          {
            id: `paper-${safeId}-abstract`,
            title: "Abstract and Source",
            intent: "Read the available metadata and open the original source in-app.",
            summary: abstract,
            content:
              `${abstract}\n\n` +
              `Source: ${parsedUrl.toString()}\n\n` +
              "Some journal sites expose only metadata to mobile import. Open the source inside the app and use the assistant for summaries, questions, and explanations while reading.",
            keywords: [journal || parsedUrl.hostname, "paper"],
            persona: "college",
            durationMinutes: 4,
            resources: [
              resource("source", "Original Source", parsedUrl.toString()),
              ...(pdfUrl ? [resource("pdf", "Original PDF", pdfUrl, "pdf")] : []),
            ],
          },
        ],
      },
    ],
  };
}

export async function importPaperFromInput(input: string) {
  const arxivId = extractArxivId(input);
  return arxivId ? importArxivPaper(arxivId) : importOpenJournalPage(input.trim());
}
