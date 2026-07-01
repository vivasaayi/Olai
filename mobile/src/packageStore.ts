import * as FileSystem from "expo-file-system";
import type {
  InstalledPackage,
  PortableBookPackageManifest,
  PortablePackageFileManifest,
  PortableBookPage,
  PortableGlossaryTerm,
  PortablePageTranslationRow,
} from "./packageTypes";

const maxPackageBytes = 750 * 1024 * 1024;
const maxFileCount = 6000;
const maxManifestFiles = 6000;
const maxSingleFileBytes = 250 * 1024 * 1024;
const maxJsonFileBytes = 25 * 1024 * 1024;
const maxPages = 5000;
const maxLanguages = 32;
const maxTranslations = 100000;
const allowedTopLevelPaths = ["manifest.json", "content/", "assets/", "source/"];
const allowedExtensions = [".json", ".png", ".jpg", ".jpeg", ".pdf"];
const allowedMimeTypes = ["application/json", "image/png", "image/jpeg", "application/pdf"];

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readUint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function concatBytes(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function sha256HexBytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isSafePackagePath(path: string) {
  if (!path || path.length > 240) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:/.test(path)) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return false;
  if (!allowedTopLevelPaths.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  return allowedExtensions.some((extension) => path.toLowerCase().endsWith(extension));
}

function validateManifestPathEntry(entry: PortablePackageFileManifest) {
  if (!isSafePackagePath(entry.path)) {
    throw new Error(`Unsafe package path in manifest: ${entry.path}`);
  }
  if (!allowedMimeTypes.includes(entry.mimeType)) {
    throw new Error(`Unsupported MIME type for ${entry.path}: ${entry.mimeType}`);
  }
  if (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes < 0 || entry.sizeBytes > maxSingleFileBytes) {
    throw new Error(`Invalid file size for ${entry.path}.`);
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(`Invalid SHA-256 value for ${entry.path}.`);
  }
  if (entry.path.endsWith(".json") && entry.sizeBytes > maxJsonFileBytes) {
    throw new Error(`JSON file is too large: ${entry.path}.`);
  }
}

function assertStringField(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Package manifest is missing ${name}.`);
  }
}

function packageDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error("Device document storage is unavailable.");
  }
  return `${FileSystem.documentDirectory}published-packages/`;
}

function packagePath(packageId: string) {
  const safeId = packageId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return `${packageDirectory()}${safeId}.json`;
}

async function ensurePackageDirectory() {
  const directory = packageDirectory();
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

function parseZipPackage(bytes: Uint8Array) {
  if (bytes.length > maxPackageBytes) {
    throw new Error(`Package is too large. Limit is ${Math.round(maxPackageBytes / 1024 / 1024)} MB.`);
  }

  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = readUint32(bytes, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error("Unsupported package: local ZIP header not found.");
    }

    const flags = readUint16(bytes, offset + 6);
    const compression = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const fileNameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > bytes.length) throw new Error("Unsupported package: truncated ZIP entry.");
    if (flags & 0x0008) throw new Error("Unsupported package: streaming ZIP entries are not supported yet.");
    if (compression !== 0) throw new Error("Unsupported package: compressed ZIP entries are not supported yet.");
    if (compressedSize > maxSingleFileBytes) throw new Error("Package contains a file that is too large.");

    const path = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));
    if (!isSafePackagePath(path)) throw new Error(`Unsafe package path: ${path}`);
    if (files.has(path)) throw new Error(`Duplicate package path: ${path}`);
    files.set(path, bytes.slice(dataStart, dataEnd));
    if (files.size > maxFileCount) throw new Error(`Package contains too many files. Limit is ${maxFileCount}.`);
    offset = dataEnd;
  }

  if (!files.has("manifest.json")) throw new Error("manifest.json is missing from the package.");
  return files;
}

function parseJsonFile<T>(files: Map<string, Uint8Array>, path: string): T {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`${path} is missing from the package.`);
  if (bytes.length > maxJsonFileBytes) throw new Error(`${path} is too large.`);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function validateManifestShape(manifest: PortableBookPackageManifest) {
  if (manifest.schemaVersion !== "1.0.0") {
    throw new Error(`Unsupported package schema: ${manifest.schemaVersion}`);
  }
  if (manifest.packageType !== "portable-translation-book") {
    throw new Error(`Unsupported package type: ${manifest.packageType}`);
  }

  assertStringField(manifest.packageId, "packageId");
  assertStringField(manifest.bookId, "bookId");
  assertStringField(manifest.version, "version");
  assertStringField(manifest.defaultLanguage, "defaultLanguage");
  if (!Number.isFinite(manifest.revision) || manifest.revision < 1) {
    throw new Error("Package manifest has an invalid revision.");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error("Package manifest must list files.");
  }
  if (manifest.files.length > maxManifestFiles) {
    throw new Error(`Package manifest lists too many files. Limit is ${maxManifestFiles}.`);
  }
  if (!manifest.book || typeof manifest.book !== "object") {
    throw new Error("Package manifest is missing book metadata.");
  }
  assertStringField(manifest.book.title, "book.title");
  assertStringField(manifest.book.slug, "book.slug");
  if (!Array.isArray(manifest.book.languages) || !manifest.book.languages.length || manifest.book.languages.length > maxLanguages) {
    throw new Error("Package manifest has an invalid language list.");
  }
  if (!manifest.book.languages.includes(manifest.defaultLanguage)) {
    throw new Error("Package default language is not present in book.languages.");
  }

  const seen = new Set<string>();
  for (const entry of manifest.files) {
    validateManifestPathEntry(entry);
    if (seen.has(entry.path)) throw new Error(`Duplicate file listed in manifest: ${entry.path}`);
    seen.add(entry.path);
  }
}

async function validateManifestFiles(manifest: PortableBookPackageManifest, files: Map<string, Uint8Array>) {
  validateManifestShape(manifest);

  const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
  const unexpected = Array.from(files.keys()).filter((path) => path !== "manifest.json" && !manifestPaths.has(path));
  if (unexpected.length) {
    throw new Error(`Package contains file not listed in manifest: ${unexpected[0]}.`);
  }

  const missing = manifest.files.filter((entry) => !files.has(entry.path));
  if (missing.length) {
    throw new Error(`Package is missing ${missing.length} manifest file(s), including ${missing[0].path}.`);
  }

  for (const entry of manifest.files) {
    const bytes = files.get(entry.path);
    if (!bytes) throw new Error(`${entry.path} is missing.`);
    if (bytes.length !== entry.sizeBytes) {
      throw new Error(`Size mismatch for ${entry.path}.`);
    }
    const actualHash = `sha256:${await sha256HexBytes(bytes)}`;
    if (actualHash.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new Error(`Hash mismatch for ${entry.path}.`);
    }
  }
}

async function validateContentHash(manifest: PortableBookPackageManifest, files: Map<string, Uint8Array>) {
  if (!manifest.contentHash) return;
  if (!/^sha256:[a-f0-9]{64}$/i.test(manifest.contentHash)) {
    throw new Error("Package manifest has an invalid contentHash.");
  }

  const contentFiles = [
    "content/book.json",
    "content/pages.json",
    "content/glossary.json",
    ...manifest.book.languages.map((language) => `content/translations.${language}.json`).filter((path) => files.has(path)),
  ];
  const contentHashInput = concatBytes(contentFiles.flatMap((path) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`${path} is missing from content hash inputs.`);
    return [new TextEncoder().encode(`${path}\n`), bytes];
  }));
  const actualHash = `sha256:${await sha256HexBytes(contentHashInput)}`;
  if (actualHash.toLowerCase() !== manifest.contentHash.toLowerCase()) {
    throw new Error("Package contentHash does not match readable content.");
  }
}

function normalizeTranslationRows(value: unknown): PortablePageTranslationRow[] {
  const rows = Array.isArray(value)
    ? value
      .map((entry) => {
        const raw = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
        const pageNumber = typeof raw.pageNumber === "number" ? raw.pageNumber : 0;
        const translations = Array.isArray(raw.translations) ? raw.translations : [];
        return pageNumber > 0 ? { pageNumber, translations: translations as PortablePageTranslationRow["translations"] } : null;
      })
      .filter((entry): entry is PortablePageTranslationRow => Boolean(entry))
    : [];
  const translationCount = rows.reduce((total, row) => total + row.translations.length, 0);
  if (translationCount > maxTranslations) {
    throw new Error(`Package contains too many translation records. Limit is ${maxTranslations}.`);
  }
  return rows;
}

function buildInstalledPackage(
  manifest: PortableBookPackageManifest,
  files: Map<string, Uint8Array>,
  localPath: string,
): InstalledPackage {
  const pages = parseJsonFile<PortableBookPage[]>(files, "content/pages.json");
  if (!Array.isArray(pages) || !pages.length) {
    throw new Error("Package must include at least one readable page.");
  }
  if (pages.length > maxPages) {
    throw new Error(`Package has too many pages. Limit is ${maxPages}.`);
  }
  const glossary = parseJsonFile<PortableGlossaryTerm[]>(files, "content/glossary.json");
  if (!Array.isArray(glossary)) {
    throw new Error("Package glossary must be an array.");
  }
  const translations: Record<string, PortablePageTranslationRow[]> = {};
  let totalTranslations = 0;

  for (const language of manifest.book.languages) {
    if (!/^[a-z]{2,8}(-[a-z0-9]{2,8})?$/i.test(language)) {
      throw new Error(`Invalid language code: ${language}`);
    }
    const path = `content/translations.${language}.json`;
    if (!files.has(path)) continue;
    translations[language] = normalizeTranslationRows(parseJsonFile<unknown>(files, path));
    totalTranslations += translations[language].reduce((total, row) => total + row.translations.length, 0);
    if (totalTranslations > maxTranslations) {
      throw new Error(`Package contains too many translation records. Limit is ${maxTranslations}.`);
    }
  }

  if (!Object.keys(translations).length) {
    throw new Error("Package does not include any translation files.");
  }

  const now = new Date().toISOString();
  return {
    packageId: manifest.packageId,
    bookId: manifest.bookId,
    title: manifest.book.title,
    author: manifest.book.author,
    version: manifest.version,
    revision: manifest.revision,
    defaultLanguage: manifest.defaultLanguage,
    languages: Object.keys(translations).length ? Object.keys(translations).sort() : manifest.book.languages,
    localPath,
    manifest,
    pages,
    translations,
    glossary,
    installedAt: now,
    updatedAt: now,
  };
}

export async function installPackageFromBytes(bytes: Uint8Array) {
  const files = parseZipPackage(bytes);
  const manifest = parseJsonFile<PortableBookPackageManifest>(files, "manifest.json");
  await validateManifestFiles(manifest, files);
  await validateContentHash(manifest, files);
  await ensurePackageDirectory();
  const path = packagePath(manifest.packageId);
  const installed = buildInstalledPackage(manifest, files, path);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(installed, null, 2));
  return installed;
}

export async function installPackageFromUrl(url: string) {
  const cleanUrl = url.trim();
  if (!cleanUrl) throw new Error("Enter a package URL.");
  const response = await fetch(cleanUrl);
  if (!response.ok) {
    throw new Error(`Package download failed: ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxPackageBytes) {
    throw new Error(`Package is too large. Limit is ${Math.round(maxPackageBytes / 1024 / 1024)} MB.`);
  }
  return installPackageFromBytes(new Uint8Array(await response.arrayBuffer()));
}

export async function loadInstalledPackages() {
  const directory = await ensurePackageDirectory();
  const entries = await FileSystem.readDirectoryAsync(directory);
  const packages: InstalledPackage[] = [];

  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      const raw = JSON.parse(await FileSystem.readAsStringAsync(`${directory}${entry}`)) as InstalledPackage;
      packages.push({
        ...raw,
        title: asString(raw.title, raw.manifest?.book?.title ?? "Published book"),
        languages: Array.isArray(raw.languages) ? raw.languages : [],
      });
    } catch {
      // Ignore malformed local package records.
    }
  }

  return packages.sort((left, right) => left.title.localeCompare(right.title));
}

export async function deleteInstalledPackage(packageId: string) {
  const path = packagePath(packageId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path);
  }
}
