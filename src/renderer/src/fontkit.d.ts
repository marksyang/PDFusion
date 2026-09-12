declare module 'fontkit' {
  export function create(source: unknown): unknown
  export function open(source: unknown): Promise<unknown>
  export const defaultLanguage: string
}
