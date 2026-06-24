export type TranslationComplexity = 'kid-friendly' | 'simplified' | 'high-school' | 'college'
export type TranslationLanguage = 'ml' | 'en' | 'ta' | 'hi' | 'es'

export type PageSnapshotRecord = {
  id: string
  pageNumber: number
  imageDataUrl: string
  width: number
  height: number
  filePath?: string
  createdAt: string
}

export type TranslationRecord = {
  id: string
  pageNumber: number
  sectionTitle: string
  complexity: TranslationComplexity
  language: TranslationLanguage
  paragraphs: string[]
  sourceLines: string[]
  createdAt: string
}

export type QuestionRecord = {
  id: string
  pageNumber: number
  sectionTitle: string
  question: string
  answer: string
  complexity: TranslationComplexity
  language: TranslationLanguage
  createdAt: string
}

export type OldBookRecord = {
  id: string
  title: string
  author: string
  dateLabel: string
  originalLanguage: string
  pages: number
  status: string
  progress: number
  section: string
  tags: string[]
  pageNumber: number
  pdfBlobId?: string
  pdfFileName?: string
  pdfSizeBytes?: number
  importedAt?: string
  pageSnapshots: PageSnapshotRecord[]
  translations: TranslationRecord[]
  questions: QuestionRecord[]
  createdAt: string
  updatedAt: string
}

type PdfBlobRecord = {
  id: string
  blob: Blob
  fileName: string
  savedAt: string
}

const dbName = 'bookforge-old-books'
const dbVersion = 1
const booksStoreName = 'books'
const pdfsStoreName = 'pdfs'

export const complexityOptions: { value: TranslationComplexity, label: string }[] = [
  { value: 'kid-friendly', label: 'Kid Friendly' },
  { value: 'simplified', label: 'Simplified English' },
  { value: 'high-school', label: 'High School Friendly' },
  { value: 'college', label: 'College Friendly' },
]

export const languageOptions: { value: TranslationLanguage, label: string }[] = [
  { value: 'ml', label: 'Malayalam' },
  { value: 'en', label: 'English' },
  { value: 'ta', label: 'Tamil' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
]

export const sourcePageLines = [
  'Sphere is here taken as the first and most common figure of the world.',
  'The firmament turns as one body from east toward west, carrying with it the signs and stars.',
  'The circles by which this motion is understood are named for the use of learners.',
]

export const translationSamples: Record<TranslationComplexity, Record<TranslationLanguage, string[]>> = {
  'kid-friendly': {
    ml: [
      'ആകാശം ഒരു വലിയ ഭൂപടം പോലെയാണ്. എഴുത്തുകാരൻ പറയുന്നു: നക്ഷത്രങ്ങൾ വെറുതെ ചിതറിക്കിടക്കുന്നതല്ല; അവ ക്രമമായി സഞ്ചരിക്കുന്നു.',
      'പഴയ കാലത്ത് ആളുകൾ ഭൂമിയെ നടുവിൽ വെച്ചാണ് ആകാശത്തെ മനസ്സിലാക്കിയത്. ഇന്ന് നമുക്ക് ശാസ്ത്രം വേറെയാണെന്ന് അറിയാം, പക്ഷേ അവരുടെ ചിന്തയുടെ ക്രമം കാണുന്നത് വളരെ രസകരമാണ്.',
      'ഈ ഭാഗം വായിക്കുമ്പോൾ പ്രധാന ചോദ്യം ഇതാണ്: “അവർ ആകാശത്തെ എങ്ങനെ വിഭാഗങ്ങളാക്കി?”',
    ],
    en: [
      'The writer imagines the sky like a huge map. The stars are not random dots; they move in patterns that people can study.',
      'People at that time often placed Earth at the center of their model. We know more now, but the careful pattern-finding is still useful to understand.',
      'The main question for this section is: how did they divide the sky into parts?',
    ],
    ta: [
      'வானம் ஒரு பெரிய வரைபடம் போல இருக்கிறது என்று எழுத்தாளர் நினைக்கிறார். நட்சத்திரங்கள் சீரற்ற புள்ளிகள் அல்ல; அவை ஒரு முறையில் நகர்கின்றன.',
      'அந்த காலத்தில் பலர் பூமியை நடுவில் வைத்து வானத்தை விளக்கினர். இன்று அறிவியல் மாறிவிட்டது, ஆனால் அவர்கள் கவனித்த முறை இன்னும் பயனுள்ளதாக உள்ளது.',
    ],
    hi: [
      'लेखक आकाश को एक बड़े नक्शे की तरह देखता है। तारे बिखरे हुए बिंदु नहीं हैं; वे एक क्रम में चलते हैं।',
      'उस समय लोग अक्सर पृथ्वी को बीच में रखकर आकाश को समझते थे। आज विज्ञान अलग है, पर उनकी देखने की पद्धति समझने योग्य है।',
    ],
    es: [
      'El autor imagina el cielo como un mapa enorme. Las estrellas no son puntos al azar; se mueven con patrones que se pueden estudiar.',
      'En esa epoca muchas personas ponian la Tierra en el centro. Hoy sabemos mas, pero su manera ordenada de observar sigue siendo interesante.',
    ],
  },
  simplified: {
    ml: [
      'ഈ ഭാഗം ആകാശത്തെ പല വൃത്തങ്ങളായും മേഖലകളായും വിവരിക്കുന്നു. എഴുത്തുകാരൻ നക്ഷത്രങ്ങളുടെ ചലനം കാണാൻ ഒരു ലളിതമായ മാതൃക ഉണ്ടാക്കുന്നു.',
      'ഇത് ഇന്നത്തെ ശാസ്ത്രസത്യം പോലെ വായിക്കേണ്ടതല്ല. പഴയ വായനക്കാരന് ലോകം എങ്ങനെ മനസ്സിലാക്കാൻ ശ്രമിച്ചു എന്ന് കാണിക്കുന്ന രേഖയായി വായിക്കാം.',
    ],
    en: [
      'This passage describes the sky as a set of circles and regions. The author uses that model to explain how the stars appear to move.',
      'Read it less as modern science and more as a record of how earlier readers organized what they saw.',
    ],
    ta: [
      'இந்த பகுதி வானத்தை வட்டங்கள் மற்றும் பகுதிகளாக விளக்குகிறது. நட்சத்திரங்கள் நகர்வது போல தெரியும் விதத்தை விளக்க எழுத்தாளர் ஒரு மாதிரியை பயன்படுத்துகிறார்.',
      'இதை இன்றைய அறிவியல் உண்மையாக அல்ல, பழைய வாசகர்கள் உலகை எப்படி ஒழுங்குபடுத்தினர் என்பதற்கான சான்றாக வாசிக்கலாம்.',
    ],
    hi: [
      'यह अंश आकाश को कई वृत्तों और भागों के रूप में समझाता है। लेखक इसी मॉडल से तारों की दिखाई देने वाली गति बताता है।',
      'इसे आधुनिक विज्ञान की तरह नहीं, बल्कि पुराने पाठकों की सोच को समझने वाले दस्तावेज की तरह पढ़ें।',
    ],
    es: [
      'Este pasaje describe el cielo como una serie de circulos y regiones. El autor usa ese modelo para explicar el movimiento aparente de las estrellas.',
      'Conviene leerlo menos como ciencia moderna y mas como una muestra de como los lectores antiguos ordenaban lo que veian.',
    ],
  },
  'high-school': {
    ml: [
      'ഈ പേജിൽ ഗ്രന്ഥകാരൻ ആകാശഗോളത്തെ ക്രമീകരിച്ച വൃത്തങ്ങളുടെ ഒരു സംവിധാനമായി അവതരിപ്പിക്കുന്നു. നക്ഷത്രങ്ങളുടെ ദൃശ്യചലനം വിശദീകരിക്കാൻ ആ മാതൃക ഉപയോഗിക്കുന്നു.',
      'ചരിത്രപരമായി ഇത് പ്രധാനമാണ്, കാരണം നിരീക്ഷണം, ജ്യാമിതി, മതപരമായ ലോകദർശനം എന്നിവ ഒരേ വിശദീകരണത്തിൽ ചേർന്നുനിൽക്കുന്നതായി കാണാം.',
    ],
    en: [
      'On this page, the author presents the heavens as an ordered system of circles. The model explains the visible motion of the stars through geometry.',
      'Historically, the passage matters because observation, mathematics, and religious worldview are combined into one explanatory system.',
    ],
    ta: [
      'இந்த பக்கத்தில், வானம் ஒழுங்குபடுத்தப்பட்ட வட்டங்களின் அமைப்பாக காட்டப்படுகிறது. நட்சத்திரங்களின் தோற்றச் சலனத்தை விளக்க இந்த மாதிரி பயன்படுகிறது.',
      'வரலாற்று ரீதியாக இது முக்கியமானது, ஏனெனில் கவனிப்பு, கணிதம், மத உலகநோக்கு ஆகியவை ஒரே விளக்கத்தில் இணைகின்றன.',
    ],
    hi: [
      'इस पृष्ठ पर लेखक आकाश को व्यवस्थित वृत्तों की प्रणाली के रूप में प्रस्तुत करता है। तारों की दिखाई देने वाली गति को समझाने के लिए ज्यामिति का उपयोग किया गया है।',
      'इतिहास की दृष्टि से यह महत्वपूर्ण है, क्योंकि अवलोकन, गणित और धार्मिक विश्वदृष्टि एक ही व्याख्या में जुड़े हैं।',
    ],
    es: [
      'En esta pagina, el autor presenta el cielo como un sistema ordenado de circulos. El modelo explica el movimiento visible de las estrellas mediante geometria.',
      'Historicamente, importa porque observacion, matematicas y vision religiosa del mundo se combinan en un solo sistema explicativo.',
    ],
  },
  college: {
    ml: [
      'ഈ ഭാഗം പ്രാചീന-മധ്യകാല കോസ്മോളജിയുടെ വിദ്യാഭ്യാസപരമായ ഘടന കാണിക്കുന്നു: ദൃശ്യാനുഭവത്തെ ജ്യാമിതീയ വിഭാഗങ്ങളാക്കി മാറ്റി, അതിലൂടെ ആകാശചലനത്തിന് വ്യാഖ്യാനം നൽകുന്നു.',
      'ടെക്സ്റ്റിന്റെ മൂല്യം അതിന്റെ ശാസ്ത്രീയ കൃത്യതയിൽ മാത്രം അല്ല; അറിവ് പാഠ്യരൂപത്തിലാക്കുന്ന രീതിയിലാണ്. നിർവചനങ്ങൾ, വിഭാഗങ്ങൾ, ക്രമാനുസൃതമായ വിശദീകരണം എന്നിവ വായനക്കാരനെ ഒരു ലോകമാതൃകയിലേക്ക് കൊണ്ടുപോകുന്നു.',
    ],
    en: [
      'This passage shows the pedagogical structure of premodern cosmology: visible experience is translated into geometric categories that make celestial motion teachable.',
      'Its value is not only scientific accuracy. The text is also evidence of how knowledge was organized for instruction through definitions, divisions, and ordered explanation.',
    ],
    ta: [
      'இந்த பகுதி நவீனத்திற்கு முந்தைய விண்வெளி சிந்தனையின் பாடபயிற்சி அமைப்பை காட்டுகிறது: காணப்படும் அனுபவம் ஜியோமெட்ரி வகைகளாக மாற்றப்படுகிறது.',
      'இதன் மதிப்பு அறிவியல் துல்லியத்தில் மட்டும் இல்லை. வரையறைகள், பிரிவுகள், ஒழுங்கான விளக்கம் மூலம் அறிவு எவ்வாறு கற்பிக்கப்படுகிறது என்பதையும் இது காட்டுகிறது.',
    ],
    hi: [
      'यह अंश पूर्व-आधुनिक ब्रह्मांड-विज्ञान की शिक्षण संरचना दिखाता है: प्रत्यक्ष अनुभव को ज्यामितीय श्रेणियों में बदलकर आकाशीय गति को पढ़ाने योग्य बनाया जाता है।',
      'इसका महत्व केवल वैज्ञानिक सटीकता में नहीं है। यह भी दिखाता है कि परिभाषाओं, विभाजनों और क्रमबद्ध व्याख्या के द्वारा ज्ञान कैसे सिखाया जाता था।',
    ],
    es: [
      'Este pasaje muestra la estructura pedagogica de la cosmologia premoderna: la experiencia visible se traduce en categorias geometricas para ensenar el movimiento celeste.',
      'Su valor no reside solo en la precision cientifica. Tambien muestra como el conocimiento se organizaba para la instruccion mediante definiciones, divisiones y explicacion ordenada.',
    ],
  },
}

const now = new Date().toISOString()

export const seedOldBooks: OldBookRecord[] = [
  {
    id: 'spheres',
    title: 'A Little Treatise on the Spheres',
    author: 'Sacrobosco tradition',
    dateLabel: 'c. 1531 print',
    originalLanguage: 'Latin',
    pages: 188,
    status: 'PDF imported',
    progress: 72,
    section: 'Book I, The heavenly circles',
    tags: ['Astronomy', 'Latin', 'Woodcut era'],
    pageNumber: 42,
    pageSnapshots: [],
    translations: [],
    questions: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'plants',
    title: 'Herbal Notes from an Early Physic Garden',
    author: 'Anonymous compiler',
    dateLabel: '15th century copy',
    originalLanguage: 'Middle English',
    pages: 96,
    status: 'OCR review',
    progress: 34,
    section: 'Leaf 12r, bitter herbs',
    tags: ['Medicine', 'Plants', 'Manuscript'],
    pageNumber: 12,
    pageSnapshots: [],
    translations: [],
    questions: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'stars',
    title: 'Book of Fixed Stars',
    author: 'al-Sufi tradition',
    dateLabel: '10th century source',
    originalLanguage: 'Arabic',
    pages: 254,
    status: 'Catalog only',
    progress: 0,
    section: 'Constellation table',
    tags: ['Astronomy', 'Arabic', 'Illustrated'],
    pageNumber: 1,
    pageSnapshots: [],
    translations: [],
    questions: [],
    createdAt: now,
    updatedAt: now,
  },
]

function createId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${suffix}`
}

function openOldBooksDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(booksStoreName)) {
        db.createObjectStore(booksStoreName, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(pdfsStoreName)) {
        db.createObjectStore(pdfsStoreName, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open old books database.'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function normalizeOldBookRecord(value: OldBookRecord): OldBookRecord {
  return {
    ...value,
    tags: Array.isArray(value.tags) ? value.tags : [],
    pageNumber: value.pageNumber || 1,
    pageSnapshots: Array.isArray(value.pageSnapshots) ? value.pageSnapshots : [],
    translations: Array.isArray(value.translations) ? value.translations : [],
    questions: Array.isArray(value.questions) ? value.questions : [],
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || value.createdAt || new Date().toISOString(),
  }
}

export function mergeOldBookRecords(storedBooks: OldBookRecord[]) {
  const seedById = new Map(seedOldBooks.map((book) => [book.id, book]))
  const importedBooks: OldBookRecord[] = []

  for (const book of storedBooks.map(normalizeOldBookRecord)) {
    if (seedById.has(book.id)) {
      seedById.set(book.id, { ...seedById.get(book.id)!, ...book })
    } else {
      importedBooks.push(book)
    }
  }

  importedBooks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return [...importedBooks, ...seedOldBooks.map((book) => seedById.get(book.id)!)]
}

export async function readOldBooks() {
  const db = await openOldBooksDb()
  try {
    const transaction = db.transaction(booksStoreName, 'readonly')
    const records = await requestToPromise<OldBookRecord[]>(transaction.objectStore(booksStoreName).getAll())
    return records.map(normalizeOldBookRecord)
  } finally {
    db.close()
  }
}

export async function saveOldBookRecord(book: OldBookRecord) {
  const db = await openOldBooksDb()
  try {
    const transaction = db.transaction(booksStoreName, 'readwrite')
    await requestToPromise(transaction.objectStore(booksStoreName).put(normalizeOldBookRecord(book)))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save old book.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Unable to save old book.'))
    })
  } finally {
    db.close()
  }
}

export async function saveOldBookPdfBlob(pdfBlobId: string, blob: Blob, fileName: string) {
  const db = await openOldBooksDb()
  try {
    const transaction = db.transaction(pdfsStoreName, 'readwrite')
    const record: PdfBlobRecord = {
      id: pdfBlobId,
      blob,
      fileName,
      savedAt: new Date().toISOString(),
    }
    await requestToPromise(transaction.objectStore(pdfsStoreName).put(record))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save PDF.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Unable to save PDF.'))
    })
  } finally {
    db.close()
  }
}

export async function getOldBookPdfBlob(pdfBlobId: string) {
  const db = await openOldBooksDb()
  try {
    const transaction = db.transaction(pdfsStoreName, 'readonly')
    const record = await requestToPromise<PdfBlobRecord | undefined>(
      transaction.objectStore(pdfsStoreName).get(pdfBlobId),
    )
    return record?.blob ?? null
  } finally {
    db.close()
  }
}

export function createImportedOldBook(file: File): OldBookRecord {
  const createdAt = new Date().toISOString()
  const title = file.name
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Imported public-domain book'
  const id = createId('old-book')
  const pdfBlobId = createId('pdf')

  return {
    id,
    title,
    author: 'Unknown',
    dateLabel: 'Imported PDF',
    originalLanguage: 'Unknown',
    pages: 0,
    status: 'PDF imported',
    progress: 0,
    section: 'Page 1, OCR pending',
    tags: ['Imported PDF', 'Public domain'],
    pageNumber: 1,
    pdfBlobId,
    pdfFileName: file.name,
    pdfSizeBytes: file.size,
    importedAt: createdAt,
    pageSnapshots: [],
    translations: [],
    questions: [],
    createdAt,
    updatedAt: createdAt,
  }
}

export function getDemoTranslationParagraphs(complexity: TranslationComplexity, language: TranslationLanguage) {
  return translationSamples[complexity][language]
}

export function createTranslationRecord(
  book: OldBookRecord,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  sectionTitle: string,
  content?: { paragraphs?: string[], sourceLines?: string[] },
): TranslationRecord {
  return {
    id: createId('translation'),
    pageNumber: book.pageNumber,
    sectionTitle,
    complexity,
    language,
    paragraphs: content?.paragraphs?.length ? content.paragraphs : getDemoTranslationParagraphs(complexity, language),
    sourceLines: content?.sourceLines?.length ? content.sourceLines : sourcePageLines,
    createdAt: new Date().toISOString(),
  }
}

export function createQuestionRecord(
  book: OldBookRecord,
  complexity: TranslationComplexity,
  language: TranslationLanguage,
  sectionTitle: string,
  question: string,
  answer?: string,
): QuestionRecord {
  return {
    id: createId('question'),
    pageNumber: book.pageNumber,
    sectionTitle,
    question,
    answer: answer?.trim() || 'The circles give the author a simple way to group what people see in the sky. In this page, geometry acts like a reading map for the stars.',
    complexity,
    language,
    createdAt: new Date().toISOString(),
  }
}

export function createPageSnapshotRecord(
  pageNumber: number,
  imageDataUrl: string,
  width: number,
  height: number,
  filePath?: string,
): PageSnapshotRecord {
  return {
    id: createId('snapshot'),
    pageNumber,
    imageDataUrl,
    width,
    height,
    filePath,
    createdAt: new Date().toISOString(),
  }
}
