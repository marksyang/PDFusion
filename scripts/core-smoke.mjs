/**
 * Core smoke test — exercises the compiled pdfusion-core .node module in a
 * plain Node process (napi symbols are provided by Node itself).
 *
 * Run: npm run test:core   (build the core first with `npm run core:build`)
 */
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Point PDFium at the bundled dynamic library (platform-specific directory).
const isWin = process.platform === 'win32'
process.env['PDFIUM_DYNAMIC_PATH'] = join(
  root,
  'resources',
  isWin ? 'pdfium-windows' : 'pdfium-mac'
)

const require = createRequire(import.meta.url)
const { PdfCore } = require(join(root, 'core', 'index.js'))

const core = new PdfCore()
const bytes = new Uint8Array(require('node:fs').readFileSync(join(root, 'fixtures', 'smoke.pdf')))

// Load + page count
const id = core.loadPdf(bytes)
assert.equal(core.pageCount(id), 2, 'page count should be 2')

// Page size
const size = core.pageSize(id, 0)
assert.ok(size.width > 500 && size.height > 600, 'page size should be US Letter-ish')

// Text extraction
const items = core.getTextItems(id, 0)
assert.ok(items.length > 0, 'text items should not be empty')
const joined = items.map((i) => i.text).join(' ').toLowerCase()
assert.ok(joined.includes('lazy'), "text should contain 'lazy'")

// Search
const hits = core.search(id, 'lazy dog')
assert.ok(hits.length > 0, "search hits for 'lazy dog' should not be empty")
assert.equal(hits[0].page, 0)

// Fonts
const fonts = core.listFonts(id)
assert.ok(fonts.length > 0, 'fonts should not be empty')

// Render
const rendered = core.renderPage(id, 0, 1.0)
assert.ok(rendered.width > 500 && rendered.height > 600, 'render size should be page-sized')
assert.equal(rendered.rgba.length, rendered.width * rendered.height * 4)

// Thumbnail
const thumb = core.renderThumbnail(id, 1, 200)
assert.ok(thumb.width <= 200 || thumb.height <= 200, 'thumbnail should be scaled down')

core.close(id)
console.log('core smoke test OK: load/pageCount/pageSize/text/search/fonts/render/thumbnail')
