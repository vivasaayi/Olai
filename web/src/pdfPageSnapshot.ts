import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type RenderedPdfSnapshot = {
  imageDataUrl: string
  width: number
  height: number
  pageCount: number
  pageNumber: number
}

function pdfJsWasmUrl() {
  return new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`, window.location.href).toString()
}

export async function renderPdfPageSnapshot(
  pdfBlob: Blob,
  requestedPageNumber: number,
  options: { maxWidth?: number } = {},
): Promise<RenderedPdfSnapshot> {
  const maxWidth = options.maxWidth ?? 1400
  const data = await pdfBlob.arrayBuffer()
  const documentTask = getDocument({
    data,
    wasmUrl: pdfJsWasmUrl(),
  })

  try {
    const pdf = await documentTask.promise
    const pageCount = pdf.numPages
    const pageNumber = Math.min(Math.max(1, requestedPageNumber), pageCount)
    const snapshot = await renderPageFromDocument(pdf, pageNumber, pageCount, maxWidth)

    return {
      ...snapshot,
      pageCount,
    }
  } finally {
    await documentTask.destroy()
  }
}

export async function getPdfPageCount(pdfBlob: Blob) {
  const data = await pdfBlob.arrayBuffer()
  const documentTask = getDocument({
    data,
    wasmUrl: pdfJsWasmUrl(),
  })

  try {
    const pdf = await documentTask.promise
    return pdf.numPages
  } finally {
    await documentTask.destroy()
  }
}

async function renderPageFromDocument(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  pageCount: number,
  maxWidth: number,
): Promise<RenderedPdfSnapshot> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const scale = Math.min(2, maxWidth / viewport.width)
  const scaledViewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create a canvas context for PDF rendering.')
  }

  canvas.width = Math.floor(scaledViewport.width)
  canvas.height = Math.floor(scaledViewport.height)

  await page.render({
    canvas,
    canvasContext: context,
    viewport: scaledViewport,
  }).promise

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.88)
  page.cleanup()

  return {
    pageNumber,
    imageDataUrl,
    width: canvas.width,
    height: canvas.height,
    pageCount,
  }
}

export async function renderPdfPageSnapshots(
  pdfBlob: Blob,
  options: {
    maxWidth?: number
    pages?: number[]
    onProgress?: (pageNumber: number, pageCount: number, current: number, total: number) => Promise<void> | void
  } = {},
): Promise<RenderedPdfSnapshot[]> {
  const maxWidth = options.maxWidth ?? 1400
  const data = await pdfBlob.arrayBuffer()
  const documentTask = getDocument({
    data,
    wasmUrl: pdfJsWasmUrl(),
  })

  try {
    const pdf = await documentTask.promise
    const pageCount = pdf.numPages
    const snapshots: RenderedPdfSnapshot[] = []
    const pageNumbers = options.pages?.length
      ? options.pages.filter((pageNumber) => pageNumber >= 1 && pageNumber <= pageCount)
      : Array.from({ length: pageCount }, (_, index) => index + 1)

    for (const [index, pageNumber] of pageNumbers.entries()) {
      options.onProgress?.(pageNumber, pageCount, index + 1, pageNumbers.length)
      snapshots.push(await renderPageFromDocument(pdf, pageNumber, pageCount, maxWidth))
    }

    return snapshots
  } finally {
    await documentTask.destroy()
  }
}

export async function renderPdfPageSnapshotsStream(
  pdfBlob: Blob,
  options: {
    maxWidth?: number
    pages?: number[]
    onProgress?: (pageNumber: number, pageCount: number, current: number, total: number) => void
    onSnapshot: (snapshot: RenderedPdfSnapshot, current: number, total: number) => Promise<void> | void
  },
): Promise<{ pageCount: number, renderedCount: number }> {
  const maxWidth = options.maxWidth ?? 1400
  const data = await pdfBlob.arrayBuffer()
  const documentTask = getDocument({
    data,
    wasmUrl: pdfJsWasmUrl(),
  })

  try {
    const pdf = await documentTask.promise
    const pageCount = pdf.numPages
    const pageNumbers = options.pages?.length
      ? options.pages.filter((pageNumber) => pageNumber >= 1 && pageNumber <= pageCount)
      : Array.from({ length: pageCount }, (_, index) => index + 1)

    for (const [index, pageNumber] of pageNumbers.entries()) {
      const current = index + 1
      await options.onProgress?.(pageNumber, pageCount, current, pageNumbers.length)
      const snapshot = await renderPageFromDocument(pdf, pageNumber, pageCount, maxWidth)
      await options.onSnapshot(snapshot, current, pageNumbers.length)
    }

    return { pageCount, renderedCount: pageNumbers.length }
  } finally {
    await documentTask.destroy()
  }
}
