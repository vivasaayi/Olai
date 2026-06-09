import * as FileSystem from "expo-file-system";
import type { Book } from "./types";

const maxStoredTextLength = 1_000_000;
const defaultAssistTextLimit = 48_000;

type HtmlSnapshotInput = {
  bookId: string;
  title: string;
  url: string;
  html: string;
  textFallback?: string;
};

function assertDocumentDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error("Device document storage is unavailable.");
  }
  return FileSystem.documentDirectory;
}

function safePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function paperDirectory(bookId: string) {
  return `${assertDocumentDirectory()}papers/${safePathPart(bookId)}/`;
}

async function ensurePaperDirectory(bookId: string) {
  const directory = paperDirectory(bookId);
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlToReadableText(html: string) {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<math[\s\S]*?<\/math>/gi, " ");

  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|table|tr|ul|ol|li|h[1-6])>/gi, "\n")
    .replace(/<(li|h[1-6])[^>]*>/gi, "\n");

  return decodeEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxStoredTextLength);
}

function buildReadableHtml(title: string, sourceUrl: string, text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.58; margin: 24px; color: #1f2933; background: #fff8e8; }",
    "h1 { font-size: 24px; line-height: 1.2; margin-bottom: 8px; }",
    ".source { color: #6b7280; font-size: 13px; margin-bottom: 24px; word-break: break-word; }",
    "p { margin: 0 0 18px; }",
    "</style>",
    "</head>",
    "<body>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<div class=\"source\">Source: ${escapeHtml(sourceUrl)}</div>`,
    paragraphs || "<p>No readable text was extracted from this source.</p>",
    "</body>",
    "</html>",
  ].join("\n");
}

export async function downloadPdfAsset(bookId: string, pdfUrl: string) {
  const directory = await ensurePaperDirectory(bookId);
  const localPdfPath = `${directory}paper.pdf`;
  const result = await FileSystem.downloadAsync(pdfUrl, localPdfPath);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`PDF download failed: ${result.status}`);
  }
  return result.uri;
}

export async function saveHtmlSnapshotAsset({
  bookId,
  title,
  url,
  html,
  textFallback = "",
}: HtmlSnapshotInput) {
  const directory = await ensurePaperDirectory(bookId);
  const extractedText = htmlToReadableText(html) || textFallback.trim();
  const localTextPath = `${directory}paper.txt`;
  const localHtmlPath = `${directory}paper.html`;

  await FileSystem.writeAsStringAsync(localTextPath, extractedText);
  await FileSystem.writeAsStringAsync(localHtmlPath, buildReadableHtml(title, url, extractedText));

  return {
    extractedText,
    localHtmlPath,
    localTextPath,
  };
}

export async function saveTextSnapshotAsset({
  bookId,
  title,
  url,
  text,
}: {
  bookId: string;
  title: string;
  url: string;
  text: string;
}) {
  return saveHtmlSnapshotAsset({
    bookId,
    title,
    url,
    html: `<main>${escapeHtml(text)}</main>`,
    textFallback: text,
  });
}

export async function readBookSourceText(book: Book, limit = defaultAssistTextLimit) {
  const path = book.source?.localTextPath;
  if (!path) return "";

  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return "";

  const text = await FileSystem.readAsStringAsync(path);
  return text.trim().slice(0, limit);
}

export async function deletePaperAssets(bookId: string) {
  const directory = paperDirectory(bookId);
  const info = await FileSystem.getInfoAsync(directory);
  if (info.exists) {
    await FileSystem.deleteAsync(directory, { idempotent: true });
  }
}
