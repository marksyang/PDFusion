import { describe, expect, it } from 'vitest'
import { hitTest, inkBounds, normalizeRect } from '../src/renderer/src/annotations/AnnotationModel'

describe('normalizeRect', () => {
  it('normalizes reversed corners', () => {
    const r = normalizeRect(50, 60, 10, 20)
    expect(r).toEqual({ x: 10, y: 20, w: 40, h: 40 })
  })

  it('keeps forward corners', () => {
    const r = normalizeRect(1, 2, 3, 4)
    expect(r).toEqual({ x: 1, y: 2, w: 2, h: 2 })
  })
})

describe('inkBounds', () => {
  it('computes bounding box', () => {
    const b = inkBounds([
      { x: 5, y: 7 },
      { x: 1, y: 9 },
      { x: 3, y: 2 }
    ])
    expect(b).toEqual({ x: 1, y: 2, w: 4, h: 7 })
  })
})

describe('hitTest', () => {
  it('hits inside a rect annotation with padding', () => {
    const ann = { id: 'a1', type: 'rect' as const, page: 0, rect: { x: 10, y: 10, w: 100, h: 50 } }
    expect(hitTest(ann, 20, 20)).toBe(true)
    expect(hitTest(ann, 9.5, 20)).toBe(true) // within padding
    expect(hitTest(ann, 5, 20)).toBe(false)
  })

  it('hits ink via its bounds', () => {
    const ann = {
      id: 'a2',
      type: 'ink' as const,
      page: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 40 }
      ]
    }
    expect(hitTest(ann, 30, 25)).toBe(true)
    expect(hitTest(ann, 90, 90)).toBe(false)
  })
})
