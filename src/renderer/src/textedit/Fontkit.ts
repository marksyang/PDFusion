import * as fontkitNs from 'fontkit'

/**
 * fontkit factory compatible with pdf-lib 1.17's subset embedder.
 *
 * pdf-lib's CustomFontSubsetEmbedder expects the fontkit 1.x subset API:
 *   subset.includeGlyph(glyph) -> id,  subset.cff,  subset.encodeStream()
 * Modern fontkit (2.x, required for browser-safe format probing) removed
 * `encodeStream()` in favor of `subset.encode() -> bytes`. We wrap the real
 * subset with a tiny browser-safe fake stream that flushes those bytes, and
 * keep everything else (includeGlyph/cff/...) from the real object.
 */
const ns = fontkitNs as unknown as { create?: unknown; default?: unknown }
const realFontkit = (typeof ns.create === 'function' ? fontkitNs : ns.default) as {
  create: (data: ArrayBuffer | Uint8Array) => Promise<any>
}

/** Minimal stand-in for a Node readable stream (browser has none). */
function fakeStream(produce: () => Promise<Uint8Array | ArrayBuffer>): {
  on: (evt: string, cb: (...a: unknown[]) => void) => unknown
} {
  const handlers: Record<string, (...a: unknown[]) => void> = {}
  let flushing = false
  const flush = async (): Promise<void> => {
    if (flushing) return
    flushing = true
    try {
      const raw = await produce()
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : new Uint8Array(raw)
      handlers['data']?.(bytes)
      handlers['end']?.()
    } catch (err) {
      handlers['error']?.(err)
    }
  }
  return {
    on(evt: string, cb: (...a: unknown[]) => void) {
      handlers[evt] = cb
      // Flush once both data and end are registered (pdf-lib attaches all
      // listeners synchronously right after calling encodeStream()).
      if (handlers['data'] && handlers['end']) void flush()
      return this
    }
  }
}

function wrapSubset(real: any): any {
  if (!real || real.__pdfusionWrapped) return real
  // Object.create(real): method/property lookups resolve through the real
  // subset (correct `this` binding for includeGlyph/cff/...), and only
  // encodeStream is overridden.
  const wrapped: any = Object.create(real)
  wrapped.__pdfusionWrapped = true
  wrapped.encodeStream = () =>
    fakeStream(async () => {
      const out = real.encode()
      return out instanceof Promise ? out : out
    })
  return wrapped
}

export const fontkit = {
  ...realFontkit,
  create: async (data: ArrayBuffer | Uint8Array): Promise<any> => {
    const font = await realFontkit.create(data)
    if (font && typeof font.createSubset === 'function') {
      const real = font.createSubset()
      const wrapped = wrapSubset(real)
      // pdf-lib may call createSubset repeatedly; always hand back the same
      // wrapped instance (the real subset holds accumulated glyph state).
      font.createSubset = () => wrapped
    }
    return font
  }
}
