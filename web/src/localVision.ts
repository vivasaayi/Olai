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
  previousSourceLines?: string[]
  nextOriginalParagraphs?: string[]
  nextSourceLines?: string[]
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

function fallbackCompletionsUrls(endpoint: string) {
  const primary = completionsUrl(endpoint)
  if (!primary) return []

  const urls = [primary]
  if (primary.startsWith('/api/llm-router')) {
    urls.push(`http://localhost:1235${primary.replace(/^\/api\/llm-router/, '')}`)
  }
  return urls
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
      englishTerm: typeof entry.englishTerm === 'string' ? entry.englishTerm : undefined,
      targetTerm: typeof entry.targetTerm === 'string' ? entry.targetTerm : undefined,
      transliteration: typeof entry.transliteration === 'string' ? entry.transliteration : undefined,
    }))
    .filter((entry) => entry.sourceTerm || entry.translatedTerm || entry.englishTerm || entry.targetTerm || entry.explanation)
}

function languageSpecificOverride(language: TranslationLanguage, languageLabel: string) {
  if (language === 'ta') {
    return [
      'Tamil language override:',
      '- Write the main explanation/translation in natural Tamil, but keep core scientific, mathematical, historical, and conceptual terms in English.',
      '- On the first important use of a core English term, write it as English term followed by Tamil transliteration in brackets, for example: electricity (Tamil transliteration).',
      '- After a term has been introduced, repeat the English term directly where that improves bilingual reading.',
      '- Do not replace important technical terms with obscure Tamil coinages when the English term is more useful for learning.',
      '- Use Tamil sentence structure and Tamil explanatory phrasing around the English core terms.',
      '- Vocabulary must be multilingual: each glossary item should include sourceTerm for the German/source term, englishTerm for the preferred English concept term, targetTerm for the Tamil rendering or Tamil transliteration, translatedTerm as the reader-facing term, and explanation in Tamil.',
      '- If useful, include the English meaning inside the explanation, but keep the explanation readable for Tamil readers.',
    ].join('\n')
  }

  return [
    `Language override: produce the output in ${languageLabel}.`,
    'For page vocabulary, include source-language terms, reader-facing translated terms, and complexity-appropriate explanations.',
  ].join('\n')
}

function glossaryJsonShape() {
  return '{"sourceTerm":"German/source term from the page","englishTerm":"preferred English concept term","targetTerm":"target-language term or transliteration","transliteration":"optional pronunciation/transliteration","translatedTerm":"reader-facing term","explanation":"complexity-appropriate explanation"}'
}

function formatGlossaryForPrompt(entry: TranslationGlossaryEntry) {
  return [
    entry.sourceTerm ? `source=${entry.sourceTerm}` : '',
    entry.englishTerm ? `english=${entry.englishTerm}` : '',
    entry.targetTerm ? `target=${entry.targetTerm}` : '',
    entry.transliteration ? `transliteration=${entry.transliteration}` : '',
    entry.translatedTerm ? `translated=${entry.translatedTerm}` : '',
    entry.explanation ? `explanation=${entry.explanation}` : '',
  ].filter(Boolean).join(' | ')
}

function joinCapped(items: string[] | undefined, separator: string, maxChars: number) {
  if (!items?.length) return ''
  const joined = items.join(separator)
  if (joined.length <= maxChars) return joined
  return `${joined.slice(0, maxChars).trimEnd()}\n[context truncated]`
}

function formatGlossaryCapped(glossary: TranslationGlossaryEntry[] | undefined, maxEntries: number) {
  if (!glossary?.length) return ''
  return glossary.slice(0, maxEntries).map(formatGlossaryForPrompt).join('\n')
}

function modelProviderHint(model: string) {
  const normalized = model.trim().toLowerCase()
  if (normalized.startsWith('deepseek') || normalized.startsWith('deepseek:')) return 'deepseek'
  return ''
}

function modelRuntimeControls(model: string) {
  const provider = modelProviderHint(model)
  return {
    ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
  }
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

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeout = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

async function sendVisionChat(endpoint: string, body: unknown, signal?: AbortSignal) {
  const urls = fallbackCompletionsUrls(endpoint)
  if (!urls.length) throw new Error('Enter an LLM router endpoint.')

  const serializedBody = JSON.stringify(body)
  let lastError: unknown
  let lastHttpError = ''
  const maxAttempts = 3

  for (const url of urls) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serializedBody,
          signal,
        })

        if (!response.ok) {
          lastHttpError = `LLM router request failed via ${url}: ${response.status} ${await response.text()}`
          if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
            throw new Error(lastHttpError)
          }
        } else {
          const data = await response.json()
          const content = data?.choices?.[0]?.message?.content
          if (typeof content !== 'string' || !content.trim()) {
            throw new Error('Local LLM response did not include choices[0].message.content.')
          }
          return content
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('Translation request was stopped.')
        }
        if (error instanceof Error && lastHttpError && error.message === lastHttpError) {
          throw error
        }
        lastError = error
        if (attempt === maxAttempts) break
      }

      await delay(600 * attempt, signal)
    }
  }

  const causeMessage = lastError instanceof Error ? ` Last network error: ${lastError.message}.` : ''
  throw new Error(
    `Could not reach the LLM router after trying ${urls.join(' and ')}. Request size: ${Math.round(serializedBody.length / 1024)} KB.${causeMessage}`,
    { cause: lastError },
  )
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
    ...modelRuntimeControls(model),
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
                ? `Approved or previously used glossary terms. Use approved translations exactly where applicable:\n${priorGlossary.map(formatGlossaryForPrompt).join('\n')}`
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
  previousSourceLines,
  nextOriginalParagraphs,
  nextSourceLines,
  previousTranslatedParagraphs,
  signal,
}: TextTranslationRequest): Promise<VisionTranslationResult> {
  const fallbackSectionTitle = `Page ${pageNumber}`
  const isConceptGuide = complexity === 'concept-guide'
  const languageOverride = languageSpecificOverride(language, languageLabel)
  const glossaryShape = glossaryJsonShape()
  const content = await sendVisionChat(endpoint, {
    model: model.trim() || 'default',
    ...modelRuntimeControls(model),
    messages: [
      {
        role: 'system',
        content: isConceptGuide
          ? [
            'You write kid-friendly concept guides for historical scientific book pages in the requested language.',
            'Use the Original English and source lines as source material, but you may explain beyond the original text when needed.',
            'Use previous and next page context only for continuity. Do not include next-page content unless it completes a sentence or idea that visibly begins on the current page.',
            'Clearly mark modern explanations as explanations, not as claims made by the original author.',
            'Connect old terms and ideas to modern concepts, examples, analogies, and step-by-step reasoning.',
            'Include real-world examples, safe simple experiments or observations the reader can try, and optional external references when they would help understanding.',
            'Experiments must be low-risk, age-appropriate, and must not require chemicals, electricity, heat, sharp tools, or specialized equipment unless explicitly framed as adult-supervised.',
            'External references should be described as suggested topics, books, museums, public-domain sources, or search phrases; do not invent precise URLs.',
            'Use small Markdown tables when they make comparisons clearer, especially for old idea vs modern view, vocabulary, laws, assumptions, observations, evidence, and examples.',
            'Include one Mermaid diagram in a fenced code block whenever the page contains a process, comparison, structure, or cause/effect relationship.',
            languageOverride,
            'Return compact JSON only. The paragraphs field must contain markdown strings.',
          ].join(' ')
          : [
            'You rewrite canonical historical translations for a chosen audience and language.',
            'Use the provided Original English as the source of truth. Do not reinterpret from OCR unless source lines clarify a term.',
            'Use previous and next page context only for continuity. Translate only the current page.',
            'Do not include next-page content in the current-page output unless it completes a sentence or idea that visibly begins on the current page.',
            'Preserve technical meaning, continuity, and glossary term choices across pages.',
            'Return a page-local glossary of important vocabulary and concepts. Tune explanations to the requested complexity and output language.',
            languageOverride,
            'Return compact JSON only. Do not include markdown.',
          ].join(' '),
      },
      {
        role: 'user',
        content: isConceptGuide
          ? [
            `Book: ${bookTitle}`,
            `Page: ${pageNumber}`,
            `Task: Create a kid-friendly concept guide in ${languageLabel} for this page.`,
            `Complexity key: ${complexity}. Language key: ${language}.`,
            languageOverride,
            previousOriginalParagraphs?.length
              ? `Previous page Original English for continuity:\n${joinCapped(previousOriginalParagraphs, '\n\n', 1800)}`
              : '',
            previousSourceLines?.length
              ? `Previous page German/source lines for continuity:\n${joinCapped(previousSourceLines, '\n', 1200)}`
              : '',
            previousTranslatedParagraphs?.length
              ? `Previous page concept guide for continuity:\n${joinCapped(previousTranslatedParagraphs, '\n\n', 1400)}`
              : '',
            sourceLines.length ? `Current page German/source lines:\n${joinCapped(sourceLines, '\n', 4000)}` : '',
            nextOriginalParagraphs?.length
              ? `Next page Original English for continuity only:\n${joinCapped(nextOriginalParagraphs, '\n\n', 1600)}`
              : '',
            nextSourceLines?.length
              ? `Next page German/source lines for continuity only:\n${joinCapped(nextSourceLines, '\n', 1000)}`
              : '',
            glossary?.length
              ? `Approved glossary terms:\n${formatGlossaryCapped(glossary, 30)}`
              : '',
            `Original English source:\n${joinCapped(originalParagraphs, '\n\n', 6000)}`,
            'Write markdown that includes: short overview, key idea, step-by-step explanation, old idea vs modern view, real-world examples, safe try-it activity or observation if applicable, vocabulary, optional external references, and a concise summary.',
            'Use Markdown tables where helpful. Keep tables small and readable. Do not use tables for long prose.',
            'Include one Mermaid diagram in a fenced ```mermaid block unless the page has no process, comparison, structure, or cause/effect relationship. Use simple flowcharts or concept maps only.',
            'For numbered steps, put each step on its own line using "1.", "2.", and so on.',
            'Do not use raw SVG yet. Do not overclaim certainty. Say when an explanation goes beyond the original page.',
            'Do not explain next-page content as part of this page unless it completes a visible current-page cutoff.',
            `Return JSON only with this shape: {"sectionTitle":"Short section title","sourceLines":["source line"],"paragraphs":["## Concept Guide\\n... markdown ..."],"glossary":[${glossaryShape}],"notes":["page-specific note"],"ocrConfidence":1.0}.`,
          ].filter(Boolean).join('\n')
          : [
            `Book: ${bookTitle}`,
            `Page: ${pageNumber}`,
            `Task: Translate/rewrite the Original English into ${complexityLabel} ${languageLabel}.`,
            `Complexity key: ${complexity}. Language key: ${language}.`,
            languageOverride,
            previousOriginalParagraphs?.length
              ? `Previous page Original English for continuity:\n${joinCapped(previousOriginalParagraphs, '\n\n', 1800)}`
              : '',
            previousSourceLines?.length
              ? `Previous page OCR/source lines for continuity:\n${joinCapped(previousSourceLines, '\n', 1200)}`
              : '',
            previousTranslatedParagraphs?.length
              ? `Previous page ${complexityLabel} ${languageLabel} translation for style and continuity:\n${joinCapped(previousTranslatedParagraphs, '\n\n', 1400)}`
              : '',
            sourceLines.length ? `Current page OCR/source lines:\n${joinCapped(sourceLines, '\n', 4000)}` : '',
            nextOriginalParagraphs?.length
              ? `Next page Original English for continuity only:\n${joinCapped(nextOriginalParagraphs, '\n\n', 1600)}`
              : '',
            nextSourceLines?.length
              ? `Next page OCR/source lines for continuity only:\n${joinCapped(nextSourceLines, '\n', 1000)}`
              : '',
            glossary?.length
              ? `Approved or previously used glossary terms. Use approved translations exactly where applicable:\n${formatGlossaryCapped(glossary, 30)}`
              : '',
            `Original English source:\n${joinCapped(originalParagraphs, '\n\n', 6000)}`,
            'For Kid Friendly: explain clearly without childish tone. For Simplified English: use plain modern prose. For High School: preserve more terminology. For College: preserve technical density and historical nuance.',
            'Glossary requirements: include 5-12 page-local vocabulary entries when available. For Kid Friendly, explain terms simply. For Simplified English, use plain explanations. For High School, include key technical terms. For College, include precise historical or technical nuance. Put explanations in the requested output language where possible. Include multilingual fields when requested by the language override.',
            'Notes requirements: include short page-specific translator notes for ambiguity, historical context, OCR uncertainty, or important conceptual framing.',
            'Boundary rule: do not translate or explain next-page-only content in this page output.',
            `Return JSON only with this shape: {"sectionTitle":"Short section title","sourceLines":["source line"],"paragraphs":["Translated paragraph"],"glossary":[${glossaryShape}],"notes":["page-specific translator note"],"ocrConfidence":1.0}.`,
          ].filter(Boolean).join('\n'),
      },
    ],
    temperature: isConceptGuide ? 0.35 : 0.15,
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
    ...modelRuntimeControls(model),
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
    ...modelRuntimeControls(model),
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
            ? `Existing approved book glossary:\n${existingTerms.map(formatGlossaryForPrompt).join('\n')}`
            : '',
          `New page glossary candidates:\n${newTerms.map(formatGlossaryForPrompt).join('\n')}`,
          `Return JSON only with this shape: {"glossary":[${glossaryJsonShape()}]}.`,
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
