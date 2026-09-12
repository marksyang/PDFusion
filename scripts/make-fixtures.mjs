// Generate test fixture PDFs using pdf-lib.
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'fixtures')
mkdirSync(outDir, { recursive: true })

async function makePdf(name, pages) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const [i, lines] of pages.entries()) {
    const page = doc.addPage([612, 792]) // US Letter
    let y = 700
    for (const line of lines) {
      if (line.bold) {
        page.drawText(line.text, { x: 72, y, size: 20, font: bold })
        y -= 32
      } else {
        page.drawText(line.text, { x: 72, y, size: 13, font })
        y -= 22
      }
    }
  }
  const bytes = await doc.save()
  writeFileSync(join(outDir, name), Buffer.from(bytes))
  console.log(`wrote fixtures/${name} (${bytes.length} bytes)`)
}

await makePdf('smoke.pdf', [
  [
    { text: 'PDFusion smoke test page 1', bold: true },
    { text: 'The quick brown fox jumps over the lazy dog.' },
    { text: '0123456789 — pdfium render and search target line.' }
  ],
  [
    { text: 'PDFusion smoke test page 2', bold: true },
    { text: 'Second page content for pagination checks.' }
  ]
])
