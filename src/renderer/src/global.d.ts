export interface RenderedPage {
  width: number
  height: number
  rgba: Uint8Array
}

export interface OpenedPdf {
  ok: boolean
  id: number
  path: string
  name: string
  pageCount: number
  error?: string
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

declare global {
  interface Window {
    pdfusion: {
      platform: string
      versions: { electron: string; chrome: string }
      core: {
        loadSmoke(): Promise<{ ok: boolean; id: number; pageCount: number }>
        pageCount(id: number): Promise<number>
        pageSize(id: number, index: number): Promise<{ width: number; height: number }>
        renderPage(id: number, index: number, scale: number): Promise<RenderedPage>
        renderThumbnail(id: number, index: number, size: number): Promise<RenderedPage>
        pageRotation(id: number, index: number): Promise<number>
        getTextItems(id: number, index: number): Promise<TextItem[]>
        search(id: number, query: string): Promise<SearchHit[]>
        listFonts(id: number): Promise<Array<{ name: string; isEmbedded: boolean }>>
        getFont(id: number, name: string): Promise<Uint8Array>
        close(id: number): Promise<void>
      }
      doc: {
        getBytes(id: number): Promise<Uint8Array | null>
        reload(oldId: number, bytes: Uint8Array): Promise<number>
      }
      fs: {
        open(): Promise<OpenedPdf>
        openImage(): Promise<{ ok: boolean; path: string; bytes?: Uint8Array; error?: string }>
        saveAs(defaultName: string, bytes: Uint8Array): Promise<boolean>
      }
      onAutoOpen(cb: (info: OpenedPdf) => void): void
      onMenuAction(cb: (action: string) => void): void
      capture(outPath: string): Promise<string>
    }
  }
}

export {}
