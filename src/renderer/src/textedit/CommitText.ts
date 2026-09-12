import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { PageManager } from '../pageops/PageManager'
import type { TextItem } from '../global'

/**
 * CommitText — replaces a text segment in the working document:
 * 1. Cover the original with an opaque white rect (content stream).
 * 2. Re-draw the new text using the ORIGINAL embedded font bytes
 *    (extracted by the Rust core) when available, else Helvetica.
 *
 * Note: this is overlay-style editing (see docs/text-editing-limits.md).
 */

export async function commitTextEdit(
  pm: PageManager,
  docId: number,
  page: number,
  item: TextItem,
  newText: string
): Promise<void> {
  const trimmed = newText.trim()
  if (!trimmed) return

  // Extract the original font bytes (best effort).
  let fontBytes: ArrayBuffer | null = null
  if (item.fontName) {
    try {
      const raw = await window.pdfusion.core.getFont(docId, item.fontName)
      fontBytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    } catch {
      fontBytes = null
    }
  }

  // Embed the font (Helvetica fallback). Font embed is async → run via withDoc
  // which may return a promise.
  const font: PDFFont = await pm.withDoc((doc: PDFDocument) => {
    if (fontBytes) {
      try {
        return doc.embedFont(fontBytes)
      } catch {
        // Unsupported/invalid font data → fall through to Helvetica.
      }
    }
    return doc.embedFont(StandardFonts.Helvetica)
  })

  pm.withDoc((doc) => {
    const pdfPage = doc.getPage(page)
    const H = pdfPage.getHeight()

    // 1. Cover the old text (slightly expanded to hide glyphs).
    pdfPage.drawRectangle({
      x: item.x - 1,
      y: H - (item.y + item.height) - 1,
      width: item.width + 2,
      height: item.height + 2,
      color: rgb(1, 1, 1)
    })

    // 2. Draw the replacement text (multi-line support via \n).
    const size = item.fontSize > 0 ? item.fontSize : item.height / 1.2
    const lineHeight = size * 1.25
    const lines = newText.split('\n')
    lines.forEach((line, i) => {
      const top = item.y + 1 + i * lineHeight
      // Approximate baseline: ascent ≈ 0.8 of line height for typical fonts.
      pdfPage.drawText(line, {
        x: item.x + 1,
        y: H - top - size * 0.8,
        size,
        font,
        color: rgb(0, 0, 0)
      })
    })
  })
}
