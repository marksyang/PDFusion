/**
 * PdfViewer — renders document pages (via Rust/PDFium core) into a vertical
 * scroll container. Pages are rasterized lazily when scrolled into view, with
 * a per-scale render cache. Each page is wrapped in .page-wrap holding an
 * overlay layer for search-hit highlights.
 */
export const PT_TO_CSS = 96 / 72 // 1pt = 1/72in; CSS px = 1/96in

interface PageEntry {
  wrap: HTMLElement
  canvas: HTMLCanvasElement
  layer: HTMLElement
}

export class PdfViewer {
  private container: HTMLElement
  private observer: IntersectionObserver | null = null
  private pages = new Map<number, PageEntry>()
  private renderCache = new Map<string, HTMLCanvasElement>()
  private inflight = new Map<string, Promise<void>>()

  private docId: number | null = null
  private zoom = 1.0
  private dpr: number
  private onVisiblePage?: (index: number) => void

  constructor(container: HTMLElement) {
    this.container = container
    this.dpr = window.devicePixelRatio || 1
  }

  setOnVisiblePage(cb: (index: number) => void): void {
    this.onVisiblePage = cb
  }

  setDocument(docId: number | null, pageCount: number): void {
    this.docId = docId
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.container.innerHTML = ''
    this.pages.clear()
    this.renderCache.clear()
    this.inflight.clear()
    if (docId === null || pageCount === 0) return

    for (let i = 0; i < pageCount; i++) {
      const wrap = document.createElement('div')
      wrap.className = 'page-wrap'
      const canvas = document.createElement('canvas')
      canvas.className = 'page-canvas'
      const layer = document.createElement('div')
      layer.className = 'hit-layer'
      wrap.appendChild(canvas)
      wrap.appendChild(layer)
      this.container.appendChild(wrap)
      this.pages.set(i, { wrap, canvas, layer })
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const wrap = entry.target as HTMLElement
          const index = Number(wrap.dataset.page)
          void this.renderPage(index).catch(() => {})
        }
      },
      { root: this.container, rootMargin: '900px 0px' }
    )
    this.observer = observer
    this.pages.forEach((entry, index) => {
      entry.wrap.dataset.page = String(index)
      observer.observe(entry.wrap)
    })
  }

  setZoom(zoom: number): void {
    this.zoom = zoom
    this.renderCache.clear()
    this.inflight.clear()
    if (this.docId === null) return
    // Re-render pages near the viewport; others on scroll.
    this.pages.forEach((_entry, index) => {
      void this.renderPage(index).catch(() => {})
    })
  }

  /** Current zoom (for hit rect geometry). */
  get currentZoom(): number {
    return this.zoom
  }

  /** Replace search-hit rectangles for one page (PDF points, top-left origin). */
  setHits(index: number, rects: Array<{ x: number; y: number; width: number; height: number }>): void {
    const entry = this.pages.get(index)
    if (!entry) return
    entry.layer.innerHTML = ''
    const s = PT_TO_CSS * this.zoom
    for (const r of rects) {
      const box = document.createElement('div')
      box.className = 'hit-box'
      box.style.left = `${r.x * s}px`
      box.style.top = `${r.y * s}px`
      box.style.width = `${r.width * s}px`
      box.style.height = `${r.height * s}px`
      box.dataset.key = `${(r.x * s).toFixed(1)}:${(r.y * s).toFixed(1)}`
      entry.layer.appendChild(box)
    }
  }

  clearHits(): void {
    this.pages.forEach((entry) => (entry.layer.innerHTML = ''))
  }

  setActiveHit(index: number, rect: { x: number; y: number; width: number; height: number } | null): void {
    const entry = this.pages.get(index)
    if (!entry) return
    entry.layer.querySelectorAll('.hit-box.active').forEach((el) => el.classList.remove('active'))
    if (!rect) return
    const s = PT_TO_CSS * this.zoom
    const wanted = `${(rect.x * s).toFixed(1)}:${(rect.y * s).toFixed(1)}`
    entry.layer.querySelectorAll<HTMLElement>('.hit-box').forEach((box) => {
      if (box.dataset.key === wanted) box.classList.add('active')
    })
  }

  private key(index: number): string {
    return `${index}:${(this.zoom * this.dpr).toFixed(3)}`
  }

  private async renderPage(index: number): Promise<void> {
    if (this.docId === null) return
    const entry = this.pages.get(index)
    if (!entry) return
    const key = this.key(index)
    if (this.renderCache.has(key)) {
      this.blit(entry.canvas, this.renderCache.get(key)!)
      return
    }
    if (this.inflight.has(key)) {
      await this.inflight.get(key)
      const cached = this.renderCache.get(key)
      if (cached && this.pages.get(index)?.canvas === entry.canvas) this.blit(entry.canvas, cached)
      return
    }

    const docId = this.docId
    const scale = PT_TO_CSS * this.zoom * this.dpr
    const task = (async () => {
      try {
        const page = await window.pdfusion.core.renderPage(docId, index, scale)
        const off = document.createElement('canvas')
        off.width = page.width
        off.height = page.height
        const ctx = off.getContext('2d')!
        const pixels = new Uint8ClampedArray(page.rgba.buffer, page.rgba.byteOffset, page.width * page.height * 4)
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), page.width, page.height), 0, 0)
        this.renderCache.set(key, off)
        if (this.pages.get(index)?.canvas === entry.canvas) this.blit(entry.canvas, off)
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, task)
    await task
  }

  private blit(target: HTMLCanvasElement, source: HTMLCanvasElement): void {
    target.width = source.width
    target.height = source.height
    target.style.width = `${source.width / this.dpr}px`
    target.style.height = `${source.height / this.dpr}px`
    const ctx = target.getContext('2d')!
    ctx.drawImage(source, 0, 0)
    // Notify overlay layers (annotations) that the page wrap size is ready.
    requestAnimationFrame(() => this.container.dispatchEvent(new CustomEvent('page-rendered')))
  }

  scrollPageIntoView(index: number): void {
    this.pages.get(index)?.wrap.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  /** Index of the page closest to the vertical center of the viewport. */
  visiblePage(): number {
    if (this.pages.size === 0) return 0
    const top = this.container.getBoundingClientRect().top
    const middle = top + this.container.clientHeight / 2
    let best = 0
    let bestDist = Infinity
    this.pages.forEach((entry, index) => {
      const r = entry.wrap.getBoundingClientRect()
      const center = r.top + r.height / 2
      const dist = Math.abs(center - middle)
      if (dist < bestDist) {
        bestDist = dist
        best = index
      }
    })
    return best
  }
}
