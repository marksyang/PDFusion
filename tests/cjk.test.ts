import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, PDFOperator, PDFNumber } from 'pdf-lib'
import * as fontkit from 'fontkit'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONT = join(root, 'resources', 'fonts', 'NotoSansTC-Regular.otf')

function withFontkit(doc: PDFDocument): PDFDocument {
  doc.registerFontkit(fontkit as never)
  return doc
}

describe('CJK fallback font', () => {
  it('bundled Noto Sans TC exists and can encode CJK', async () => {
    const bytes = readFileSync(FONT)
    const doc = withFontkit(await PDFDocument.create())
    const cjk = await doc.embedFont(bytes)
    // Should not throw:
    expect(() => cjk.encodeText('中文測試1234')).not.toThrow()
    // WinAnsi Helvetica must NOT encode the same text (why we need the fallback):
    const hel = await doc.embedFont(StandardFonts.Helvetica)
    expect(() => hel.encodeText('中文')).toThrow()
  }, 30000)

  it('bakes CJK freetext into a page (high-level + raw paths)', async () => {
    const bytes = readFileSync(join(root, 'fixtures', 'smoke.pdf'))
    const doc = withFontkit(await PDFDocument.load(bytes, { ignoreEncryption: true }))
    const page = doc.getPage(0)

    // high-level path (rot 0): drawText
    const cjk = await doc.embedFont(readFileSync(FONT))
    page.drawText('中文儲存測試', { x: 50, y: 400, size: 16, font: cjk })

    // raw path (rotated style): content stream + cm + Tf + Tj
    const key = page.node.newFontDictionary('CJK', cjk.ref)
    const of = PDFOperator.of as unknown as (name: string, args?: unknown[]) => ReturnType<typeof PDFOperator.of>
    const ops = [
      of('q', []),
      of('cm', [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(1), PDFNumber.of(50), PDFNumber.of(350)]),
      of('BT', []),
      of('Tf', [key, PDFNumber.of(16)]),
      of('Tj', [cjk.encodeText('原始流中文')]),
      of('ET', []),
      of('Q', [])
    ]
    const cs = doc.context.contentStream(ops)
    page.node.addContentStream(doc.context.register(cs))

    const out = new Uint8Array(await doc.save())
    // Round-trip: reload and confirm both CJK strings are present in the saved doc.
    const doc2 = withFontkit(await PDFDocument.load(out, { ignoreEncryption: true }))
    expect(doc2.getPageCount()).toBe(2)
  }, 30000)
})
