import { describe, it, expect } from 'vitest'
import { viewRectToPdf, viewPointToPdf } from '../src/renderer/src/textedit/Rotation'

/**
 * Rotation transform tests.
 *
 * Geometry: unrotated MediaBox W=100 x H=200.
 * View sizes: rot 0/180 → 100x200, rot 90/270 → 200x100.
 * A view rect {x:30, y:40, w:50, h:20} must map back into a sane PDF-space
 * rect (inside the MediaBox, sensible dimensions), and round-trip with the
 * inverse PDF→view mapping.
 */

const W = 100
const H = 200

// Reference inverse (PDF→view) straight from the geometry definitions.
function pdfRectToView(rot: number, r: { x: number; y: number; w: number; h: number }) {
  switch (rot) {
    case 90:
      return { x: r.y, y: r.x, w: r.h, h: r.w }
    case 180:
      return { x: W - r.x - r.w, y: r.y, w: r.w, h: r.h }
    case 270:
      return { x: H - r.y - r.h, y: W - r.x - r.w, w: r.h, h: r.w }
    default:
      return { x: r.x, y: H - r.y - r.h, w: r.w, h: r.h }
  }
}

for (const rot of [0, 90, 180, 270]) {
  describe(`rot=${rot}`, () => {
    const [vw, vh] = rot === 90 || rot === 270 ? [H, W] : [W, H]

    it('rect round-trips through the inverse mapping', () => {
      const view = { x: 30, y: 40, w: 50, h: 20 }
      const pdf = viewRectToPdf(rot, W, H, view)
      // PDF rect must lie inside the unrotated MediaBox
      expect(pdf.x).toBeGreaterThanOrEqual(-0.001)
      expect(pdf.y).toBeGreaterThanOrEqual(-0.001)
      expect(pdf.x + pdf.w).toBeLessThanOrEqual(W + 0.001)
      expect(pdf.y + pdf.h).toBeLessThanOrEqual(H + 0.001)
      // And mapping back must reproduce the view rect
      expect(pdfRectToView(rot, pdf)).toEqual({
        x: expect.closeTo(view.x, 1e-9),
        y: expect.closeTo(view.y, 1e-9),
        w: expect.closeTo(view.w, 1e-9),
        h: expect.closeTo(view.h, 1e-9)
      })
    })

    it('point round-trips (corners)', () => {
      for (const p of [{ x: 0, y: 0 }, { x: vw, y: 0 }, { x: 0, y: vh }, { x: vw / 2, y: vh / 3 }]) {
        const pdf = viewPointToPdf(rot, W, H, p)
        expect(pdf.x).toBeGreaterThanOrEqual(-0.001)
        expect(pdf.y).toBeGreaterThanOrEqual(-0.001)
        expect(pdf.x).toBeLessThanOrEqual(W + 0.001)
        expect(pdf.y).toBeLessThanOrEqual(H + 0.001)
      }
    })
  })
}
