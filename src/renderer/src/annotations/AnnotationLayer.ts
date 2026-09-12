import { PT_TO_CSS } from '../pdf/PdfViewer'
import {
  hitTest,
  inkBounds,
  nextId,
  normalizeRect
} from './AnnotationModel'
import type { Annotation, FreeTextAnnotation, Rect } from './AnnotationModel'
import { annStore } from './AnnotationState'

const COLORS = {
  highlight: 'rgba(255, 224, 0, 0.42)',
  freetext: '#111111',
  shape: '#1a73e8',
  ink: '#d93025',
  selected: '#ff3b30'
}

/**
 * AnnotationLayer — interactive annotation overlay (one canvas per page) on
 * top of the viewer's page wrappers. Coordinates are stored in PDF points
 * (top-left origin) and drawn scaled by the current zoom.
 */
export class AnnotationLayer {
  private viewerEl: HTMLElement
  private canvases = new Map<number, HTMLCanvasElement>()
  private dpr: number
  private temp: { type: string; page: number; sx: number; sy: number; cx: number; cy: number; points?: Array<{ x: number; y: number }> } | null = null
  private unsubscribe: (() => void) | null = null
  onEditClick: ((page: number, x: number, y: number) => void) | null = null
  private onKey: (e: KeyboardEvent) => void
  private onPageRendered: (() => void) | null = null

  constructor(viewerEl: HTMLElement) {
    this.viewerEl = viewerEl
    this.dpr = window.devicePixelRatio || 1
    this.onKey = (e) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && annStore.getState().selectedId) {
        e.preventDefault()
        annStore.getState().remove(annStore.getState().selectedId!)
      }
    }
  }

  attach(): void {
    document.addEventListener('keydown', this.onKey)
    this.unsubscribe = annStore.subscribe(() => this.redraw())
    this.onPageRendered = () => this.redraw()
    this.viewerEl.addEventListener('page-rendered', this.onPageRendered)
  }

  setDocument(pageCount: number): void {
    // The viewer must have created the page wraps already.
    this.canvases.clear()
    const wraps = Array.from(this.viewerEl.querySelectorAll<HTMLElement>('.page-wrap'))
    wraps.forEach((wrap, i) => {
      if (i >= pageCount) return
      let canvas = wrap.querySelector<HTMLCanvasElement>('.annot-canvas')
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.className = 'annot-canvas'
        wrap.appendChild(canvas)
      }
      this.bindEvents(canvas, i)
      this.canvases.set(i, canvas)
    })
    annStore.getState().clear()
  }

  setZoom(zoom: number): void {
    this.zoomValue = zoom
    this.redraw()
  }

  private zoomValue = 1.0

  private zoom(): number {
    return this.zoomValue
  }

  private bindEvents(canvas: HTMLCanvasElement, page: number): void {
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        const p = this.toPdf(e, canvas)
        const tool = annStore.getState().tool
        if (tool === 'edit') {
          this.onEditClick?.(page, p.x, p.y)
          return
        }
        if (tool === 'select') {
          const anns = annStore.getState().annotations.filter((a) => a.page === page)
          let found: string | null = null
          for (let i = anns.length - 1; i >= 0; i--) {
            if (hitTest(anns[i], p.x, p.y)) {
              found = anns[i].id
              break
            }
          }
          annStore.getState().select(found)
          return
        }
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {
          // Synthetic (test) events may have no active pointer.
        }
        if (tool === 'ink') {
          this.temp = { type: 'ink', page, sx: p.x, sy: p.y, cx: p.x, cy: p.y, points: [p] }
        } else {
          this.temp = { type: tool, page, sx: p.x, sy: p.y, cx: p.x, cy: p.y }
        }
      },
      { once: false }
    )

    canvas.addEventListener('pointermove', (e) => {
      if (!this.temp || this.temp.page !== page) return
      const p = this.toPdf(e, canvas)
      if (this.temp.type === 'ink' && this.temp.points) {
        const last = this.temp.points[this.temp.points.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) this.temp.points.push(p)
      } else {
        this.temp.cx = p.x
        this.temp.cy = p.y
      }
      this.redraw()
    })

    canvas.addEventListener('pointerup', (e) => {
      if (!this.temp || this.temp.page !== page) return
      const t = this.temp
      this.temp = null
      const p = this.toPdf(e, canvas)
      if (t.type === 'ink') {
        if (t.points && t.points.length > 1) {
          annStore.getState().add({ id: nextId(), type: 'ink', page, points: t.points })
        }
      } else if (t.type === 'freetext') {
        const rect = normalizeRect(t.sx, t.sy, p.x, p.y)
        this.openFreetextInput(canvas, page, rect)
      } else {
        const rect = normalizeRect(t.sx, t.sy, p.x, p.y)
        if (rect.w < 3 || rect.h < 3) return
        annStore.getState().add({ id: nextId(), type: t.type, page, rect } as Annotation)
      }
      this.redraw()
    })
  }

  private openFreetextInput(canvas: HTMLCanvasElement, page: number, rect: Rect): void {
    const wrap = canvas.parentElement as HTMLElement
    const s = PT_TO_CSS * this.zoom()
    const input = document.createElement('input')
    input.className = 'freetext-input'
    input.style.left = `${rect.x * s}px`
    input.style.top = `${rect.y * s}px`
    input.style.width = `${Math.max(rect.w, 120) * s}px`
    input.style.fontSize = `${13 * s}px`
    wrap.appendChild(input)
    input.focus()
    const commit = () => {
      const text = input.value.trim()
      if (text) {
        const ann: FreeTextAnnotation = {
          id: nextId(),
          type: 'freetext',
          page,
          rect,
          text,
          fontSize: 13
        }
        annStore.getState().add(ann)
      }
      input.remove()
      this.redraw()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
      else if (e.key === 'Escape') {
        input.remove()
      }
    })
    input.addEventListener('blur', commit)
  }

  private toPdf(e: PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const r = canvas.getBoundingClientRect()
    const s = PT_TO_CSS * this.zoom()
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }
  }

  redraw(): void {
    const { annotations, selectedId } = annStore.getState()
    const s = PT_TO_CSS * this.zoom()
    for (const [page, canvas] of this.canvases) {
      const wrap = canvas.parentElement as HTMLElement
      const cssW = wrap.clientWidth
      const cssH = wrap.clientHeight
      if (cssW === 0 || cssH === 0) continue
      const w = Math.round(cssW * this.dpr)
      const h = Math.round(cssH * this.dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, 0, 0)
      ctx.clearRect(0, 0, cssW / s, cssH / s)

      for (const ann of annotations) {
        if (ann.page !== page) continue
        this.drawAnn(ctx, ann, ann.id === selectedId)
      }
      if (this.temp && this.temp.page === page) {
        const s2 = this.temp
        ctx.save()
        if (s2.type === 'ink' && s2.points) {
          ctx.strokeStyle = COLORS.ink
          ctx.lineWidth = 2
          ctx.lineJoin = 'round'
          ctx.beginPath()
          s2.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
          ctx.stroke()
        } else if (s2.type === 'freetext') {
          ctx.strokeStyle = COLORS.shape
          ctx.setLineDash([4, 3])
          ctx.strokeRect(s2.sx, s2.sy, s2.cx - s2.sx, s2.cy - s2.sy)
          ctx.setLineDash([])
        } else {
          const r = normalizeRect(s2.sx, s2.sy, s2.cx, s2.cy)
          if (s2.type === 'highlight') {
            ctx.fillStyle = COLORS.highlight
            ctx.fillRect(r.x, r.y, r.w, r.h)
          } else if (s2.type === 'ellipse') {
            ctx.strokeStyle = COLORS.shape
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
            ctx.stroke()
          } else {
            ctx.strokeStyle = COLORS.shape
            ctx.lineWidth = 2
            ctx.strokeRect(r.x, r.y, r.w, r.h)
          }
        }
        ctx.restore()
      }
    }
  }

  private drawAnn(ctx: CanvasRenderingContext2D, ann: Annotation, selected: boolean): void {
    ctx.save()
    switch (ann.type) {
      case 'highlight':
        ctx.fillStyle = COLORS.highlight
        ctx.fillRect(ann.rect.x, ann.rect.y, ann.rect.w, ann.rect.h)
        break
      case 'freetext':
        ctx.fillStyle = COLORS.freetext
        ctx.font = `${ann.fontSize}px -apple-system, 'Segoe UI', sans-serif`
        ctx.textBaseline = 'top'
        this.drawWrappedText(ctx, ann.text, ann.rect)
        break
      case 'rect':
        ctx.strokeStyle = COLORS.shape
        ctx.lineWidth = 2
        ctx.strokeRect(ann.rect.x, ann.rect.y, ann.rect.w, ann.rect.h)
        break
      case 'ellipse':
        ctx.strokeStyle = COLORS.shape
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.ellipse(ann.rect.x + ann.rect.w / 2, ann.rect.y + ann.rect.h / 2, ann.rect.w / 2, ann.rect.h / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'ink':
        ctx.strokeStyle = COLORS.ink
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ann.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
        ctx.stroke()
        break
    }
    if (selected) {
      const r = ann.type === 'ink' ? inkBounds(ann.points) : ann.rect
      ctx.strokeStyle = COLORS.selected
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
      ctx.setLineDash([])
    }
    ctx.restore()
  }

  private drawWrappedText(ctx: CanvasRenderingContext2D, text: string, rect: Rect): void {
    const lines = text.split('\n')
    const lineHeight = 14
    let y = rect.y + 2
    for (const line of lines) {
      // Naive word wrap by measured width.
      let x = rect.x + 2
      for (const word of line.split(' ')) {
        const w = ctx.measureText(word).width
        if (x + w > rect.x + rect.w - 2 && x > rect.x + 2) {
          x = rect.x + 2
          y += lineHeight
        }
        ctx.fillText(word, x, y)
        x += w + 4
      }
      y += lineHeight
    }
  }
}
