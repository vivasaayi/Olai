const { test, expect } = require('@playwright/test')
const fs = require('node:fs')

function samplePdf() {
  const stream = 'BT /F1 18 Tf 30 150 Td (Historical science sample) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

async function mockModels(page) {
  await page.route('**/api/llm-router/v1/models', route => route.fulfill({ json: { data: [{ id: 'gpt-5.4-mini' }, { id: 'gpt-5.4-nano' }] } }))
}

test('author creates, edits, exports and reopens a book in another browser session', async ({ page, browser, request }) => {
  const title = `Browser authoring ${Date.now()}`
  await page.route('**/api/llm-router/v1/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ items: [{ title: 'Experiments with light', summary: 'Explore light through observations', children: [] }] }) } }] } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Book', exact: true }).click()
  const modal = page.locator('.book-settings-modal')
  await modal.getByLabel('Title', { exact: true }).fill(title)
  await modal.getByLabel('Synopsis', { exact: true }).fill('A book created through the browser.')
  await modal.getByRole('button', { name: 'Create Book', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open Contents', exact: true }).click()
  await page.getByRole('button', { name: 'Suggest Chapters', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add Selected', exact: true }).click()
  await page.getByRole('button', { name: '+ Chapter', exact: true }).first().click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.status').first()).toContainText('Saved')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).first().click()
  const download = await downloadPromise
  const downloaded = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  expect(downloaded.title).toBe(title)
  expect(downloaded.outline.length).toBeGreaterThan(1)
  const context = await browser.newContext()
  const other = await context.newPage()
  await other.goto(process.env.PLAYWRIGHT_BASE_URL)
  await expect(other.getByRole('button', { name: title, exact: true })).toBeVisible()
  await context.close()
  const books = await (await request.get('/api/books')).json()
  const saved = books.find(book => book.title === title)
  await request.delete(`/api/books/${saved.id}`, { headers: { 'If-Match': String(saved._revision) } })
})

test('PDF import, snapshot, translation, persistent notes and portable exports work in the browser', async ({ page, browser, request }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mockModels(page)
  await page.route('**/api/llm-router/v1/chat/completions', async route => {
    const body = route.request().postDataJSON()
    expect(body.messages.length).toBeGreaterThan(0)
    const payload = {
      sectionTitle: 'Light and observation',
      sourceLines: ['Das Licht trägt Energie.'],
      paragraphs: ['Light carries energy.'],
      glossary: [], notes: ['Browser acceptance fixture'], answer: 'The page explains light.',
    }
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(payload) } }] } })
  })
  await page.goto('/?tab=translation')
  const name = `Browser translation ${Date.now()}.pdf`
  await page.locator('#old-book-pdf-import').setInputFiles({ name, mimeType: 'application/pdf', buffer: samplePdf() })
  await expect(page.locator('.translation-book-field select')).toContainText(name.replace('.pdf', ''))
  await expect(page.getByRole('button', { name: 'Snapshot Page', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Snapshot Page', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Re-snapshot Page', exact: true })).toBeEnabled({ timeout: 30000 })
  // Exercise the existing faithful-English translation workflow with a deterministic model response.
  await page.getByRole('combobox', { name: 'Complexity', exact: true }).selectOption('original')
  await page.getByRole('button', { name: 'Translate Page', exact: true }).click()
  await expect(page.getByText('Light carries energy.', { exact: false }).first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText('The page explains light.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  const htmlPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const html = fs.readFileSync(await (await htmlPromise).path(), 'utf8')
  expect(html).toContain('Light carries energy.')
  const packagePromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'All Languages', exact: true }).click()
  const packageDownload = await packagePromise
  expect(packageDownload.suggestedFilename()).toMatch(/\.bookpkg$/)
  const packageBytes = fs.readFileSync(await packageDownload.path())
  expect(packageBytes.subarray(0, 2).toString()).toBe('PK')
  expect(packageBytes.toString()).toContain('source/original.pdf')
  expect(packageBytes.toString()).toContain('image/jpeg')
  await page.getByRole('button', { name: 'Browse Exports', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Saved exports' }).getByRole('link')).toBeVisible()
  await page.getByRole('button', { name: 'Close exports' }).click()
  await page.screenshot({ path: '.test-results/translation-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '.test-results/translation-mobile.png', fullPage: true })
  const context = await browser.newContext()
  const other = await context.newPage()
  await mockModels(other)
  await other.goto(`${process.env.PLAYWRIGHT_BASE_URL}/?tab=translation`)
  await other.getByRole('combobox', { name: 'Complexity', exact: true }).selectOption('original')
  await expect(other.getByText('Light carries energy.', { exact: false }).first()).toBeVisible()
  await context.close()
  expect(errors).toEqual([])
  const books = await (await request.get('/api/translations')).json()
  const saved = books.find(book => book.pdfFileName === name)
  expect(saved.pageSnapshots).toHaveLength(1)
  expect(saved.pageSnapshots[0].imageDataUrl).toBe('')
  expect(saved.pageSnapshots[0].filePath).toMatch(/^\/api\/assets\//)
  expect(saved.translations).toHaveLength(1)
  expect(saved.questions).toHaveLength(1)
  await request.delete(`/api/translations/${saved.id}`, { headers: { 'If-Match': String(saved._revision) } })
})

test('legacy browser drafts import PDFs and translations into shared server storage', async ({ page, request }) => {
  const id = `legacy-browser-${Date.now()}`
  await mockModels(page)
  await page.goto('/?tab=translation')
  await page.evaluate(async ({ id, pdf }) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('bookforge-old-books', 1)
      open.onupgradeneeded = () => {
        open.result.createObjectStore('books', { keyPath: 'id' })
        open.result.createObjectStore('pdfs', { keyPath: 'id' })
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const transaction = db.transaction(['books', 'pdfs'], 'readwrite')
    const now = new Date().toISOString()
    transaction.objectStore('books').put({
      id, title: 'Legacy browser draft', author: 'Test author', originalLanguage: 'German',
      pages: 1, pageNumber: 1, pdfBlobId: id + '-pdf', pdfFileName: 'legacy.pdf',
      tags: [], pageSnapshots: [], snapshotJobs: [], translationJobs: [], translationMemory: [], questions: [],
      translations: [{ id: id + '-translation', pageNumber: 1, complexity: 'simplified', language: 'ta', sectionTitle: 'Light', paragraphs: ['ஒளி ஆற்றலைக் கொண்டு செல்கிறது.'], sourceLines: ['Das Licht trägt Energie.'], model: 'fixture-model', createdAt: now }],
      createdAt: now, updatedAt: now,
    })
    transaction.objectStore('pdfs').put({ id: id + '-pdf', blob: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), fileName: 'legacy.pdf', savedAt: now })
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error) })
    db.close()
  }, { id, pdf: [...samplePdf()] })
  await page.getByRole('button', { name: 'Import Browser Drafts', exact: true }).click()
  await expect(page.getByText('Imported 1 browser drafts.', { exact: true })).toBeVisible()
  const saved = await (await request.get(`/api/translations/${id}`)).json()
  expect(saved.translations[0].paragraphs).toEqual(['ஒளி ஆற்றலைக் கொண்டு செல்கிறது.'])
  expect((await request.get(saved.pdfFilePath)).ok()).toBe(true)
  // A retry imports zero books and leaves the shared book intact.
  await page.getByRole('button', { name: 'Import Browser Drafts', exact: true }).click()
  await expect(page.getByText('Imported 0 browser drafts.', { exact: true })).toBeVisible()
  await request.delete(`/api/translations/${id}`, { headers: { 'If-Match': String(saved._revision) } })
})
