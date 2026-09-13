import { contextBridge, ipcRenderer } from 'electron'

export interface OpenedPdf {
  ok: boolean
  id: number
  path: string
  name: string
  pageCount: number
  error?: string
}

export interface RenderedPage {
  width: number
  height: number
  rgba: Uint8Array
}

export interface TextItem {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontName?: string
}

export interface SearchHit {
  page: number
  x: number
  y: number
  width: number
  height: number
}

const api = {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  core: {
    loadSmoke(): Promise<{ ok: boolean; id: number; pageCount: number }> {
      return ipcRenderer.invoke('core:load-smoke')
    },
    pageCount(id: number): Promise<number> {
      return ipcRenderer.invoke('core:page-count', id)
    },
    pageSize(id: number, index: number): Promise<{ width: number; height: number }> {
      return ipcRenderer.invoke('core:page-size', id, index)
    },
    renderPage(id: number, index: number, scale: number): Promise<RenderedPage> {
      return ipcRenderer.invoke('core:render-page', id, index, scale)
    },
    renderThumbnail(id: number, index: number, size: number): Promise<RenderedPage> {
      return ipcRenderer.invoke('core:render-thumbnail', id, index, size)
    },
    pageRotation(id: number, index: number): Promise<number> {
      return ipcRenderer.invoke('core:page-rotation', id, index)
    },
    getTextItems(id: number, index: number): Promise<TextItem[]> {
      return ipcRenderer.invoke('core:get-text-items', id, index)
    },
    search(id: number, query: string): Promise<SearchHit[]> {
      return ipcRenderer.invoke('core:search', id, query)
    },
    listFonts(id: number): Promise<Array<{ name: string; isEmbedded: boolean }>> {
      return ipcRenderer.invoke('core:list-fonts', id)
    },
    getFont(id: number, name: string): Promise<Uint8Array> {
      return ipcRenderer.invoke('core:get-font', id, name)
    },
    close(id: number): Promise<void> {
      return ipcRenderer.invoke('core:close', id)
    }
  },
  doc: {
    getBytes(id: number): Promise<Uint8Array | null> {
      return ipcRenderer.invoke('doc:get-bytes', id) as Promise<Uint8Array | null>
    },
    reload(oldId: number, bytes: Uint8Array): Promise<number> {
      return ipcRenderer.invoke('doc:reload', oldId, bytes) as Promise<number>
    }
  },
  fs: {
    open(): Promise<OpenedPdf> {
      return ipcRenderer.invoke('file:open')
    },
    openImage(): Promise<{ ok: boolean; path: string; bytes?: Uint8Array; error?: string }> {
      return ipcRenderer.invoke('file:open-image')
    },
    saveAs(defaultName: string, bytes: Uint8Array): Promise<boolean> {
      return ipcRenderer.invoke('file:save-as', defaultName, bytes)
    }
  },
  // Dev-only helpers (used by the PDFUSION_DEV_AUTOPEN verification flow).
  onAutoOpen(cb: (info: OpenedPdf) => void): void {
    ipcRenderer.on('dev:auto-open', (_e, info: OpenedPdf) => cb(info))
  },
  onMenuAction(cb: (action: string) => void): void {
    ipcRenderer.on('menu:action', (_e, action: string) => cb(action))
  },
  capture(outPath: string): Promise<string> {
    return ipcRenderer.invoke('dev:capture', outPath) as Promise<string>
  }
}

contextBridge.exposeInMainWorld('pdfusion', api)
