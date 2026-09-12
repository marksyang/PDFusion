import { Menu, app, BrowserWindow } from 'electron'

type Action =
  | 'open'
  | 'save'
  | 'saveAs'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'toggleSidebar'

function send(win: BrowserWindow | null, action: Action): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('menu:action', action)
}

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '檔案',
      submenu: [
        {
          label: '開啟 PDF…',
          accelerator: 'CmdOrCtrl+O',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'open')
        },
        { type: 'separator' },
        {
          label: '儲存',
          accelerator: 'CmdOrCtrl+S',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'save')
        },
        {
          label: '另存新檔…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'saveAs')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: '結束' }
      ]
    },
    {
      label: '編輯',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '檢視',
      submenu: [
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+=',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'zoomIn')
        },
        {
          label: '縮小',
          accelerator: 'CmdOrCtrl+-',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'zoomOut')
        },
        {
          label: '實際大小',
          accelerator: 'CmdOrCtrl+0',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'zoomReset')
        },
        { type: 'separator' },
        {
          label: '縮圖側欄',
          accelerator: 'CmdOrCtrl+B',
          click: (_item, win) => send((win as BrowserWindow | null) ?? getWindow(), 'toggleSidebar')
        }
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

