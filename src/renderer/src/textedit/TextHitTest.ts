import type { TextItem } from '../global'

/**
 * TextHitTest — find the text segment under a point (PDF points, top-left origin)
 * by querying the Rust core's text extraction.
 */

const PAD = 1.5 // points of tolerance

export interface HitResult {
  item: TextItem
}

export async function hitTextSegment(
  docId: number,
  page: number,
  x: number,
  y: number
): Promise<HitResult | null> {
  const items = await window.pdfusion.core.getTextItems(docId, page)
  // Prefer the most recently drawn (top-most) matching segment.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (
      x >= it.x - PAD &&
      x <= it.x + it.width + PAD &&
      y >= it.y - PAD &&
      y <= it.y + it.height + PAD
    ) {
      return { item: it }
    }
  }
  return null
}
