import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bakeAnnotations } from '../src/renderer/src/annotations/BakeToPdf'
import { PageManager } from '../src/renderer/src/pageops/PageManager'
import { textLineHeight } from '../src/renderer/src/textedit/RotatedText'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONT = join(ROOT, 'resources', 'fonts', 'NotoSansTC-Regular.otf')

// Stub the preload bridge (CjkFont reads the bundled font through it).
;(globalThis as any).window = {
  pdfusion: {
    fonts: { cjk: async () => readFileSync(FONT) }
  }
}

async function makeCore(): Promise<any> {
  process.env['PDFIUM_DYNAMIC_PATH'] ??= new URL('../resources/pdfium-mac', import.meta.url).pathname
  const { createRequire } = await import('node:module')
  const req = createRequire('/Users/markyang/Claude/PDFusion/x.js')
  const { PdfCore } = req('/Users/markyang/Claude/PDFusion/core/index.js')
  return new PdfCore()
}

/** True when a list of extracted text items (sorted by y) has no vertical overlap. */
function noVerticalOverlap(items: any[]): boolean {
  const ys = items
    .slice()
    .sort((a, b) => a.y - b.y)
    .map((i) => ({ top: i.y, bottom: i.y + i.height }))
  for (let i = 1; i < ys.length; i++) {
    // next line must start (almost) where the previous line ended
    if (ys[i].top < ys[i - 1].bottom - 2) return false
  }
  return true
}

describe('line height respects font metrics (no overlap at large sizes)', () => {
  it('textLineHeight: CJK font > 1.25em, Helvetica = 1.25em', async () => {
    const { StandardFonts } = await import('pdf-lib')
    const fontkit = (await import('fontkit')).default ?? await import('fontkit')
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit as never)
    const noto = await doc.embedFont(readFileSync(FONT))
    const hel = await doc.embedFont(StandardFonts.Helvetica)
    expect(textLineHeight(24, noto)).toBeGreaterThan(24 * 1.25)
    expect(textLineHeight(24, noto)).toBeCloseTo(24 * 1.4, 5) // capped for looks
    expect(textLineHeight(24, hel)).toBeCloseTo(24 * 1.25, 5)
  }, 30000)

  it('bakes 3 lines of CJK at fs 24 without overlap (rot 0)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const pm = new PageManager()
    await pm.load(new Uint8Array(await doc.save()))

    const text = '一二三四\n五六七八\n九十'
    await bakeAnnotations(
      pm,
      [{ id: 'a', type: 'freetext', page: 0, rect: { x: 100, y: 300, w: 300, h: 120 }, text, fontSize: 24 }],
      () => Promise.resolve(0)
    )
    const res = await pm.save()

    const core = await makeCore()
    const id = core.loadPdf(res.bytes as unknown as Uint8Array)
    const items = core.getTextItems(id, 0).filter((i: any) => /[一二三四五六七八九十]/.test(i.text))
    core.close(id)
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(noVerticalOverlap(items)).toBe(true)
  }, 30000)

  it('bakes 3 lines on a /Rotate 90 page without overlap', async () => {
    const fixture = join(ROOT, 'fixtures', 'rotated.pdf')
    if (!existsSync(fixture)) {
      console.log('skipping: fixture missing')
      return
    }
    const pm = new PageManager()
    await pm.load(new Uint8Array(readFileSync(fixture)))

    const text = '一二三四\n五六七八\n九十'
    await bakeAnnotations(
      pm,
      [{ id: 'a', type: 'freetext', page: 0, rect: { x: 100, y: 300, w: 320, h: 140 }, text, fontSize: 24 }],
      () => Promise.resolve(90)
    )
    const res = await pm.save()

    const core = await makeCore()
    const id = core.loadPdf(res.bytes as unknown as Uint8Array)
    // Region around the box to exclude pre-existing fixture text.
    const items = core
      .getTextItems(id, 0)
      .filter((i: any) => /[一二三四五六七八九十]/.test(i.text) && i.x > 60 && i.x < 480 && i.y > 250 && i.y < 500)
    core.close(id)
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(noVerticalOverlap(items)).toBe(true)
  }, 30000)
})
