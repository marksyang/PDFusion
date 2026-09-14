import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bakeAnnotations } from '../src/renderer/src/annotations/BakeToPdf'
import { PageManager } from '../src/renderer/src/pageops/PageManager'

// Stub the preload bridge (CjkFont reads the bundled font through it).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
;(globalThis as any).window = {
  pdfusion: {
    fonts: { cjk: async () => readFileSync(join(ROOT, 'resources', 'fonts', 'NotoSansTC-Regular.otf')) }
  }
}

/**
 * Regression: a (near-)click freetext box is only a few points wide. wrapText
 * then breaks CJK text one character per line, and on rotated pages the lines
 * stack vertically — the user sees a top-to-bottom column instead of
 * left-to-right text.
 */

const USER_PDF = process.env['PDFUSION_TEST_PDF'] ?? ''

async function makeCore(): Promise<any> {
  process.env['PDFIUM_DYNAMIC_PATH'] ??= new URL('../resources/pdfium-mac', import.meta.url).pathname
  const { createRequire } = await import('node:module')
  const req = createRequire('/Users/markyang/Claude/PDFusion/x.js')
  const { PdfCore } = req('/Users/markyang/Claude/PDFusion/core/index.js')
  return new PdfCore()
}

describe('narrow freetext box', () => {
  it('never wraps CJK to one character per line (rot 0)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const pm = new PageManager()
    await pm.load(new Uint8Array(await doc.save()))

    await bakeAnnotations(
      pm,
      [
        {
          id: 'a1',
          type: 'freetext',
          page: 0,
          rect: { x: 100, y: 300, w: 12, h: 54 }, // sliver box (near-click)
          text: '中文測試',
          fontSize: 13
        }
      ],
      () => Promise.resolve(0)
    )
    const res = await pm.save()

    // Extract text via the core (view space). The baked CJK must be a single
    // horizontal line: item width clearly larger than height.
    const core = await makeCore()
    const id = core.loadPdf(res.bytes as unknown as Uint8Array)
    const items = core.getTextItems(id, 0).filter((i: any) => /[中文測試]/.test(i.text))
    core.close(id)
    expect(items.length).toBeGreaterThan(0)
    // Not one-character-per-line: at least one item carries 2+ of the chars.
    const multi = items.some((i: any) => [...new Set(String(i.text).split(''))].filter((c: string) => '中文測試'.includes(c)).length >= 2)
    expect(multi).toBe(true)
  })

  it('repro against the real POA form (landscape + /Rotate 270)', async () => {
    if (!USER_PDF || !existsSync(USER_PDF)) {
      console.log('skipping: PDFUSION_TEST_PDF not available')
      return
    }
    const bytes = readFileSync(USER_PDF)
    const pm = new PageManager()
    await pm.load(new Uint8Array(bytes))

    // Core rotation lookup (same as the app).
    const core = await makeCore()
    const refId = core.loadPdf(new Uint8Array(bytes))
    const rot = core.pageRotation(refId, 0)
    core.close(refId)
    expect(rot).toBe(270)

    await bakeAnnotations(
      pm,
      [
        {
          id: 'a1',
          type: 'freetext',
          page: 0,
          rect: { x: 100, y: 300, w: 12, h: 54 },
          text: '中文測試',
          fontSize: 13
        }
      ],
      () => Promise.resolve(rot)
    )
    const res = await pm.save()

    const id2 = core.loadPdf(res.bytes as unknown as Uint8Array)
    // Region around the sliver box (100,300): exclude pre-existing form text.
    const items = core
      .getTextItems(id2, 0)
      .filter((i: any) => /[中文測試]/.test(i.text) && i.x > 60 && i.x < 300 && i.y > 250 && i.y < 450)
    core.close(id2)
    expect(items.length).toBeGreaterThan(0)
    const multi = items.some((i: any) => [...new Set(String(i.text).split(''))].filter((c: string) => '中文測試'.includes(c)).length >= 2)
    expect(multi).toBe(true)
  })
})

describe('multi-line freetext', () => {
  it('bakes newline text as separate lines (rot 0)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const pm = new PageManager()
    await pm.load(new Uint8Array(await doc.save()))

    await bakeAnnotations(
      pm,
      [
        {
          id: 'm1',
          type: 'freetext',
          page: 0,
          rect: { x: 100, y: 300, w: 300, h: 60 },
          text: '第一行\n第二行',
          fontSize: 14
        }
      ],
      () => Promise.resolve(0)
    )
    const res = await pm.save()

    const core = await makeCore()
    const id = core.loadPdf(res.bytes as unknown as Uint8Array)
    const items = core
      .getTextItems(id, 0)
      .filter((i: any) => i.text.includes('第一行') || i.text.includes('第二行'))
    core.close(id)
    expect(items.length).toBeGreaterThanOrEqual(2)
    const ys = items.map((i: any) => i.y).sort((a: number, b: number) => a - b)
    // Two distinct lines: vertical gap close to lineHeight (14 * 1.25 = 17.5).
    expect(ys[ys.length - 1] - ys[0]).toBeGreaterThanOrEqual(12)
    // Line order: 第一行 above 第二行.
    const first = items.find((i: any) => i.text.includes('第一行'))
    const second = items.find((i: any) => i.text.includes('第二行'))
    expect(first!.y).toBeLessThan(second!.y)
  })
})
