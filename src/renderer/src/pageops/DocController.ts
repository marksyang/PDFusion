import { PageManager } from './PageManager'

export interface DocControllerHooks {
  onDocChanged: (id: number, name: string, pageCount: number) => void
  status: (text: string) => void
}

/**
 * DocController — drives page operations through pdf-lib (PageManager) and
 * swaps the Rust core document handle with the new bytes after each op.
 */
export class DocController {
  private pm = new PageManager()
  private hooks: DocControllerHooks

  constructor(hooks: DocControllerHooks) {
    this.hooks = hooks
  }

  get manager(): PageManager {
    return this.pm
  }

  async open(id: number): Promise<void> {
    const bytes = await window.pdfusion.doc.getBytes(id)
    if (!bytes) throw new Error('no working bytes available for this document')
    await this.pm.load(bytes)
  }

  /** Run an operation and swap the core document with the result bytes.
   *  Atomic: if the op fails after mutating the working document, the
   *  previous state is restored so a failed op never corrupts/rolls back edits. */
  async apply(
    label: string,
    id: number,
    name: string,
    op: () => Promise<{ bytes: Uint8Array; pageCount: number }>
  ): Promise<boolean> {
    let snapshot: Uint8Array | null = null
    if (this.pm.hasDoc) {
      try {
        snapshot = this.pm.currentBytes()
      } catch {
        snapshot = null
      }
    }
    try {
      this.hooks.status(`處理中：${label}…`)
      const { bytes, pageCount } = await op()
      const newId = await window.pdfusion.doc.reload(id, bytes)
      this.hooks.onDocChanged(newId, name, pageCount)
      return true
    } catch (err) {
      console.error(`page op failed: ${label}`, err)
      if (snapshot) {
        try {
          await this.pm.load(snapshot)
        } catch {
          // If the restore itself fails, keep whatever state we have.
        }
      }
      this.hooks.status(`失敗：${label} — ${String(err)}`)
      return false
    }
  }
}
