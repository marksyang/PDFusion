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
        if (process.env['PDFUSION_DEV_TEXTEDIT_SAVE']) {
          setTimeout(async () => {
            await mainWindow?.webContents.executeJavaScript(`new Promise((resolve) => {
              document.querySelector('[data-tool=edit]').click();
              const canvas = document.querySelector('.page-wrap .annot-canvas');
              const r = canvas.getBoundingClientRect();
              const s2 = 96/72;
              canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 305*s2, clientY: r.top + 132*s2, pointerId: 1, isPrimary: true, bubbles: true }));
              setTimeout(() => {
                const input = document.querySelector('.freetext-input');
                if (!input) { resolve('NO-INPUT'); return; }
                input.value = 'lazy FUSION dog';
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                setTimeout(() => {
                  document.getElementById('btn-save').click();
                  setTimeout(() => resolve(document.getElementById('hint').textContent), 2000);
                }, 1500);
              }, 600);
            })`)
            console.log('[pdfusion] dev edit-save:', await mainWindow?.webContents.executeJavaScript(`document.getElementById('hint').textContent`))
          }, 2500)
        }
        if (process.env['PDFUSION_DEV_MEASURE']) {
          setTimeout(async () => {
            const r = await mainWindow?.webContents.executeJavaScript(`(async () => {
              const out = {};
              const $ = (s) => document.querySelector(s);
              const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
              const rectOf = (el) => { const r3 = el.getBoundingClientRect(); return [Math.round(r3.x), Math.round(r3.y), Math.round(r3.width), Math.round(r3.height)]; };
              const cv0 = () => document.querySelector('.page-wrap .annot-canvas');
              out.alignZoom1 = { page: rectOf(document.querySelector('.page-wrap .page-canvas')), annot: rectOf(cv0()) };
              const draw = (x0, y0, x1, y1) => {
                const cv = cv0();
                const r4 = cv.getBoundingClientRect();
                const s2 = 96/72 * window.__debug.store.getState().zoom;
                const mk = (t, x, y) => new PointerEvent(t, { clientX: r4.left + x*s2, clientY: r4.top + y*s2, pointerId: 1, bubbles: true });
                cv.dispatchEvent(mk('pointerdown', x0, y0));
                cv.dispatchEvent(mk('pointermove', x1, y1));
                cv.dispatchEvent(mk('pointerup', x1, y1));
              };
              $('[data-tool=highlight]').click();
              draw(270, 122, 340, 142);
              await sleep(150);
              out.zoom1 = window.__debug.annStore.getState().annotations.map((a) => a.rect);
              $('#btn-zoom-in').click();
              await sleep(1500);
              out.alignZoom2 = { page: rectOf(document.querySelector('.page-wrap .page-canvas')), annot: rectOf(cv0()), zoomLabel: $('#zoom-label').textContent };
              draw(100, 300, 200, 330);
              await sleep(150);
              out.zoom2 = window.__debug.annStore.getState().annotations.map((a) => a.rect);
              $('[data-tool=select]').click();
              draw(305, 132, 306, 133);
              await sleep(150);
              out.selectedId = window.__debug.annStore.getState().selectedId;
              return JSON.stringify(out);
            })()`)
            console.log('[pdfusion] dev measure:', r)
          }, 2500)
        }
        if (process.env['PDFUSION_DEV_FIX']) {
          setTimeout(async () => {
            const r = await mainWindow?.webContents.executeJavaScript(`new Promise((resolve) => {
              const $ = (sel) => document.querySelector(sel);
              const canvas = $('.page-wrap .annot-canvas');
              const rect = canvas.getBoundingClientRect();
              const s = 96/72;
              const mk = (t, x, y) => new PointerEvent(t, { clientX: rect.left + x*s, clientY: rect.top + y*s, pointerId: 1, isPrimary: true, bubbles: true });
              $('[data-tool=freetext]').click();
              canvas.dispatchEvent(mk('pointerdown', 100, 400));
              canvas.dispatchEvent(mk('pointermove', 300, 420));
              canvas.dispatchEvent(mk('pointerup', 300, 420));
              setTimeout(() => {
                const input = $('.freetext-input');
                const color = input ? getComputedStyle(input).color : 'NO-INPUT';
                if (input) {
                  input.value = 'TEST-FREE-123';
                  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }
                setTimeout(() => {
                  $('[data-tool=highlight]').click();
                  canvas.dispatchEvent(mk('pointerdown', 100, 450));
                  canvas.dispatchEvent(mk('pointermove', 320, 470));
                  canvas.dispatchEvent(mk('pointerup', 320, 470));
                  setTimeout(() => {
                    const n1 = window.__debug.annStore.getState().annotations.length;
                    $('[data-tool=eraser]').click();
                    canvas.dispatchEvent(mk('pointerdown', 200, 460));
                    canvas.dispatchEvent(mk('pointerup', 200, 460));
                    const n2 = window.__debug.annStore.getState().annotations.length;
                    $('#btn-save').click();
                    setTimeout(() => {
                      const hint = document.getElementById('hint').textContent;
                      const n3 = window.__debug.annStore.getState().annotations.length;
                      resolve(JSON.stringify({ color, n1, n2, n3, hint }));
                    }, 2500);
                  }, 400);
                }, 400);
              }, 300);
            })`)
            console.log('[pdfusion] dev fix:', r)
          }, 2500)
        }
        if (process.env['PDFUSION_DEV_ROTB']) {
          // E2E: highlight 'LINE TWO' (view coords), bake with rotation, save bytes.
          setTimeout(async () => {
            const r = await mainWindow?.webContents.executeJavaScript(`(async () => {
              try {
                const dbg = window.__debug;
                if (!dbg) return JSON.stringify({ err: 'no __debug' });
                const st = dbg.store.getState();
                const docId = st.docId;
                if (docId === null) return JSON.stringify({ err: 'no doc' });
                const items = await window.pdfusion.core.getTextItems(docId, 0);
                const target = items.find((i) => i.text.includes('LINE TWO'));
                if (!target) return JSON.stringify({ err: 'no LINE TWO', items });
                const view = await window.pdfusion.core.pageSize(docId, 0);
                const hl = { id: 'rot-ann', page: 0, type: 'highlight', rect: { x: target.x, y: target.y, w: target.width, h: target.height } };
                const ft = { id: 'rot-ft', page: 0, type: 'freetext', rect: { x: 100, y: 450, w: 320, h: 60 }, text: 'ROTATED-TEXT-OK', fontSize: 20 };
                dbg.annStore.getState().add(hl);
                const bytes = await dbg.bakeToBytes(docId, [hl, ft]);
                return JSON.stringify({ target, view, ftRect: ft.rect, bytes, byteCount: bytes.length });
              } catch (e) { return JSON.stringify({ err: String(e) }); }
            })()`)
            console.log('[pdfusion] dev rotb (head):', r.slice(0, 400))
            try {
              const parsed = JSON.parse(r)
              if (parsed.bytes) {
                const { writeFileSync, mkdirSync } = await import('fs')
                const dir = '/tmp/pdfusion-fix'
                mkdirSync(dir, { recursive: true })
                const file = join(dir, 'rotbaked.pdf')
                writeFileSync(file, Buffer.from(parsed.bytes))
                console.log('[pdfusion] dev rotb saved:', file)
              }
            } catch (err) {
              console.error('[pdfusion] dev rotb write failed:', err)
            }
          }, 3000)
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
