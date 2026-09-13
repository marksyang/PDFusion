import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { PageManager } from '../pageops/PageManager'
import type { Annotation, Rect } from './AnnotationModel'
import { viewPointToPdf, viewRectToPdf } from '../textedit/Rotation'

/**
 * BakeToPdf — burns in-app annotations into the page content of the working
 * PDF document. Annotation coordinates are VIEW space (top-left origin, /Rotate
 * applied); they are converted to pdf-lib's unrotated user space per page.
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

import type { PDFPage } from 'pdf-lib'

function drawBakedText(page: PDFPage, pr: Rect, text: string, fontSize: number, font: PDFFont): void {
  const H = page.getHeight()
  // PDF-space top of the converted rect (0 = top of MediaBox).
  const pdfTop = H - pr.y - pr.h
  const lineHeight = fontSize * 1.25
  const lines = wrapText(text, pr.w, fontSize)
  lines.forEach((line, i) => {
    const top = pdfTop + 2 + i * lineHeight
    page.drawText(line, {
      x: pr.x + 2,
      y: H - top - fontSize, // baseline
      size: fontSize,
      font,
      color: TEXT
    })
  })
}

/**
 * Burn all annotations into the working document in-place.
 * `pageRotations` maps page index → /Rotate degrees (0/90/180/270).
 */
export async function bakeAnnotations(
  pm: PageManager,
  annotations: Annotation[],
  pageRotations: (page: number) => Promise<number>
): Promise<void> {
  if (annotations.length === 0) return

  const font: PDFFont = await pm.withDoc((doc: PDFDocument) => doc.embedFont(StandardFonts.Helvetica))

  // Resolve rotations for the pages that actually carry annotations.
  const rotPages = [...new Set(annotations.map((a) => a.page))]
  const rots = new Map<number, number>()
  for (const p of rotPages) rots.set(p, (await pageRotations(p)) ?? 0)

  pm.withDoc((doc: PDFDocument) => {
    for (const ann of annotations) {
      const page = doc.getPage(ann.page)
      // pdf-lib sizes are the UNROTATED MediaBox.
      const W = page.getWidth()
      const H = page.getHeight()
      const rot = rots.get(ann.page) ?? 0

      switch (ann.type) {
        case 'highlight':
        case 'rect': {
          const pr = viewRectToPdf(rot, W, H, ann.rect)
          page.drawRectangle({
            x: pr.x,
            y: pr.y,
            width: pr.w,
            height: pr.h,
            color: ann.type === 'highlight' ? HIGHLIGHT : undefined,
            opacity: ann.type === 'highlight' ? 0.42 : undefined,
            borderColor: ann.type === 'rect' ? SHAPE : undefined,
            borderWidth: ann.type === 'rect' ? 2 : undefined
          })
          break
        }

        case 'ellipse': {
          const pr = viewRectToPdf(rot, W, H, ann.rect)
          page.drawEllipse({
            x: pr.x + pr.w / 2,
            y: pr.y + pr.h / 2,
            xScale: pr.w / 2,
            yScale: pr.h / 2,
            borderColor: SHAPE,
            borderWidth: 2
          })
          break
        }

        case 'ink': {
          const pts = ann.points.map((p) => viewPointToPdf(rot, W, H, p))
          for (let i = 1; i < pts.length; i++) {
            page.drawLine({
              start: pts[i - 1],
              end: pts[i],
              thickness: 2,
              color: INK
            })
          }
          break
        }

        case 'freetext': {
          const pr: Rect = viewRectToPdf(rot, W, H, ann.rect)
          drawBakedText(page, pr, ann.text, ann.fontSize, font)
          break
        }
      }
    }
  })
}
