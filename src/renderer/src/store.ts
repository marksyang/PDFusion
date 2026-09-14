import { createStore } from 'zustand/vanilla'

export interface DocState {
  docId: number | null
  fileName: string
  pageCount: number
  zoom: number
  currentPage: number
  statusText: string
  textFontSize: number
  setDoc: (docId: number, fileName: string, pageCount: number) => void
  closeDoc: () => void
  setZoom: (zoom: number) => void
  setCurrentPage: (page: number) => void
  setStatus: (text: string) => void
  setTextFontSize: (size: number) => void
}

export const useStore = createStore<DocState>((set) => ({
  docId: null,
  fileName: '',
  pageCount: 0,
  zoom: 1.0,
  currentPage: 0,
  statusText: '未開啟文件',
  textFontSize: 14,
  setDoc: (docId, fileName, pageCount) =>
    set({ docId, fileName, pageCount, currentPage: 0, statusText: `${fileName}（${pageCount} 頁）` }),
  closeDoc: () => set({ docId: null, fileName: '', pageCount: 0, currentPage: 0, statusText: '未開啟文件' }),
  setZoom: (zoom) => set({ zoom }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setStatus: (text) => set({ statusText: text }),
  setTextFontSize: (size) => set({ textFontSize: size })
}))
