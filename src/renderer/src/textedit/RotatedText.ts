import { PDFOperator, PDFNumber } from 'pdf-lib'
import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib'
import { viewPointToPdf } from './Rotation'

/**
 * RotatedText — draws text so it reads in the VIEW orientation on pages with
 * /Rotate 90/180/270.
 *
 * pdf-lib's high-level drawText() cannot rotate text, so we append a raw
 * content stream with a rotation matrix (cm) via the low-level page node:
 *
 *   q  a b c d px py cm  BT  /F <size> Tf  <hex> Tj  ET  Q
 *
 * where (a b c d) maps view axes to PDF axes and (px py) is the baseline
 * start point in PDF space.
 */

// Local (view) → PDF 2×2 text matrix per /Rotate value.
// Derived from the empirical pdfium view mappings (top-left view origin):
//   R=0:   (x_v, y_v) = (x_p, H - y_p)
//   R=90:  (x_v, y_v) = (y_p, x_p)
//   R=180: (x_v, y_v) = (W - x_p, y_p)
//   R=270: (x_v, y_v) = (H - y_p, W - x_p)
// Matrix maps text-space +x (baseline direction) to the view-right direction
// in PDF space, and text-space +y (glyph up) to the view-up direction.
const MAT: Record<number, [number, number, number, number]> = {
  0: [1, 0, 0, 1],
  90: [0, 1, -1, 0],
  180: [-1, 0, 0, -1],
  270: [0, -1, 1, 0]
}

interface PDFPageLow {
  node: {
    newFontDictionary(tag: string, fontRef: unknown): { encodedName: string }
    addContentStream(ref: unknown): void
  }
}

/**
 * Draw `lines` at the given VIEW-space origin (top-left of the text block).
 * W/H are the UNROTATED MediaBox dimensions. Throws if the font cannot encode
 * the text (e.g. CJK glyphs in a Western font).
 */
export function drawRotatedText(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  rot: number,
  W: number,
  H: number,
  viewX: number,
  viewTopY: number,
  lines: string[],
  fontSize: number,
  color: [number, number, number]
): void {
  const node = (page as unknown as PDFPageLow).node
  if (!node) throw new Error('pdf-lib page node unavailable (need pdf-lib >= 1.16)')

  const fontName = node.newFontDictionary('F', (font as unknown as { ref: unknown }).ref)
  const lineHeight = fontSize * 1.25
  const [a, b, c, d] = MAT[rot] ?? MAT[0]
  const N = (v: number) => PDFNumber.of(v)

  const ops: ReturnType<typeof PDFOperator.of>[] = []
  // The d.ts types the name as a fixed enum; we use plain operator names.
  const of = PDFOperator.of as unknown as (name: string, args?: unknown[]) => (typeof ops)[number]
  const push = (name: string, args: unknown[] = []) => ops.push(of(name, args))

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    // Baseline in view space: top of line + ascent (use full em to match the
    // look of the non-rotated drawText path).
    const baselineViewY = viewTopY + i * lineHeight + fontSize
    const p = viewPointToPdf(rot, W, H, { x: viewX, y: baselineViewY })
    push('q')
    push('cm', [N(a), N(b), N(c), N(d), N(p.x), N(p.y)])
    push('rg', [N(color[0]), N(color[1]), N(color[2])])
    push('BT')
    push('Tf', [fontName, N(fontSize)])
    const encoded = font.encodeText(line) // PDFHexString; throws on unsupported glyphs
    push('Tj', [encoded])
    push('ET')
    push('Q')
  }

  if (ops.length === 0) return
  // context.contentStream() + register() → Flate-compressed INDIRECT stream,
  // which PDFium renders reliably (inline streams in /Contents arrays do not
  // render in PDFium).
  const cs = doc.context.contentStream(ops as never)
  node.addContentStream(doc.context.register(cs))
}
