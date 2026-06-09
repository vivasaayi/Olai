export type ResourceType = 'image' | 'video' | 'link' | 'prompt' | 'download'

export interface Resource {
  id: string
  type: ResourceType
  label: string
  value: string
  description?: string
}

export interface Section {
  id: string
  title: string
  intent: string
  summary: string
  content: string
  keywords: string[]
  persona: 'default' | 'kids' | 'beginner' | 'formal' | 'college'
  durationMinutes?: number
  resources: Resource[]
}

export interface Chapter {
  id: string
  title: string
  synopsis: string
  goals: string
  sections: Section[]
}

export interface Book {
  id: string
  title: string
  synopsis: string
  audience: string
  tone: string
  tags: string[]
  chapters: Chapter[]
}

export interface ModelInfo {
  id: string
  name: string
  url: string
  description?: string
  size_mb?: number
}
