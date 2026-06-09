export type ResourceType = "image" | "video" | "link" | "prompt" | "download" | "pdf";

export interface Resource {
  id: string;
  type: ResourceType;
  label: string;
  value: string;
  description?: string;
}

export type SectionPersona = "default" | "kids" | "beginner" | "formal" | "college";

export interface Section {
  id: string;
  title: string;
  intent: string;
  summary: string;
  content: string;
  keywords: string[];
  persona: SectionPersona;
  durationMinutes?: number;
  resources: Resource[];
}

export interface Chapter {
  id: string;
  title: string;
  synopsis: string;
  goals: string;
  sections: Section[];
}

export type AiNoteKind = "paper" | "concept" | "section" | "summary" | "method" | "critique" | "question";

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
  tags: string[];
}

export interface BookSource {
  type: "bookforge" | "arxiv" | "open-web" | "pdf";
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
  offlineStatus?: string[];
}

export interface Book {
  id: string;
  title: string;
  synopsis: string;
  audience: string;
  tone: string;
  tags: string[];
  chapters: Chapter[];
  source?: BookSource;
  aiNotes?: AiNote[];
}
