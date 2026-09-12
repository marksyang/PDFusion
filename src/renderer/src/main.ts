import './styles.css'
import { useStore } from './store'
import { PdfViewer, PT_TO_CSS } from './pdf/PdfViewer'
import { PageThumbnails } from './pdf/PageThumbnails'
import { DocController } from './pageops/DocController'
import { AnnotationLayer } from './annotations/AnnotationLayer'
import { annStore } from './annotations/AnnotationState'
import { bakeAnnotations } from './annotations/BakeToPdf'
import { hitTextSegment } from './textedit/TextHitTest'
import { commitTextEdit } from './textedit/CommitText'
import type { Tool } from './annotations/AnnotationModel'
import type { SearchHit } from './global'

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

const viewerEl = document.getElementById('viewer') as HTMLElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const hintEl = document.getElementById('hint') as HTMLSpanElement
const titleEl = document.getElementById('doc-title') as HTMLSpanElement
const pageLabel = document.getElementById('page-label') as HTMLSpanElement
const zoomLabel = document.getElementById('zoom-label') as HTMLSpanElement
const searchInput = document.getElementById('search-input') as HTMLInputElement

const viewer = new PdfViewer(viewerEl)
const annotLayer = new AnnotationLayer(viewerEl)
annotLayer.attach()
const controller = new DocController({
  onDocChanged: (id, name, pageCount) => {
    const current = currentPage()
    useStore.getState().setDoc(id, name, pageCount)
    viewer.clearHits()
    viewer.setDocument(id, pageCount)
    annotLayer.setDocument(pageCount)
    void thumbs.setDocument(id, pageCount)
    gotoPage(Math.min(current, pageCount - 1))
  },
  status: (text) => {
    hintEl.textContent = text
  }
})
const thumbs = new PageThumbnails(
  document.getElementById('thumbs') as HTMLElement,
  (i) => viewer.scrollPageIntoView(i),
  (from, to) => {
    const s = useStore.getState()
    if (s.docId === null) return
    void controller.apply(`重新排序 第${from + 1}頁`, s.docId, s.fileName, () =>
      controller.manager.reorder(from, to)
    )
  }
)

let hits: SearchHit[] = []
let hitIndex = -1

function currentPage(): number {
  return useStore.getState().currentPage
}

async function showDoc(id: number, name: string, pageCount: number): Promise<void> {
  hits = []
  hitIndex = -1
  useStore.getState().setDoc(id, name, pageCount)
  viewer.clearHits()
  viewer.setDocument(id, pageCount)
  annotLayer.setDocument(pageCount)
  void thumbs.setDocument(id, pageCount)
  updatePageLabel()
  try {
    await controller.open(id)
  } catch (err) {
    hintEl.textContent = `頁面操作不可用：${String(err)}`
  }
}

function updatePageLabel(): void {
  const s = useStore.getState()
  pageLabel.textContent = s.docId === null ? '–/–' : `${s.currentPage + 1}/${s.pageCount}`
}

useStore.subscribe((s) => {
  statusEl.textContent = s.statusText
  titleEl.textContent = s.fileName || 'PDFusion'
  zoomLabel.textContent = `${Math.round(s.zoom * 100)}%`
  updatePageLabel()
})

async function openPdf(): Promise<void> {
  const r = await window.pdfusion.fs.open()
  if (!r.ok) return
  await showDoc(r.id, r.name, r.pageCount)
}

// --- zoom ---
function zoomBy(delta: number): void {
  const idx = ZOOMS.indexOf(useStore.getState().zoom)
  const next = Math.min(ZOOMS.length - 1, Math.max(0, (idx === -1 ? 2 : idx) + delta))
  applyZoom(ZOOMS[next])
}

function applyZoom(z: number): void {
  useStore.getState().setZoom(z)
  viewer.setZoom(z)
  annotLayer.setZoom(z)
  redrawHits()
}

// --- navigation ---
function gotoPage(index: number): void {
  const s = useStore.getState()
  if (s.docId === null) return
  const clamped = Math.max(0, Math.min(s.pageCount - 1, index))
  useStore.getState().setCurrentPage(clamped)
  viewer.scrollPageIntoView(clamped)
}

// --- search ---
function redrawHits(): void {
  const s = useStore.getState()
  if (s.docId === null) return
  viewer.clearHits()
  const byPage = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>()
  for (const h of hits) {
    const arr = byPage.get(h.page) ?? []
    arr.push({ x: h.x, y: h.y, width: h.width, height: h.height })
    byPage.set(h.page, arr)
  }
  byPage.forEach((rects, page) => viewer.setHits(page, rects))
  if (hitIndex >= 0 && hits[hitIndex]) viewer.setActiveHit(hits[hitIndex].page, hits[hitIndex])
}

async function doSearch(query: string): Promise<void> {
  const s = useStore.getState()
  if (s.docId === null || !query.trim()) {
    viewer.clearHits()
    return
  }
  hintEl.textContent = '搜尋中…'
  hits = await window.pdfusion.core.search(s.docId, query.trim())
  hitIndex = -1
  redrawHits()
  if (hits.length === 0) {
    hintEl.textContent = `「${query}」：無結果`
  } else {
    gotoHit(0)
  }
}

function gotoHit(i: number): void {
  if (hits.length === 0) return
  hitIndex = ((i % hits.length) + hits.length) % hits.length
  redrawHits()
  const h = hits[hitIndex]
  gotoPage(h.page)
  hintEl.textContent = `「${searchInput.value}」：${hitIndex + 1}/${hits.length}`
}

// --- page operations ---
function docState() {
  return useStore.getState()
}

;(document.getElementById('btn-save') as HTMLButtonElement).addEventListener('click', () => void saveWorkingDoc())
;(document.getElementById('btn-del-page') as HTMLButtonElement).addEventListener('click', () => {
  const s = docState()
  if (s.docId === null) return
  void controller.apply(`刪除第 ${s.currentPage + 1} 頁`, s.docId, s.fileName, () =>
    controller.manager.deletePage(s.currentPage)
  )
})

;(document.getElementById('btn-ins-blank') as HTMLButtonElement).addEventListener('click', () => {
  const s = docState()
  if (s.docId === null) return
  void controller.apply('插入空白頁', s.docId, s.fileName, () => controller.manager.insertBlankPage(s.currentPage))
})

;(document.getElementById('btn-ins-img') as HTMLButtonElement).addEventListener('click', async () => {
  const s = docState()
  if (s.docId === null) return
  const r = await window.pdfusion.fs.openImage()
  if (!r.ok || !r.bytes) return
  const bytes = r.bytes
  void controller.apply('插入圖片頁', s.docId, s.fileName, () => controller.manager.insertImagePage(s.currentPage, bytes))
})

;(document.getElementById('btn-ins-pdf') as HTMLButtonElement).addEventListener('click', async () => {
  const s = docState()
  if (s.docId === null) return
  // Borrow the open dialog: it loads the source into the core; we only need its bytes.
  const r = await window.pdfusion.fs.open()
  if (!r.ok) return
  const bytes = await window.pdfusion.doc.getBytes(r.id)
  await window.pdfusion.core.close(r.id)
  if (!bytes) return
  void controller.apply('從其他 PDF 插入', s.docId, s.fileName, () => controller.manager.insertFromPdf(s.currentPage, bytes))
})

async function splitHalf(first: boolean): Promise<void> {
  const s = docState()
  if (s.docId === null || s.pageCount < 2) return
  const half = Math.ceil(s.pageCount / 2)
  const [start, count] = first ? [0, half] : [half, s.pageCount - half]
  try {
    const res = await controller.manager.extractRange(start, count)
    const base = s.fileName.replace(/\.pdf$/i, '')
    await window.pdfusion.fs.saveAs(`${base} ${first ? '前半' : '後半'} (1-${count}).pdf`, res.bytes)
    hintEl.textContent = `已拆出 ${count} 頁`
  } catch (err) {
    hintEl.textContent = `拆分失敗：${String(err)}`
  }
}

;(document.getElementById('btn-split-first') as HTMLButtonElement).addEventListener('click', () => void splitHalf(true))
;(document.getElementById('btn-split-last') as HTMLButtonElement).addEventListener('click', () => void splitHalf(false))

// --- annotations ---
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
function setTool(tool: Tool): void {
  annStore.getState().setTool(tool)
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool))
  viewerEl.dataset.tool = tool
}
toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)))
setTool('select')

;(document.getElementById('btn-bake') as HTMLButtonElement).addEventListener('click', () => {
  const s = docState()
  const anns = annStore.getState().annotations
  if (s.docId === null || anns.length === 0) {
    hintEl.textContent = '沒有可烘焙的註解'
    return
  }
  void controller.apply(`烘焙 ${anns.length} 筆註解`, s.docId, s.fileName, async () => {
    await bakeAnnotations(controller.manager, anns)
    return controller.manager.save()
  }).then((ok) => {
    if (ok) {
      annStore.getState().clear()
      hintEl.textContent = '註解已烘焙進 PDF'
    }
  })
})

// --- text editing ---
annotLayer.onEditClick = async (page, x, y) => {
  const s = docState()
  if (s.docId === null) return
  hintEl.textContent = '搜尋文字…'
  const hit = await hitTextSegment(s.docId, page, x, y)
  if (!hit) {
    hintEl.textContent = '此處沒有文字'
    return
  }
  const item = hit.item
  const wrap = viewerEl.querySelectorAll('.page-wrap')[page]
  if (!wrap) return
  const z = useStore.getState().zoom
  const sScale = PT_TO_CSS * z
  const input = document.createElement('input')
  input.className = 'freetext-input'
  input.value = item.text
  input.style.left = `${item.x * sScale}px`
  input.style.top = `${(item.y - 1) * sScale}px`
  input.style.width = `${Math.max(item.width, 140) * sScale}px`
  input.style.fontSize = `${Math.max(item.fontSize, 10) * sScale}px`
  wrap.appendChild(input)
  input.focus()
  input.select()
  let done = false
  const commit = async () => {
    if (done) return
    done = true
    input.remove()
    const newText = input.value
    if (newText === item.text) return
    hintEl.textContent = '正在編輯文字…'
    const st = docState()
    if (st.docId === null) return
    const id = st.docId
    const ok = await controller.apply('編輯文字', id, st.fileName, async () => {
      await commitTextEdit(controller.manager, id, page, item, newText)
      return controller.manager.save()
    })
    if (ok) hintEl.textContent = '文字已更新'
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void commit()
    else if (e.key === 'Escape') {
      done = true
      input.remove()
    }
  })
  input.addEventListener('blur', () => void commit())
}

// --- wiring ---
async function saveWorkingDoc(defaultName?: string): Promise<void> {
  const s = docState()
  if (s.docId === null) return
  hintEl.textContent = '儲存中…'
  try {
    const res = await controller.manager.save()
    const base = defaultName ?? (s.fileName.endsWith('.pdf') ? s.fileName : `${s.fileName}.pdf`)
    await window.pdfusion.fs.saveAs(base, res.bytes)
    hintEl.textContent = `已儲存 ${base}`
  } catch (err) {
    hintEl.textContent = `失敗：儲存 — ${String(err)}`
  }
}

window.pdfusion.onMenuAction((action) => {
  switch (action) {
    case 'open':
      void openPdf()
      break
    case 'save':
      void saveWorkingDoc()
      break
    case 'saveAs':
      void saveWorkingDoc()
      break
    case 'zoomIn':
      zoomBy(1)
      break
    case 'zoomOut':
      zoomBy(-1)
      break
    case 'zoomReset':
      applyZoom(1.0)
      break
    case 'toggleSidebar': {
      const el = document.getElementById('thumbs')
      if (el) el.style.display = el.style.display === 'none' ? '' : 'none'
      break
    }
  }
})

;(document.getElementById('btn-open') as HTMLButtonElement).addEventListener('click', openPdf)
;(document.getElementById('btn-zoom-in') as HTMLButtonElement).addEventListener('click', () => zoomBy(1))
;(document.getElementById('btn-zoom-out') as HTMLButtonElement).addEventListener('click', () => zoomBy(-1))
;(document.getElementById('btn-prev') as HTMLButtonElement).addEventListener('click', () => gotoPage(currentPage() - 1))
;(document.getElementById('btn-next') as HTMLButtonElement).addEventListener('click', () => gotoPage(currentPage() + 1))

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (!searchInput.value.trim()) return
    if (e.shiftKey) gotoHit(hitIndex - 1)
    else if (hitIndex >= 0 && hits.length > 0) gotoHit(hitIndex + 1)
    else void doSearch(searchInput.value)
  } else if (e.key === 'Escape') {
    searchInput.value = ''
    hits = []
    hitIndex = -1
    viewer.clearHits()
    hintEl.textContent = ''
  }
})

viewerEl.addEventListener(
  'scroll',
  () => {
    requestAnimationFrame(() => {
      const visible = viewer.visiblePage()
      if (visible !== currentPage()) useStore.getState().setCurrentPage(visible)
    })
  },
  { passive: true }
)

document.addEventListener('keydown', (e) => {
  if (searchInput === document.activeElement) return
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    void openPdf()
  } else if (e.key === 'PageUp') {
    e.preventDefault()
    gotoPage(currentPage() - 1)
  } else if (e.key === 'PageDown') {
    e.preventDefault()
    gotoPage(currentPage() + 1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    gotoPage(0)
  } else if (e.key === 'End') {
    e.preventDefault()
    gotoPage(useStore.getState().pageCount - 1)
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    searchInput.focus()
    searchInput.select()
  }
})

// Dev-only auto-open hook
window.pdfusion.onAutoOpen((info) => {
  if (info.ok) void showDoc(info.id, info.name, info.pageCount)
})

// Initial status
statusEl.textContent = useStore.getState().statusText
hintEl.textContent = 'Cmd-O 開啟・Cmd-F 搜尋・PageUp/Down 翻頁'
