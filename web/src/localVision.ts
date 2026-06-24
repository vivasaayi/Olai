import type { TranslationComplexity, TranslationLanguage } from './oldBooksStore'

type VisionTranslationRequest = {
  endpoint: string
  model: string
  imageDataUrl: string
  bookTitle: string
  pageNumber: number
  complexityLabel: string
  languageLabel: string
  complexity: TranslationComplexity
  language: TranslationLanguage
}

type VisionAnswerRequest = {
  endpoint: string
  model: string
  imageDataUrl: string
  bookTitle: string
  pageNumber: number
  sectionTitle: string
  question: string
  complexityLabel: string
  languageLabel: string
  translatedParagraphs: string[]
}

export type VisionTranslationResult = {
  sectionTitle: string
  sourceLines: string[]
  paragraphs: string[]
  ocrConfidence?: number
}

export type VisionAnswerResult = {
  answer: string
  citedSourceLines: string[]
}

export type LocalVisionModel = {
  id: string
  ownedBy?: string
}

function completionsUrl(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const clientEndpoint = trimmed.replace('://0.0.0.0', '://localhost')
  if (clientEndpoint.endsWith('/chat/completions')) return clientEndpoint
  if (clientEndpoint.endsWith('/v1')) return `${clientEndpoint}/chat/completions`
  return `${clientEndpoint}/v1/chat/completions`
}

function modelsUrl(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const clientEndpoint = trimmed.replace('://0.0.0.0', '://localhost')
  if (clientEndpoint.endsWith('/chat/completions')) {
    return clientEndpoint.replace(/\/chat\/completions$/, '/models')
  }
  if (clientEndpoint.endsWith('/v1')) return `${clientEndpoint}/models`
  return `${clientEndpoint}/v1/models`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function parseJsonish(text: string): unknown {
  const withoutFence = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1))
    }
    throw new Error('Response was not JSON.')
  }
}

function normalizeParagraphs(value: unknown, fallbackText: string) {
  const paragraphs = asStringArray(value)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length) return paragraphs
  return fallbackText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
}

function normalizeVisionTranslation(content: string, fallbackSectionTitle: string): VisionTranslationResult {
  try {
    const payload = asRecord(parseJsonish(content))
    const sectionTitle = typeof payload.sectionTitle === 'string' && payload.sectionTitle.trim()
      ? payload.sectionTitle.trim()
      : fallbackSectionTitle
    const textValue = typeof payload.translation === 'string'
      ? payload.translation
      : typeof payload.text === 'string'
        ? payload.text
        : content
    const ocrConfidence = typeof payload.ocrConfidence === 'number' ? payload.ocrConfidence : undefined

    return {
      sectionTitle,
      sourceLines: asStringArray(payload.sourceLines),
      paragraphs: normalizeParagraphs(payload.paragraphs, textValue),
      ocrConfidence,
    }
  } catch {
    return {
      sectionTitle: fallbackSectionTitle,
      sourceLines: [],
      paragraphs: normalizeParagraphs([], content),
    }
  }
}

function normalizeVisionAnswer(content: string): VisionAnswerResult {
  try {
    const payload = asRecord(parseJsonish(content))
    const answer = typeof payload.answer === 'string' && payload.answer.trim()
      ? payload.answer.trim()
      : content.trim()
    return {
      answer,
      citedSourceLines: asStringArray(payload.citedSourceLines),
    }
  } catch {
    return {
      answer: content.trim(),
      citedSourceLines: [],
    }
  }
}

async function sendVisionChat(endpoint: string, body: unknown) {
  const url = completionsUrl(endpoint)
  if (!url) throw new Error('Enter a local LLM endpoint.')

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(
      `Could not reach the local LLM at ${url}. Make sure LM Studio Server is running on port 1234 and set Vision endpoint to /api/local-llm/v1.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(`Local LLM request failed: ${response.status} ${await response.text()}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Local LLM response did not include choices[0].message.content.')
  }
  return content
}

export async function listVisionModels(endpoint: string): Promise<LocalVisionModel[]> {
  const url = modelsUrl(endpoint)
  if (!url) throw new Error('Enter a local LLM endpoint.')

  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(
      `Could not load local models from ${url}. Make sure LM Studio Server is running on port 1234.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(`Local model list failed: ${response.status} ${await response.text()}`)
  }

  const payload = asRecord(await response.json())
  const data = Array.isArray(payload.data) ? payload.data : []
  return data
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      ownedBy: typeof entry.owned_by === 'string' ? entry.owned_by : undefined,
    }))
    .filter((entry) => entry.id)
}

export async function requestVisionTranslation({
  endpoint,
  model,
  imageDataUrl,
  bookTitle,
  pageNumber,
  complexityLabel,
  languageLabel,
  complexity,
  language,
}: VisionTranslationRequest): Promise<VisionTranslationResult> {
  const fallbackSectionTitle = `Page ${pageNumber}`
  const content = await sendVisionChat(endpoint, {
    model: model.trim() || 'default',
    messages: [
      {
        role: 'system',
        content: [
          'You are a careful translator of public-domain historical book page images.',
          'First OCR the visible source text. Then translate meaning into natural, readable language for the requested audience.',
          'Do not preserve broken OCR word order. Do not summarize unless the text is unreadable. Return compact JSON only. Do not include markdown.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Book: ${bookTitle}`,
              `Page: ${pageNumber}`,
              `Task: OCR the visible page text, identify the current section, and translate it into fluent ${complexityLabel} ${languageLabel}.`,
              `Complexity key: ${complexity}. Language key: ${language}.`,
              'Respect damaged, archaic, or unclear text. Mark uncertain OCR with [?] instead of inventing missing words.',
              'For the translation, preserve the author’s meaning but rewrite into natural modern sentences for the chosen complexity.',
              'If the requested language is English, produce polished English rather than a word-by-word gloss.',
              'Return JSON only with this shape: {"sectionTitle":"Short section title","sourceLines":["OCR line"],"paragraphs":["Translated paragraph"],"ocrConfidence":0.0}.',
            ].join('\n'),
          },
          {
            type: 'image_url',
            image_url: { url: imageDataUrl },
          },
        ],
      },
    ],
    temperature: 0.2,
  })

  return normalizeVisionTranslation(content, fallbackSectionTitle)
}

export async function requestVisionAnswer({
  endpoint,
  model,
  imageDataUrl,
  bookTitle,
  pageNumber,
  sectionTitle,
  question,
  complexityLabel,
  languageLabel,
  translatedParagraphs,
}: VisionAnswerRequest): Promise<VisionAnswerResult> {
  const content = await sendVisionChat(endpoint, {
    model: model.trim() || 'default',
    messages: [
      {
        role: 'system',
        content: 'You answer questions about public-domain historical book page images. Return compact JSON only. Do not include markdown.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Book: ${bookTitle}`,
              `Page: ${pageNumber}`,
              `Section: ${sectionTitle}`,
              `Question: ${question}`,
              `Answer in ${complexityLabel} ${languageLabel}.`,
              translatedParagraphs.length ? `Stored translation:\n${translatedParagraphs.join('\n\n')}` : '',
              'Use the image as the source of truth. If the page does not contain enough evidence, say that clearly.',
              'Return JSON only with this shape: {"answer":"Answer text","citedSourceLines":["OCR/source line used"]}.',
            ].filter(Boolean).join('\n'),
          },
          {
            type: 'image_url',
            image_url: { url: imageDataUrl },
          },
        ],
      },
    ],
    temperature: 0.2,
  })

  return normalizeVisionAnswer(content)
}
