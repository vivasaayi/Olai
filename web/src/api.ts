import type { Book } from './types'

export function createId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256HexBytes(value: Uint8Array) {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(value))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  const result = await request<{ sha256: string }>('/api/digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(value),
  })
  return result.sha256
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    const text = await response.text()
    let message = text
    try { message = JSON.parse(text).error || text } catch { /* Preserve a non-JSON server error. */ }
    throw new ApiError(response.status, message || `Request failed (${response.status})`)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function putJson<T>(path: string, value: unknown) {
  return request<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
}

export function listAuthorBooks() {
  return request<Book[]>('/api/books')
}

export function saveAuthorBook(book: Book) {
  return putJson<Book>(`/api/books/${encodeURIComponent(book.id)}`, book)
}

export function deleteAuthorBook(book: Book) {
  return request<void>(`/api/books/${encodeURIComponent(book.id)}`, {
    method: 'DELETE', headers: { 'If-Match': String(book._revision ?? 0) },
  })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function saveAsset(id: string, bookId: string, fileName: string, blob: Blob) {
  const asset = await putJson<{ url: string }>(`/api/assets/${encodeURIComponent(id)}`, {
    bookId, fileName, mimeType: blob.type || 'application/pdf', base64: await blobToBase64(blob),
  })
  return asset.url
}

export async function saveSnapshot(bookId: string, pageNumber: number, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob()
  // Each snapshot has immutable bytes so existing book revisions remain consistent during replacement.
  const id = createId()
  return saveAsset(id, bookId, `page-${pageNumber}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, blob)
}

export async function fileDataUrl(path: string) {
  if (!path.startsWith('/api/assets/')) throw new Error('Import desktop assets before opening them in the web app.')
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Could not load asset (${response.status})`)
  const blob = await response.blob()
  return `data:${blob.type};base64,${await blobToBase64(blob)}`
}

export function exportUrl(bookId: string, fileName?: string) {
  return `${location.origin}/api/exports/${encodeURIComponent(bookId)}${fileName ? `/${encodeURIComponent(fileName)}` : ''}`
}

export async function saveHtmlExport(bookId: string, fileName: string, html: string) {
  return request<{ url: string }>(exportUrl(bookId, fileName), {
    method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: html,
  })
}
