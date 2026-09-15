import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PageManager } from '../src/renderer/src/pageops/PageManager'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Regression: two consecutive saves in ONE session must both keep their text.
 *
 * pdf-lib silently drops newly-appended content streams when the SAME
 * PDFDocument object is saved a second time (mutate → save → mutate → save
 * loses the second batch). Real-world symptom: enter "123" → save, then
 * (without reopening) enter "456"/"90" → save → 456/90 vanished from the
 * file, while "123" survived. Reopening between saves used a fresh document,
 * which is why that flow worked.
 *
 * The fix: PageManager.reload(bytes) rebuilds the in-memory document before
 * every save. This test proves the bake-again-without-reopening flow works
 * end to end (verified with real PDFium text search).
 */

const req = createRequire(import.meta.url)
let core: { loadPdf: (b: ArrayBuffer | Uint8Array) => number; search: (id: number, q: string) => { page: number; x: number; y: number }[]; close: (id: number) => void }

function getCore() {
  if (!core) {
    process.env.PDFIUM_DYNAMIC_PATH = join(root, 'resources', 'pdfium-mac')
    const mod = req(join(root, 'core', 'index.js'))
    core = new mod.PdfCore()
  }
  return core
}

async function drawText(doc: PDFDocument, text: string, y: number) {
  const page = doc.getPage(0)
  const hel = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 50, y: 792 - y - 20, size: 20, font: hel })
}

describe('consecutive bakes in one session (pdf-lib double-save trap)', () => {
  it('both batches persist when the manager reloads between saves', async () => {
    // Start from a simple one-page document.
    const src = await PDFDocument.create()
    src.addPage([612, 792])
    const bytes0 = new Uint8Array(await src.save())

    const pm = new PageManager()
    await pm.load(bytes0)

    // Save #1: bake "AAA".
    await pm.withDoc((doc) => drawText(doc, 'AAA', 300))
    const r1 = await pm.save()

    // Save #2 (SAME session — the trap): reload from saved bytes, then bake "BBB".
    await pm.reload(r1.bytes)
    await pm.withDoc((doc) => drawText(doc, 'BBB', 400))
    const r2 = await pm.save()

    // Save #3 (a plain save on an already-saved document object — also the trap).
    await pm.reload(r2.bytes)
    const r3 = await pm.save()

    const c = getCore()
    const id = c.loadPdf(r3.bytes)
    try {
      expect(c.search(id, 'AAA').length).toBeGreaterThan(0)
      expect(c.search(id, 'BBB').length).toBeGreaterThan(0)
    } finally {
      c.close(id)
    }
  }, 60000)

  it('documents the raw trap: without reload, the second batch is lost', async () => {
    // This test asserts the underlying pdf-lib behavior so a future pdf-lib
    // upgrade that changes it makes this test fail loudly (revisit then).
    const src = await PDFDocument.create()
    src.addPage([612, 792])
    const bytes0 = new Uint8Array(await src.save())

    const doc = await PDFDocument.load(bytes0, { ignoreEncryption: true })
    await drawText(doc, 'AAA', 300)
    const b1 = new Uint8Array(await doc.save())
    // No reload — mutate the SAME document object again:
    await drawText(doc, 'BBB', 400)
    const b2 = new Uint8Array(await doc.save())

    const c = getCore()
    const id = c.loadPdf(b2)
    try {
      expect(c.search(id, 'AAA').length).toBeGreaterThan(0)
      // The trap: the second batch is silently dropped by pdf-lib.
      expect(c.search(id, 'BBB').length).toBe(0)
    } finally {
      c.close(id)
    }
  }, 60000)
})
