/**
 * Rotation-aware coordinate transforms.
 *
 * View space  = the rendered bitmap (page /Rotate applied), top-left origin.
 * PDF space   = unrotated MediaBox, bottom-left origin (pdf-lib user space).
 *
 * W/H passed in must be the UNROTATED MediaBox dimensions.
 */

export interface VRect {
  x: number
  y: number
  w: number
  h: number
}

export interface VPoint {
  x: number
  y: number
}

/** View rect → PDF rect. */
export function viewRectToPdf(rot: number, W: number, H: number, r: VRect): VRect {
  switch (rot) {
    case 90:
      return { x: r.y, y: r.x, w: r.h, h: r.w }
    case 180:
      return { x: W - r.x - r.w, y: r.y, w: r.w, h: r.h }
    case 270:
      return { x: W - r.y - r.h, y: H - r.x - r.w, w: r.h, h: r.w }
    case 0:
    default:
      return { x: r.x, y: H - r.y - r.h, w: r.w, h: r.h }
  }
}

/** View point → PDF point. */
export function viewPointToPdf(rot: number, W: number, H: number, p: VPoint): VPoint {
  switch (rot) {
    case 90:
      return { x: p.y, y: p.x }
    case 180:
      return { x: W - p.x, y: p.y }
    case 270:
      return { x: W - p.y, y: H - p.x }
    case 0:
    default:
      return { x: p.x, y: H - p.y }
  }
}
