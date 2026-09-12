import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { PageManager } from '../pageops/PageManager'
import type { Annotation } from './AnnotationModel'

/**
 * BakeToPdf — burns in-app annotations into the page content of the working
 * PDF document. pdf-lib has no annotation-writing API, so shapes are drawn
 * directly onto the page; the result renders identically in every viewer.
 */

const HIGHLIGHT = rgb(1, 0.878, 0)
const SHAPE = rgb(0.102, 0.451, 0.91)
const INK = rgb(0.851, 0.188, 0.145)
const TEXT = rgb(0.07, 0.07, 0.07)

/** Rough wrap for Helvetica-like metrics (avg char ≈ 0.52em). */
function wrapText(text: string, width: number, fontSize: number): string[] {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    let current = ''
    for (const word of raw.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (candidate.length * fontSize * 0.52 > width - 4 && current) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }
  return lines.filter((l) => l.length > 0)
}

/**
 * Burn all annotations into the working document in-place.
 * Font: Helvetica (standard) — embedded lazily by pdf-lib on save.
 */
export async function bakeAnnotations(pm: PageManager, annotations: Annotation[]): Promise<void> {
  if (annotations.length === 0) return

  const font: PDFFont = await pm.withDoc((doc: PDFDocument) => doc.embedFont(StandardFonts.Helvetica))

  pm.withDoc((doc: PDFDocument) => {
    for (const ann of annotations) {
      const page = doc.getPage(ann.page)
      const H = page.getHeight()
      // app coords: top-left origin (PDF points) → pdf-lib: bottom-left origin
      const yTop = (y: number): number => H - y

      switch (ann.type) {
        case 'highlight':
          page.drawRectangle({
            x: ann.rect.x,
            y: yTop(ann.rect.y + ann.rect.h),
            width: ann.rect.w,
            height: ann.rect.h,
            color: HIGHLIGHT,
            opacity: 0.42
          })
          break

        case 'rect':
          page.drawRectangle({
            x: ann.rect.x,
            y: yTop(ann.rect.y + ann.rect.h),
            width: ann.rect.w,
            height: ann.rect.h,
            borderColor: SHAPE,
            borderWidth: 2
          })
          break

        case 'ellipse':
          page.drawEllipse({
            x: ann.rect.x + ann.rect.w / 2,
            y: yTop(ann.rect.y + ann.rect.h / 2),
            xScale: ann.rect.w / 2,
            yScale: ann.rect.h / 2,
            borderColor: SHAPE,
            borderWidth: 2
          })
          break

        case 'ink': {
          const pts = ann.points
          for (let i = 1; i < pts.length; i++) {
            page.drawLine({
              start: { x: pts[i - 1].x, y: yTop(pts[i - 1].y) },
              end: { x: pts[i].x, y: yTop(pts[i].y) },
              thickness: 2,
              color: INK
            })
          }
          break
        }

        case 'freetext': {
          const lines = wrapText(ann.text, ann.rect.w, ann.fontSize)
          const lineHeight = ann.fontSize * 1.25
          lines.forEach((line, i) => {
            const top = ann.rect.y + 2 + i * lineHeight
            page.drawText(line, {
              x: ann.rect.x + 2,
              y: H - top - ann.fontSize, // baseline (bottom-left coords)
              size: ann.fontSize,
              font,
              color: TEXT
            })
          })
          break
        }
      }
    }
  })
}
