import { PDFDocument } from 'pdf-lib'
import { fontkit } from '../textedit/Fontkit'

/** pdf-lib needs a fontkit instance to embed custom (TTF/OTF) fonts. */
function withFontkit(doc: PDFDocument): PDFDocument {
  doc.registerFontkit(fontkit as never)
  return doc
}

export interface PageOpResult {
  bytes: Uint8Array
  pageCount: number
}

/**
 * PageManager — page-level operations on PDF bytes using pdf-lib (public API).
 * Keeps an in-memory working PDFDocument so successive operations compose.
 */
export class PageManager {
  private doc: PDFDocument | null = null
  private bytes: Uint8Array | null = null

  /** Load fresh working state from raw PDF bytes. */
  async load(bytes: Uint8Array): Promise<number> {
    const doc: PDFDocument = withFontkit(
      await PDFDocument.load(bytes as unknown as ArrayBuffer, {
        ignoreEncryption: true,
        updateMetadata: false
      })
    )
    this.doc = doc
    this.bytes = bytes
    return doc.getPageCount()
  }

  get hasDoc(): boolean {
    return this.doc !== null && this.bytes !== null
  }

  private require(): PDFDocument {
    if (!this.doc) throw new Error('no document loaded')
    return this.doc
  }

  private async commit(): Promise<PageOpResult> {
    const doc = this.require()
    const bytes = new Uint8Array(await doc.save())
    this.bytes = bytes
    return { bytes, pageCount: doc.getPageCount() }
  }

  /** Serialize the current working document (after direct mutations, e.g. bake). */
  public async save(): Promise<PageOpResult> {
    return this.commit()
  }

  /** Delete the page at index. */
  async deletePage(index: number): Promise<PageOpResult> {
    const doc = this.require()
    if (index < 0 || index >= doc.getPageCount()) throw new Error('invalid page index')
    doc.removePage(index)
    return this.commit()
  }

  /** Insert a blank page at index (default US Letter). */
  async insertBlankPage(index: number, width = 612, height = 792): Promise<PageOpResult> {
    const doc = this.require()
    doc.insertPage(clamp(index, 0, doc.getPageCount()), [width, height])
    return this.commit()
  }

  /** Insert a page containing the given image at index. */
  async insertImagePage(index: number, imageBytes: Uint8Array): Promise<PageOpResult> {
    const doc = this.require()
    const isPng = imageBytes.length > 8 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50
    const embedded = isPng
      ? await doc.embedPng(imageBytes as unknown as ArrayBuffer)
      : await doc.embedJpg(imageBytes as unknown as ArrayBuffer)
    const page = doc.insertPage(clamp(index, 0, doc.getPageCount()), [612, 792])
    const maxW = 540
    const maxH = 720
    const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1)
    const w = embedded.width * scale
    const h = embedded.height * scale
    page.drawImage(embedded, { x: (612 - w) / 2, y: (792 - h) / 2, width: w, height: h })
    return this.commit()
  }

  /** Insert pages copied from another PDF file, starting at index. */
  async insertFromPdf(index: number, otherBytes: Uint8Array): Promise<PageOpResult> {
    const doc = this.require()
    const other = await PDFDocument.load(otherBytes as unknown as ArrayBuffer, {
      ignoreEncryption: true
    })
    const copied = await doc.copyPages(other, other.getPageIndices())
    const at = clamp(index, 0, doc.getPageCount())
    for (let i = 0; i < copied.length; i++) {
      doc.insertPage(at + i, copied[i])
    }
    return this.commit()
  }

  /** Move the page at fromIndex so it lands before toIndex (post-removal coordinates). */
  async reorder(fromIndex: number, toIndex: number): Promise<PageOpResult> {
    const doc = this.require()
    const n = doc.getPageCount()
    if (fromIndex < 0 || fromIndex >= n) throw new Error('invalid from index')
    let target = toIndex > fromIndex ? toIndex - 1 : toIndex
    target = clamp(target, 0, n - 1)
    if (target === fromIndex) return this.commit()

    // Rebuild the document with the new page order (public-API only).
    const order: number[] = []
    for (let i = 0; i < n; i++) if (i !== fromIndex) order.push(i)
    order.splice(target, 0, fromIndex)

    const out = withFontkit(await PDFDocument.create())
    const copied = await out.copyPages(doc, order)
    for (const p of copied) out.addPage(p)
    this.doc = out
    return this.commit()
  }

  /** Return bytes of pages [start, start+count) as a standalone document. */
  async extractRange(start: number, count: number): Promise<PageOpResult> {
    const doc = this.require()
    const n = doc.getPageCount()
    if (start < 0 || count <= 0 || start + count > n) throw new Error('invalid range')
    const out = withFontkit(await PDFDocument.create())
    const copied = await out.copyPages(doc, Array.from({ length: count }, (_, i) => start + i))
    for (const p of copied) out.addPage(p)
    const bytes = new Uint8Array(await out.save())
    return { bytes, pageCount: count }
  }

  /** Current full-document bytes. */
  currentBytes(): Uint8Array {
    if (!this.bytes) throw new Error('no document loaded')
    return this.bytes
  }

  pageCount(): number {
    return this.require().getPageCount()
  }

  /** Expose the working document for read-only or direct mutation (bake). */
  withDoc<T>(fn: (doc: PDFDocument) => T): T {
    return fn(this.require())
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
