import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { PageManager } from '../pageops/PageManager'
import type { TextItem } from '../global'
import { viewRectToPdf } from './Rotation'
import { drawRotatedText } from './RotatedText'
import { pickTextFont } from './CjkFont'

/**
 * CommitText — replaces a text segment in the working document:
 * 1. Cover the original with an opaque white rect (content stream).
 * 2. Re-draw the new text using the ORIGINAL embedded font bytes
 *    (extracted by the Rust core) when available, else Helvetica.
 *
 * `item` coordinates are VIEW space (top-left origin, /Rotate applied); they
 * are converted to pdf-lib's unrotated user space. On rotated pages the new
 * text runs along the page's NATIVE axis (consistent with the page content).
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

  const rot = (await window.pdfusion.core.pageRotation(docId, page)) ?? 0

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

  // When the primary font cannot encode the new text (e.g. CJK input into a
  // Western document), fall back to the bundled Noto Sans TC.
  const drawFont = await pm.withDoc((doc: PDFDocument) => pickTextFont(doc, font, newText))

  pm.withDoc((doc) => {
    const pdfPage = doc.getPage(page)
    // pdf-lib sizes are the UNROTATED MediaBox.
    const W = pdfPage.getWidth()
    const H = pdfPage.getHeight()

    // 1. Cover the old text (slightly expanded in view space, then converted).
    const pr = viewRectToPdf(rot, W, H, {
      x: item.x - 1,
      y: item.y - 1,
      w: item.width + 2,
      h: item.height + 2
    })
    pdfPage.drawRectangle({
      x: pr.x,
      y: pr.y,
      width: pr.w,
      height: pr.h,
      color: rgb(1, 1, 1)
    })

    // 2. Draw the replacement text (multi-line support via \n).
    const size = item.fontSize > 0 ? item.fontSize : item.height / 1.2
    const lines = newText.split('\n')
    try {
      if (rot === 0) {
        const lineHeight = size * 1.25
        const pdfTop = H - pr.y - pr.h // PDF top-left y of the converted rect
        lines.forEach((line, i) => {
          const top = pdfTop + 2 + i * lineHeight
          pdfPage.drawText(line, {
            x: pr.x + 2,
            y: H - top - size, // baseline
            size,
            font: drawFont,
            color: rgb(0, 0, 0)
          })
        })
      } else {
        // Rotated page: raw content stream so text reads in view orientation.
        drawRotatedText(doc, pdfPage, drawFont, rot, W, H, item.x + 1, item.y + 1, lines, size, [0, 0, 0])
      }
    } catch (err) {
      throw new Error(`繪製新文字失敗：${String(err)}`
      )
    }
  })
}
