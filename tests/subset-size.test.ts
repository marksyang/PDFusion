import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { fontkit } from '../src/renderer/src/textedit/Fontkit'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('CJK subset size (adapter, browser-safe fake stream)', () => {
  it('embeds Noto TC as a small subset and encodes CJK', async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit as never)
    const noto = await doc.embedFont(
      new Uint8Array(readFileSync(join(ROOT, 'resources', 'fonts', 'NotoSansTC-Regular.otf')).buffer),
      { subset: true }
    )
    const page = doc.addPage([200, 100])
    page.drawText('中文烘焙OK', { x: 10, y: 50, size: 20, font: noto })
    const out = Buffer.from(await doc.save())
    console.log('doc with CJK subset:', (out.length / 1024).toFixed(1), 'KB')
    expect(out.length).toBeLessThan(300 * 1024) // subset ≈ tens of KB, not 5.4MB
    const extracted = noto.encodeText('中')
    expect(extracted).toBeDefined()
  })
})
