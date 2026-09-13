/**
 * AnnotationModel — JSON schema for in-app annotations.
 * Coordinates are PDF points with top-left origin (matching core text/search rects).
 */

export type Tool = 'select' | 'highlight' | 'freetext' | 'edit' | 'eraser' | 'rect' | 'ellipse' | 'ink'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface BaseAnnotation {
  id: string
  page: number
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight'
  rect: Rect
}

export interface FreeTextAnnotation extends BaseAnnotation {
  type: 'freetext'
  rect: Rect
  text: string
  fontSize: number
}

export interface RectAnnotation extends BaseAnnotation {
  type: 'rect'
  rect: Rect
}

export interface EllipseAnnotation extends BaseAnnotation {
  type: 'ellipse'
  rect: Rect
}

export interface InkAnnotation extends BaseAnnotation {
  type: 'ink'
  points: Array<{ x: number; y: number }>
}

export type Annotation =
  | HighlightAnnotation
  | FreeTextAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | InkAnnotation

let counter = 0

export function nextId(): string {
  counter += 1
  return `ann-${Date.now().toString(36)}-${counter}`
}

/** Normalized rect from two drag corners (points, top-left origin). */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0)
  }
}

export function inkBounds(points: Array<{ x: number; y: number }>): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Hit-test an annotation at a point (PDF points). */
export function hitTest(ann: Annotation, px: number, py: number, pad = 3): boolean {
  const r = ann.type === 'ink' ? inkBounds(ann.points) : ann.rect
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad
}
