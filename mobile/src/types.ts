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

export interface BookSource {
  type: "bookforge" | "arxiv" | "open-web" | "pdf";
  id?: string;
  url?: string;
  pdfUrl?: string;
  authors?: string[];
  publishedAt?: string;
  journal?: string;
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
}
