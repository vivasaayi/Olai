export type TranslationComplexity = "original" | "kid-friendly" | "concept-guide" | "simplified" | "high-school" | "college";

export interface PortablePackageFileManifest {
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PortablePublisherMetadata {
  name?: string;
}

export interface PortablePackageVolume {
  index: number;
  total: number;
  pageStart: number;
  pageEnd: number;
}

export interface PortableBookAsset {
  id: string;
  kind: "cover" | "page-snapshot" | "pdf";
  pageNumber?: number;
  fileName: string;
  mimeType: string;
  path?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface PortableBookMetadata {
  slug: string;
  title: string;
  subtitle?: string;
  author?: string;
  originalLanguage?: string;
  dateLabel?: string;
  description?: string;
  tags: string[];
  status: "draft" | "reviewed" | "published";
  pageCount: number;
  languages: string[];
  assets: PortableBookAsset[];
}

export interface PortableBookPage {
  pageNumber: number;
  sectionTitle?: string;
  sourceLines: string[];
  snapshotAssetId?: string;
}

export interface PortableGlossaryTerm {
  sourceTerm: string;
  translatedTerm: string;
  explanation?: string;
  englishTerm?: string;
  targetTerm?: string;
  transliteration?: string;
  language?: string;
  approved?: boolean;
}

export interface PortablePageTranslation {
  language: string;
  complexity: TranslationComplexity;
  title?: string;
  paragraphs: string[];
  notes?: string[];
  glossary?: PortableGlossaryTerm[];
  model?: string;
  sourceModel?: string;
  createdAt: string;
}

export interface PortablePageTranslationRow {
  pageNumber: number;
  translations: PortablePageTranslation[];
}

export interface PortableBookPackageManifest {
  schemaVersion: "1.0.0";
  packageType: "portable-translation-book";
  packageId: string;
  bookId: string;
  version: string;
  revision: number;
  defaultLanguage: string;
  contentHash?: string;
  exportedAt: string;
  publisher?: PortablePublisherMetadata;
  changelog?: string;
  license?: string;
  rightsStatus?: string;
  sourceUrl?: string;
  volume?: PortablePackageVolume;
  source: {
    app: "book-reader";
    appBookId: string;
  };
  files: PortablePackageFileManifest[];
  book: PortableBookMetadata;
}

export interface InstalledPackage {
  packageId: string;
  bookId: string;
  title: string;
  author?: string;
  version: string;
  revision: number;
  defaultLanguage: string;
  languages: string[];
  localPath: string;
  manifest: PortableBookPackageManifest;
  pages: PortableBookPage[];
  translations: Record<string, PortablePageTranslationRow[]>;
  glossary: PortableGlossaryTerm[];
  installedAt: string;
  updatedAt: string;
}
