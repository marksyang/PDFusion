import { app, dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

/**
 * Resolve project root / packaged resource locations.
 * - dev:        <repo>/out/main/index.js  -> root = ../..
 * - packaged:   app.asar/out/main/index.js -> resources live in process.resourcesPath
 */
export function projectRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, '..')
  }
  return join(__dirname, '../..')
}

/** Directory that must be set as PDFIUM_DYNAMIC_PATH for the Rust core. */
export function pdfiumDir(): string {
  const sub = process.platform === 'win32' ? 'pdfium-windows' : 'pdfium-mac'
  const root = app.isPackaged ? process.resourcesPath : join(projectRoot(), 'resources')
  return join(root, sub)
}

export interface PdfCoreModule {
  PdfCore: new () => PdfCoreApi
}

export interface PdfCoreApi {
  loadPdf(bytes: Buffer): number
  close(id: number): void
  pageCount(id: number): number
  pageSize(id: number, index: number): { width: number; height: number }
  pageRotation(id: number, index: number): number
  renderPage(
    id: number,
    index: number,
    scale: number
  ): { width: number; height: number; rgba: Uint8Array }
  renderThumbnail(
    id: number,
    index: number,
    size: number
  ): { width: number; height: number; rgba: Uint8Array }
  getTextItems(
    id: number,
    index: number
  ): Array<{
    text: string
    x: number
    y: number
    width: number
    height: number
    fontSize: number
    fontName?: string
  }>
  search(
    id: number,
    query: string
  ): Array<{ page: number; x: number; y: number; width: number; height: number }>
  listFonts(id: number): Array<{ name: string; isEmbedded: boolean }>
  getFont(id: number, name: string): Buffer
}

let coreInstance: PdfCoreApi | null = null

/** In-memory bytes for every doc id (source of truth between core reloads). */
const docBytes = new Map<number, Uint8Array>()

export function initCore(): void {
  // Must be set before the native module is loaded/used.
  process.env.PDFIUM_DYNAMIC_PATH = pdfiumDir()

  // Same relative path works in dev (out/main -> core/) and packaged
  // (app.asar/out/main -> app.asar/core/); Electron redirects .node requires
  // to the asarUnpack location automatically.
  const corePath = join(__dirname, '../../core/index.js')

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(corePath) as PdfCoreModule
  coreInstance = new mod.PdfCore()

  // Startup smoke test (dev only): load the fixture and log the page count.
  if (!app.isPackaged) {
    try {
      const fixture = join(projectRoot(), 'fixtures', 'smoke.pdf')
      const id = coreInstance.loadPdf(readFileSync(fixture))
      console.log(`[pdfusion] smoke test OK: fixtures/smoke.pdf -> doc id ${id}, ${coreInstance.pageCount(id)} pages`)
      coreInstance.close(id)
    } catch (err) {
      console.error('[pdfusion] smoke test FAILED:', err)
    }
  }
}

function core(): PdfCoreApi {
  if (!coreInstance) throw new Error('PDF core not initialized')
  return coreInstance
}

export interface OpenedPdf {
  ok: boolean
  id: number
  path: string
  name: string
  pageCount: number
  error?: string
}

export function registerCoreIpc(): void {
  // Load the built-in smoke-test fixture.
  ipcMain.handle('core:load-smoke', () => {
    const c = core()
    const fixture = join(projectRoot(), 'fixtures', 'smoke.pdf')
    const id = c.loadPdf(readFileSync(fixture))
    return { ok: true, id, pageCount: c.pageCount(id) }
  })

  ipcMain.handle('core:page-count', (_e, id: number) => core().pageCount(id))
  ipcMain.handle('core:page-size', (_e, id: number, index: number) =>
    core().pageSize(id, index)
  )
  ipcMain.handle('core:render-page', (_e, id: number, index: number, scale: number) =>
    core().renderPage(id, index, scale)
  )
  ipcMain.handle('core:render-thumbnail', (_e, id: number, index: number, size: number) =>
    core().renderThumbnail(id, index, size)
  )
  ipcMain.handle('core:page-rotation', (_e, id: number, index: number) =>
    core().pageRotation(id, index))
  ipcMain.handle('core:get-text-items', (_e, id: number, index: number) =>
    core().getTextItems(id, index)
  )
  ipcMain.handle('core:search', (_e, id: number, query: string) => core().search(id, query))
  ipcMain.handle('core:list-fonts', (_e, id: number) => core().listFonts(id))
  ipcMain.handle('core:get-font', (_e, id: number, name: string) => core().getFont(id, name))
  ipcMain.handle('core:close', (_e, id: number) => {
    docBytes.delete(id)
    core().close(id)
  })

  // Working-buffer support for page operations (pdf-lib in renderer).
  ipcMain.handle('doc:get-bytes', (_e, id: number): Uint8Array | null => {
    return docBytes.get(id) ?? null
  })

  /** Close the old doc, load new bytes, return the fresh id. */
  ipcMain.handle('doc:reload', (_e, oldId: number, bytes: Uint8Array): number => {
    const c = core()
    docBytes.delete(oldId)
    c.close(oldId)
    const id = c.loadPdf(Buffer.from(bytes))
    docBytes.set(id, bytes)
    return id
  })

  // Native open dialog → load into Rust core.
  ipcMain.handle('file:open', async (): Promise<OpenedPdf> => {
    const result = await dialog.showOpenDialog({
      title: '開啟 PDF',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, id: 0, path: '', name: '', pageCount: 0, error: 'canceled' }
    }
    const path = result.filePaths[0]
    return loadPdfFile(path)
  })

  // Native image open dialog (for inserting image pages).
  ipcMain.handle('file:open-image', async (): Promise<{ ok: boolean; path: string; bytes?: Uint8Array; error?: string }> => {
    const result = await dialog.showOpenDialog({
      title: '選擇圖片',
      filters: [{ name: '圖片', extensions: ['png', 'jpg', 'jpeg'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, path: '', error: 'canceled' }
    }
    const path = result.filePaths[0]
    try {
      return { ok: true, path, bytes: new Uint8Array(readFileSync(path)) }
    } catch (err) {
      return { ok: false, path, error: String(err) }
    }
  })

  // Save bytes to a chosen path.
  ipcMain.handle(
    'file:save-as',
    async (_e, defaultName: string, bytes: Uint8Array): Promise<boolean> => {
      // Dev-only bypass: write directly into a directory (no dialog).
      const devDir = process.env['PDFUSION_DEV_SAVE']
      if (devDir) {
        writeFileSync(join(devDir, defaultName), Buffer.from(bytes))
        return true
      }
      const result = await dialog.showSaveDialog({
        title: '儲存 PDF',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return false
      writeFileSync(result.filePath, Buffer.from(bytes))
      return true
    }
  )
}

/** Load a PDF file into the core (shared by dialog flow and dev auto-open). */
export function loadPdfFile(path: string): OpenedPdf {
  const name = path.split(/[\\/]/).pop() ?? 'document.pdf'
  try {
    const c = core()
    const bytes = readFileSync(path)
    const id = c.loadPdf(bytes)
    docBytes.set(id, new Uint8Array(bytes))
    return { ok: true, id, path, name, pageCount: c.pageCount(id) }
  } catch (err) {
    return { ok: false, id: 0, path, name, pageCount: 0, error: String(err) }
  }
}

/** Dev-only: capture the given window to a PNG (returns path). */
export function registerDevIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dev:capture', async (_e, outPath: string) => {
    const win = getWindow()
    if (!win) return ''
    const image = await win.webContents.capturePage()
    writeFileSync(outPath, image.toPNG())
    return outPath
  })
}
