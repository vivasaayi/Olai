import type { TranslationComplexity, TranslationGlossaryEntry, TranslationLanguage } from './oldBooksStore'

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
  previousOriginalParagraphs?: string[]
  previousSourceLines?: string[]
  priorGlossary?: TranslationGlossaryEntry[]
  signal?: AbortSignal
}

type TextTranslationRequest = {
  endpoint: string
  model: string
  bookTitle: string
  pageNumber: number
  complexityLabel: string
  languageLabel: string
  complexity: TranslationComplexity
  language: TranslationLanguage
  originalParagraphs: string[]
  sourceLines: string[]
  glossary?: TranslationGlossaryEntry[]
  previousOriginalParagraphs?: string[]
  previousTranslatedParagraphs?: string[]
  signal?: AbortSignal
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
  signal?: AbortSignal
}

type TranslationMemoryReviewRequest = {
  endpoint: string
  model: string
  bookTitle: string
  newTerms: TranslationGlossaryEntry[]
  existingTerms?: TranslationGlossaryEntry[]
  signal?: AbortSignal
}

export type VisionTranslationResult = {
  sectionTitle: string
  sourceLines: string[]
  paragraphs: string[]
  glossary?: TranslationGlossaryEntry[]
  notes?: string[]
  ocrConfidence?: number
}

export type VisionAnswerResult = {
  answer: string
  citedSourceLines: string[]
}

export type TranslationMemoryReviewResult = {
  glossary: TranslationGlossaryEntry[]
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

function normalizeGlossary(value: unknown): TranslationGlossaryEntry[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      sourceTerm: typeof entry.sourceTerm === 'string'
        ? entry.sourceTerm
        : typeof entry.term === 'string'
          ? entry.term
          : typeof entry.original === 'string'
            ? entry.original
            : '',
      translatedTerm: typeof entry.translatedTerm === 'string'
        ? entry.translatedTerm
        : typeof entry.translation === 'string'
          ? entry.translation
          : typeof entry.modernEquivalent === 'string'
            ? entry.modernEquivalent
            : '',
      explanation: typeof entry.explanation === 'string'
        ? entry.explanation
        : typeof entry.note === 'string'
          ? entry.note
          : '',
    }))
    .filter((entry) => entry.sourceTerm || entry.translatedTerm || entry.explanation)
}

function parseJsonish(text: string): unknown {
  const withoutFence = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(withoutFence)
    if (typeof parsed === 'string' && /^[\s`]*[{[]/.test(parsed)) {
      return parseJsonish(parsed)
    }
    return parsed
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(withoutFence.slice(start, end + 1))
      if (typeof parsed === 'string' && /^[\s`]*[{[]/.test(parsed)) {
        return parseJsonish(parsed)
      }
      return parsed
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
      glossary: normalizeGlossary(payload.glossary),
      notes: asStringArray(payload.notes),
      ocrConfidence,
    }
  } catch {
    return {
      sectionTitle: fallbackSectionTitle,
      sourceLines: [],
      paragraphs: normalizeParagraphs([], content),
      glossary: [],
      notes: [],
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

async function sendVisionChat(endpoint: string, body: unknown, signal?: AbortSignal) {
  const url = completionsUrl(endpoint)
  if (!url) throw new Error('Enter an LLM router endpoint.')

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Translation request was stopped.')
    }
    throw new Error(
      `Could not reach the LLM router at ${url}. Start the BookForge router on port 1235 and use the router endpoint.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(`LLM router request failed: ${response.status} ${await response.text()}`)
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
  if (!url) throw new Error('Enter an LLM router endpoint.')

  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(
      `Could not load models from ${url}. Start the BookForge router on port 1235 and use the router endpoint.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(`Model list failed: ${response.status} ${await response.text()}`)
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
  previousOriginalParagraphs,
  previousSourceLines,
  priorGlossary,
  signal,
}: VisionTranslationRequest): Promise<VisionTranslationResult> {
  const fallbackSectionTitle = `Page ${pageNumber}`
  const isOriginalPass = complexity === 'original'
  const content = await sendVisionChat(endpoint, {
    model: model.trim() || 'default',
    messages: [
      {
        role: 'system',
        content: isOriginalPass
          ? [
            'You are a historical scientific translator and academic editor specializing in older technical texts.',
            'First create a corrected source-language transcription from the page image. Then create a dense, source-faithful Original English pass.',
            'For German pages, sourceLines must be German OCR/transcription only. The English translation must appear only in paragraphs.',
            'Preserve sentence order, technical meaning, historical nuance, and continuity with the previous page.',
            'Fully translate source-language terms in the translation body. Keep original terms only in the glossary.',
            'Return a page-local glossary of important vocabulary and concepts. These entries explain this page to the reader; they are not global memory instructions.',
            'Break long nested sentences into clearer English only when needed, without dropping meaning.',
            'Return compact JSON only. Do not include markdown.',
          ].join(' ')
          : [
            'You are a careful translator of public-domain historical book page images.',
            'First OCR the visible source text. Then translate meaning into natural, readable language for the requested audience.',
            'Return a page-local glossary of important vocabulary and concepts. Tune explanations to the requested complexity and output language.',
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
              isOriginalPass
                ? 'Task: OCR the visible page text and produce the canonical Original English translation for this page.'
                : `Task: OCR the visible page text, identify the current section, and translate it into fluent ${complexityLabel} ${languageLabel}.`,
              `Complexity key: ${complexity}. Language key: ${language}.`,
              previousOriginalParagraphs?.length
                ? `Previous page Original English for continuity:\n${previousOriginalParagraphs.join('\n\n')}`
                : '',
              previousSourceLines?.length
                ? `Previous page source-language transcription for continuation:\n${previousSourceLines.join('\n')}`
                : '',
              priorGlossary?.length
                ? `Approved or previously used glossary terms. Use approved translations exactly where applicable:\n${priorGlossary.map((entry) => `${entry.sourceTerm} => ${entry.translatedTerm}: ${entry.explanation}`).join('\n')}`
                : '',
              'Respect damaged, archaic, or unclear text. Mark uncertain OCR with [?] instead of inventing missing words.',
              isOriginalPass
                ? 'Return sourceLines as corrected source-language transcription lines, not English. If the source is German, sourceLines must be German. Put the faithful English translation only in paragraphs. Extract important old terms, technical concepts, and recurring phrases into glossary. Use translated terms consistently with prior glossary.'
                : 'For the translation, preserve the author’s meaning but rewrite into natural modern sentences for the chosen complexity.',
              'Glossary requirements: include 5-12 page-local vocabulary entries when available. For Kid Friendly, explain terms simply. For Simplified English, use plain explanations. For High School, include key technical terms. For College, include precise historical or technical nuance. Put explanations in the requested output language where possible.',
              'Notes requirements: include short page-specific translator notes for ambiguity, historical context, OCR uncertainty, or important conceptual framing.',
              !isOriginalPass && language === 'en'
                ? 'If the requested language is English, produce polished English rather than a word-by-word gloss.'
                : '',
              'Return JSON only with this shape: {"sectionTitle":"Short section title","sourceLines":["OCR line"],"paragraphs":["Translated paragraph"],"glossary":[{"sourceTerm":"term or phrase from the page","translatedTerm":"reader-facing translation or label","explanation":"complexity-appropriate explanation"}],"notes":["page-specific translator note"],"ocrConfidence":0.0}.',
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
  }, signal)

  return normalizeVisionTranslation(content, fallbackSectionTitle)
}

export async function requestTextTranslation({
  endpoint,
  model,
  bookTitle,
  pageNumber,
  complexityLabel,
  languageLabel,
  complexity,
  language,
  originalParagraphs,
  sourceLines,
  glossary,
  previousOriginalParagraphs,
  previousTranslatedParagraphs,
  signal,
}: TextTranslationRequest): Promise<VisionTranslationResult> {
  const fallbackSectionTitle = `Page ${pageNumber}`
  const content = await sendVisionChat(endpoint, {
    model: model.trim() || 'default',
    messages: [
      {
        role: 'system',
        content: [
          'You rewrite canonical historical translations for a chosen audience and language.',
          'Use the provided Original English as the source of truth. Do not reinterpret from OCR unless source lines clarify a term.',
          'Preserve technical meaning, continuity, and glossary term choices across pages.',
          'Return a page-local glossary of important vocabulary and concepts. Tune explanations to the requested complexity and output language.',
          'Return compact JSON only. Do not include markdown.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Book: ${bookTitle}`,
          `Page: ${pageNumber}`,
          `Task: Translate/rewrite the Original English into ${complexityLabel} ${languageLabel}.`,
          `Complexity key: ${complexity}. Language key: ${language}.`,
          previousOriginalParagraphs?.length
            ? `Previous page Original English for continuity:\n${previousOriginalParagraphs.join('\n\n')}`
            : '',
          previousTranslatedParagraphs?.length
            ? `Previous page ${complexityLabel} ${languageLabel} translation for style and continuity:\n${previousTranslatedParagraphs.join('\n\n')}`
            : '',
          sourceLines.length ? `OCR/source lines for reference:\n${sourceLines.join('\n')}` : '',
          glossary?.length
            ? `Approved or previously used glossary terms. Use approved translations exactly where applicable:\n${glossary.map((entry) => `${entry.sourceTerm} => ${entry.translatedTerm}: ${entry.explanation}`).join('\n')}`
            : '',
          `Original English source:\n${originalParagraphs.join('\n\n')}`,
          'For Kid Friendly: explain clearly without childish tone. For Simplified English: use plain modern prose. For High School: preserve more terminology. For College: preserve technical density and historical nuance.',
          'Glossary requirements: include 5-12 page-local vocabulary entries when available. For Kid Friendly, explain terms simply. For Simplified English, use plain explanations. For High School, include key technical terms. For College, include precise historical or technical nuance. Put explanations in the requested output language where possible.',
          'Notes requirements: include short page-specific translator notes for ambiguity, historical context, OCR uncertainty, or important conceptual framing.',
          'Return JSON only with this shape: {"sectionTitle":"Short section title","sourceLines":["source line"],"paragraphs":["Translated paragraph"],"glossary":[{"sourceTerm":"term or phrase from the page","translatedTerm":"reader-facing translation or label","explanation":"complexity-appropriate explanation"}],"notes":["page-specific translator note"],"ocrConfidence":1.0}.',
        ].filter(Boolean).join('\n'),
      },
    ],
    temperature: 0.15,
  }, signal)

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
  signal,
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
  }, signal)

  return normalizeVisionAnswer(content)
}

export async function requestTranslationMemoryReview({
  endpoint,
  model,
  bookTitle,
  newTerms,
  existingTerms = [],
  signal,
}: TranslationMemoryReviewRequest): Promise<TranslationMemoryReviewResult> {
  if (!newTerms.length) return { glossary: [] }

  const content = await sendVisionChat(endpoint, {
    model: model.trim() || 'default',
    messages: [
      {
        role: 'system',
        content: [
          'You are maintaining a concise book-level translation glossary for a historical text.',
          'Review new page-local glossary entries and return only terms that should be reused across pages.',
          'Prefer stable names, places, repeated technical terms, archaic words, and special phrases.',
          'Merge duplicates, resolve near-duplicates, and keep preferred translations consistent with existing approved memory.',
          'Do not include generic one-off words. Return compact JSON only. Do not include markdown.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Book: ${bookTitle}`,
          existingTerms.length
            ? `Existing approved book glossary:\n${existingTerms.map((entry) => `${entry.sourceTerm} => ${entry.translatedTerm}: ${entry.explanation}`).join('\n')}`
            : '',
          `New page glossary candidates:\n${newTerms.map((entry) => `${entry.sourceTerm} => ${entry.translatedTerm}: ${entry.explanation}`).join('\n')}`,
          'Return JSON only with this shape: {"glossary":[{"sourceTerm":"canonical source term","translatedTerm":"preferred translation","explanation":"short reusable explanation"}]}.',
        ].filter(Boolean).join('\n\n'),
      },
    ],
    temperature: 0.05,
  }, signal)

  try {
    const payload = asRecord(parseJsonish(content))
    return { glossary: normalizeGlossary(payload.glossary) }
  } catch {
    return { glossary: normalizeGlossary(newTerms) }
  }
}
