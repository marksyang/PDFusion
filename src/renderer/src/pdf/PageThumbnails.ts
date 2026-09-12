/**
 * PageThumbnails — left sidebar with page thumbnails (rendered by the Rust
 * core) and page numbers. Clicking a thumbnail scrolls to that page;
 * thumbnails can be drag-reordered.
 */
export class PageThumbnails {
  private sidebar: HTMLElement
  private onPick: (index: number) => void
  private onReorder: (from: number, to: number) => void

  constructor(
    sidebar: HTMLElement,
    onPick: (index: number) => void,
    onReorder: (from: number, to: number) => void
  ) {
    this.sidebar = sidebar
    this.onPick = onPick
    this.onReorder = onReorder

    this.sidebar.addEventListener('dragover', (e) => {
      e.preventDefault()
    })
    this.sidebar.addEventListener('drop', (e) => {
      e.preventDefault()
      const from = Number(e.dataTransfer?.getData('text/x-pdfusion-page'))
      if (Number.isNaN(from)) return
      const to = this.insertIndexAtY(e.clientY)
      // `to` is an insertion index in the original list (before item `to`).
      if (to !== from && to !== from + 1) this.onReorder(from, to)
    })
  }

  private insertIndexAtY(clientY: number): number {
    const items = Array.from(this.sidebar.querySelectorAll<HTMLElement>('.thumb-item'))
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return items.length
  }

  async setDocument(docId: number | null, pageCount: number): Promise<void> {
    this.sidebar.innerHTML = ''
    if (docId === null || pageCount === 0) return

    for (let i = 0; i < pageCount; i++) {
      const item = document.createElement('div')
      item.className = 'thumb-item'
      item.draggable = true
      item.dataset.index = String(i)
      const canvas = document.createElement('canvas')
      canvas.className = 'thumb-canvas'
      const label = document.createElement('span')
      label.className = 'thumb-label'
      label.textContent = String(i + 1)
      item.appendChild(canvas)
      item.appendChild(label)
      item.addEventListener('click', () => this.onPick(i))
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/x-pdfusion-page', String(i))
        e.dataTransfer!.effectAllowed = 'move'
      })
      this.sidebar.appendChild(item)

      try {
        const page = await window.pdfusion.core.renderThumbnail(docId, i, 160)
        const ctx = canvas.getContext('2d')!
        canvas.width = page.width
        canvas.height = page.height
        const pixels = new Uint8ClampedArray(page.rgba.buffer, page.rgba.byteOffset, page.width * page.height * 4)
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), page.width, page.height), 0, 0)
      } catch {
        label.textContent = '!'
      }
    }
  }

  clear(): void {
    this.sidebar.innerHTML = ''
  }
}
