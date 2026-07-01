export type ResourceType = 'image' | 'video' | 'link' | 'prompt' | 'download' | 'pdf'

export interface Resource {
  id: string
  type: ResourceType
  label: string
  value: string
  description?: string
}

export type OutlineNodeType = 'chapter' | 'section'
export type NodePersona = 'default' | 'kids' | 'beginner' | 'formal' | 'college'

export interface OutlineNode {
  id: string
  type: OutlineNodeType
  title: string
  intent: string
  summary: string
  content: string
  keywords: string[]
  persona: NodePersona
  durationMinutes?: number
  resources: Resource[]
  children: OutlineNode[]
}

export interface Book {
  id: string
  title: string
  synopsis: string
  audience: string
  tone: string
  tags: string[]
  outline: OutlineNode[]
  createdAt?: string
  updatedAt?: string
}

export interface ModelInfo {
  id: string
  name: string
  url: string
  description?: string
  size_mb?: number
}
