import { PDFDocument, PDFFont } from 'pdf-lib'

/**
 * CjkFont — fallback font for text the document's fonts cannot encode.
 *
 * The bundled Noto Sans TC (SIL OFL, resources/fonts/) is embedded on demand.
 * pdf-lib + fontkit subset the font to the glyphs actually used, so saved PDFs
 * stay small.
 */

let cachedBytes: Uint8Array | null = null

async function cjkFontBytes(): Promise<Uint8Array> {
  if (cachedBytes) return cachedBytes
  // fontkit (1.8.x, required by pdf-lib's subset embedder) probes typed-array
  // bytes; a bare ArrayBuffer is not recognized, so keep it as Uint8Array.
  const raw = await window.pdfusion.fonts.cjk()
  const copy = new Uint8Array(raw.byteLength)
  copy.set(raw)
  cachedBytes = copy
  return cachedBytes
}

/** True when `font` cannot encode `text` (e.g. WinAnsi font + CJK chars). */
export function textNeedsFallback(font: PDFFont, text: string): boolean {
  if (text.length === 0) return false
  try {
    font.encodeText(text)
    return false
  } catch {
    return true
  }
}

/**
 * Pick a font for `text`: keep `primary` when it can encode the text,
 * otherwise embed and return the bundled CJK font.
 */
export async function pickTextFont(doc: PDFDocument, primary: PDFFont, text: string): Promise<PDFFont> {
  if (!textNeedsFallback(primary, text)) return primary
  // subset: the full Noto Sans TC is ~5.4MB; a subset of the baked glyphs is
  // tens of KB. (Requires fontkit 1.8.x — pdf-lib's subset embedder is
  // incompatible with fontkit ≥1.9.)
  return doc.embedFont(await cjkFontBytes(), { subset: true })
}
