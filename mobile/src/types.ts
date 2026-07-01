export type ResourceType = "image" | "video" | "link" | "prompt" | "download" | "pdf";

export interface Resource {
  id: string;
  type: ResourceType;
  label: string;
  value: string;
  description?: string;
}

export type SectionPersona = "default" | "kids" | "beginner" | "formal" | "college";

export type OutlineNodeType = "chapter" | "section";
export type NodePersona = SectionPersona;

export interface OutlineNode {
  id: string;
  type: OutlineNodeType;
  title: string;
  intent: string;
  summary: string;
  content: string;
  keywords: string[];
  persona: SectionPersona;
  durationMinutes?: number;
  resources: Resource[];
  children: OutlineNode[];
}

export type Section = OutlineNode;
export type Chapter = OutlineNode;

export type AiNoteKind = "paper" | "concept" | "section" | "summary" | "method" | "critique" | "question";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiNote {
  id: string;
  kind: AiNoteKind;
  title: string;
  content: string;
  createdAt: string;
  sourceSectionId?: string;
  sourceSectionTitle?: string;
  question?: string;
  model?: string;
  tokenUsage?: TokenUsage;
  tags: string[];
}

export interface BookSource {
  type: "bookforge" | "arxiv" | "open-web" | "pdf" | "archive-article";
  id?: string;
  url?: string;
  htmlUrl?: string;
  pdfUrl?: string;
  localHtmlPath?: string;
  localPdfPath?: string;
  localTextPath?: string;
  authors?: string[];
  publishedAt?: string;
  journal?: string;
  issueVolume?: string;
  issueNumber?: string;
  articleId?: string;
  archiveProvider?: string;
  offlineStatus?: string[];
}

export interface Book {
  id: string;
  title: string;
  synopsis: string;
  audience: string;
  tone: string;
  tags: string[];
  outline: OutlineNode[];
  createdAt?: string;
  updatedAt?: string;
  source?: BookSource;
  aiNotes?: AiNote[];
}
