import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { bakeAnnotations } from '../src/renderer/src/annotations/BakeToPdf'
import { PageManager } from '../src/renderer/src/pageops/PageManager'

describe('bakeAnnotations', () => {
  it('bakes shapes and text into the document without changing page count', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const bytes = new Uint8Array(await doc.save())

    const pm = new PageManager()
    await pm.load(bytes)
    const before = bytes.length

    await bakeAnnotations(pm, [
      { id: 'h1', type: 'highlight', page: 0, rect: { x: 50, y: 100, w: 200, h: 20 } },
      { id: 'r1', type: 'rect', page: 0, rect: { x: 50, y: 150, w: 100, h: 60 } },
      { id: 'e1', type: 'ellipse', page: 0, rect: { x: 50, y: 250, w: 120, h: 80 } },
      {
        id: 'i1',
        type: 'ink',
        page: 0,
        points: [
          { x: 60, y: 400 },
          { x: 120, y: 430 },
          { x: 200, y: 390 }
        ]
      },
      { id: 't1', type: 'freetext', page: 0, rect: { x: 50, y: 500, w: 300, h: 40 }, text: 'hello world', fontSize: 13 }
    ])

    const res = await pm.save()
    expect(res.pageCount).toBe(1)
    // Baked content must grow the file.
    expect(res.bytes.length).toBeGreaterThan(before)

    // Round-trip: the baked document still loads cleanly.
    const reloaded = await PDFDocument.load(res.bytes as unknown as ArrayBuffer, { ignoreEncryption: true })
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('is a no-op for an empty annotation list', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const bytes = new Uint8Array(await doc.save())
    const pm = new PageManager()
    await pm.load(bytes)
    await bakeAnnotations(pm, [])
    const res = await pm.save()
    expect(res.pageCount).toBe(1)
  })
})
