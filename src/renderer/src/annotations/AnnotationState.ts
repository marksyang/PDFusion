import { createStore } from 'zustand/vanilla'
import type { Annotation, Tool } from './AnnotationModel'

export interface AnnState {
  annotations: Annotation[]
  tool: Tool
  selectedId: string | null
  setTool: (tool: Tool) => void
  add: (ann: Annotation) => void
  remove: (id: string) => void
  clear: () => void
  select: (id: string | null) => void
  replaceAll: (anns: Annotation[]) => void
}

export const annStore = createStore<AnnState>((set) => ({
  annotations: [],
  tool: 'select',
  selectedId: null,
  setTool: (tool) => set({ tool, selectedId: null }),
  add: (ann) => set((s) => ({ annotations: [...s.annotations, ann], selectedId: null })),
  remove: (id) =>
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId
    })),
  clear: () => set({ annotations: [], selectedId: null }),
  select: (id) => set({ selectedId: id }),
  replaceAll: (anns) => set({ annotations: anns, selectedId: null })
}))
