/**
 * Generate fixtures/rotated.pdf — a portrait page (612x792) with /Rotate 90
 * and two text lines, used to verify rotation-aware coordinate handling.
 *
 * Run: node scripts/make-rotated-fixture.mjs
 */
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(join(root, 'x.js'))
const { PDFDocument, StandardFonts, degrees } = req('pdf-lib')

const doc = await PDFDocument.create()
const page = doc.addPage([612, 792])
page.setRotation(degrees(90))
const font = await doc.embedFont(StandardFonts.Helvetica)
page.drawText('ROTATED LINE ONE', { x: 72, y: 700, size: 16, font })
page.drawText('ROTATED LINE TWO', { x: 72, y: 600, size: 16, font })

mkdirSync(join(root, 'fixtures'), { recursive: true })
writeFileSync(join(root, 'fixtures', 'rotated.pdf'), new Uint8Array(await doc.save()))
console.log('wrote fixtures/rotated.pdf')
