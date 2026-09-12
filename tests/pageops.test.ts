import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { PageManager } from '../src/renderer/src/pageops/PageManager'

/** Build a 3-page PDF with distinct page widths: 600 / 700 / 800 pt. */
async function makeDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const widths = [600, 700, 800]
  for (const w of widths) doc.addPage([w, 800])
  return new Uint8Array(await doc.save())
}

async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes as unknown as ArrayBuffer, { ignoreEncryption: true })
  return Array.from({ length: doc.getPageCount() }, (_, i) => Math.round(doc.getPage(i).getWidth()))
}

describe('PageManager', () => {
  it('deletePage removes the page and shifts order', async () => {
    const pm = new PageManager()
    await pm.load(await makeDoc())
    const res = await pm.deletePage(1)
    expect(res.pageCount).toBe(2)
    expect(await widthsOf(res.bytes)).toEqual([600, 800])
  })

  it('insertBlankPage inserts at the given index', async () => {
    const pm = new PageManager()
    await pm.load(await makeDoc())
    const res = await pm.insertBlankPage(1, 500, 700)
    expect(res.pageCount).toBe(4)
    const w = await widthsOf(res.bytes)
    expect(w[1]).toBe(500)
    expect(w).toHaveLength(4)
  })

  it('reorder moves a page forward', async () => {
    const pm = new PageManager()
    await pm.load(await makeDoc())
    const res = await pm.reorder(0, 2)
    expect(res.pageCount).toBe(3)
    // After moving page 0 to target index 2 (adjusted to 1): order 700, 600, 800
    expect(await widthsOf(res.bytes)).toEqual([700, 600, 800])
  })

  it('reorder moves a page backward', async () => {
    const pm = new PageManager()
    await pm.load(await makeDoc())
    const res = await pm.reorder(2, 0)
    expect(await widthsOf(res.bytes)).toEqual([800, 600, 700])
  })

  it('extractRange returns a standalone subset', async () => {
    const pm = new PageManager()
    await pm.load(await makeDoc())
    const res = await pm.extractRange(1, 2)
    expect(res.pageCount).toBe(2)
    expect(await widthsOf(res.bytes)).toEqual([700, 800])
    // Original document is untouched.
    expect(await widthsOf(pm.currentBytes())).toEqual([600, 700, 800])
  })

  it('operations compose in sequence', async () => {
    const pm = new PageManager()
    await pm.load(await makeDoc())
    await pm.deletePage(0)
    await pm.insertBlankPage(0, 400, 500)
    await pm.reorder(2, 0)
    const res = await pm.save()
    expect(res.pageCount).toBe(3)
    const w = await widthsOf(res.bytes)
    expect(w).toEqual([800, 400, 700])
  })
})
