import { PDFDocument, PDFFont } from 'pdf-lib'

/**
 * CjkFont — fallback font for text the document's fonts cannot encode.
 *
 * The bundled Noto Sans TC (SIL OFL, resources/fonts/) is embedded on demand.
 * pdf-lib + fontkit subset the font to the glyphs actually used, so saved PDFs
 * stay small.
 */

let cachedBytes: ArrayBuffer | null = null

async function cjkFontBytes(): Promise<ArrayBuffer> {
  if (cachedBytes) return cachedBytes
  const raw = await window.pdfusion.fonts.cjk()
  cachedBytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
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
  return doc.embedFont(await cjkFontBytes())
}
