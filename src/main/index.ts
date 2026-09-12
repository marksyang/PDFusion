import { app, BrowserWindow } from 'electron'
import { buildMenu } from './menu'
import { join } from 'path'
import { initCore, registerCoreIpc, registerDevIpc, loadPdfFile } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  if (process.env['PDFUSION_DEV_AUTOPEN']) {
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer] ${message}`)
    })
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initCore()
  registerCoreIpc()
  registerDevIpc(() => mainWindow)
  buildMenu(() => mainWindow)
  createWindow()

  // Dev-only: auto-open a PDF (PDFUSION_DEV_AUTOPEN=<path or fixture name>)
  // and capture a screenshot for headless verification.
  const auto = process.env['PDFUSION_DEV_AUTOPEN']
  if (auto) {
    const target = auto.startsWith('/') ? auto : join(process.cwd(), 'fixtures', auto)
    mainWindow?.webContents.once('did-finish-load', () => {
      const info = loadPdfFile(target)
      if (info.ok) {
        const out = join('/tmp', `pdfusion-capture-${Date.now()}.png`)
        setTimeout(() => mainWindow?.webContents.send('dev:auto-open', info), 300)
        const devSearch = process.env['PDFUSION_DEV_SEARCH']
        if (process.env['PDFUSION_DEV_OP']) {
          const op = process.env['PDFUSION_DEV_OP']
          setTimeout(async () => {
            const before = await mainWindow?.webContents.executeJavaScript(
              `document.getElementById('page-label').textContent`
            )
            await mainWindow?.webContents.executeJavaScript(`document.getElementById('btn-${op === 'ins' ? 'ins-blank' : 'del-page'}').click()`)
            await new Promise((r) => setTimeout(r, 2500))
            const after = await mainWindow?.webContents.executeJavaScript(
              `document.getElementById('page-label').textContent + ' | hint=' + document.getElementById('hint').textContent`
            )
            console.log(`[pdfusion] dev op ${op}: before=${before} after=${after}`)
          }, 2500)
        }
        if (process.env['PDFUSION_DEV_ZOOM']) {
          setTimeout(async () => {
            const state = await mainWindow?.webContents.executeJavaScript(`(() => {
              document.getElementById('btn-zoom-in').click();
              document.getElementById('btn-zoom-in').click();
              return 'zoomed';
            })()`)
            console.log('[pdfusion] dev zoom clicked:', state)
          }, 2500)
        }
        if (devSearch) {
          setTimeout(async () => {
            await mainWindow?.webContents.executeJavaScript(`(() => {
              const input = document.getElementById('search-input');
              input.value = ${JSON.stringify(devSearch)};
              input.focus();
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              return 'search dispatched';
            })()`)
            console.log('[pdfusion] dev search dispatched:', devSearch)
          }, 2500)
          setTimeout(async () => {
            const state = await mainWindow?.webContents.executeJavaScript(`(() => {
              const box = document.querySelector('.hit-box');
              if (!box) return 'no box';
              const r = box.getBoundingClientRect();
              const cs = getComputedStyle(box);
              const wrap = box.closest('.page-wrap').getBoundingClientRect();
              return JSON.stringify({ rect: [r.x, r.y, r.width, r.height], wrap: [wrap.x, wrap.y, wrap.width, wrap.height], display: cs.display, visibility: cs.visibility, opacity: cs.opacity, border: cs.borderColor, bg: cs.backgroundColor, zIndex: cs.zIndex });
            })()`)
            console.log('[pdfusion] dev search state:', state)
          }, 4500)
        }
        if (process.env['PDFUSION_DEV_ANN']) {
          setTimeout(async () => {
            const res = await mainWindow?.webContents.executeJavaScript(`(() => {
              document.querySelector('[data-tool=highlight]').click();
              const canvas = document.querySelector('.page-wrap .annot-canvas');
              const r = canvas.getBoundingClientRect();
              const s = 96/72; // zoom 1
              const mk = (type, x, y) => new PointerEvent(type, { clientX: r.left + x*s, clientY: r.top + y*s, pointerId: 1, isPrimary: true, bubbles: true });
              canvas.dispatchEvent(mk('pointerdown', 270, 122));
              canvas.dispatchEvent(mk('pointermove', 340, 142));
              canvas.dispatchEvent(mk('pointerup', 340, 142));
              document.querySelector('[data-tool=select]').click();
              return 'highlight drawn';
            })()`)
            console.log('[pdfusion] dev ann:', res)
          }, 2500)
          setTimeout(async () => {
            await mainWindow?.webContents.executeJavaScript(`document.getElementById('btn-bake').click()`)
            await new Promise((r) => setTimeout(r, 3000))
            const state = await mainWindow?.webContents.executeJavaScript(
              `document.getElementById('hint').textContent`
            )
            console.log('[pdfusion] dev bake state:', state)
          }, 5500)
        }
        if (process.env['PDFUSION_DEV_TEXTEDIT']) {
          setTimeout(async () => {
            const res = await mainWindow?.webContents.executeJavaScript(`new Promise((resolve) => {
              document.querySelector('[data-tool=edit]').click();
              const canvas = document.querySelector('.page-wrap .annot-canvas');
              const r = canvas.getBoundingClientRect();
              const s = 96/72;
              canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 305*s, clientY: r.top + 132*s, pointerId: 1, isPrimary: true, bubbles: true }));
              setTimeout(() => {
                const input = document.querySelector('.freetext-input');
                if (!input) { resolve('NO-INPUT'); return; }
                input.value = 'lazy FUSION dog';
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                resolve('committed');
              }, 800);
            })`)
            console.log('[pdfusion] dev textedit:', res)
          }, 2500)
          setTimeout(async () => {
            const state = await mainWindow?.webContents.executeJavaScript(
              `document.getElementById('hint').textContent`
            )
            console.log('[pdfusion] dev textedit hint:', state)
          }, 6500)
        }
        setTimeout(async () => {
          try {
            const image = await mainWindow?.webContents.capturePage()
            if (image) {
              const { writeFileSync } = await import('fs')
              writeFileSync(out, image.toPNG())
              console.log(`[pdfusion] dev capture saved: ${out}`)
            }
          } catch (err) {
            console.error('[pdfusion] dev capture failed:', err)
          }
        }, 9000)
      } else {
        console.error('[pdfusion] dev auto-open failed:', info.error)
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
