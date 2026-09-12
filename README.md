# PDFusion

跨平台（macOS / Windows）開源 PDF 檢視器與編輯器。

- **檢視**：高保真渲染（PDFium）、縮放、全文搜尋、頁面縮圖側欄
- **頁面管理**：刪頁、插入空白頁 / 圖片頁 / 外部 PDF、拖曳重新排序、拆份
- **註解**：螢光筆、文字框、矩形 / 圓形、手寫筆跡；可「烘焙」進 PDF 成為永久內容
- **文字編輯**：點選原文字 → 就地改寫（以原內嵌字型重繪）

MIT 授權。詳見 [LICENSE](./LICENSE)。

## 技術架構

```
┌────────────────────────── Electron ──────────────────────────┐
│ Renderer (原生 DOM + CSS, zustand/vanilla)                   │
│   PdfViewer(懶載入渲染+縮放快取)  PageThumbnails(DnD)        │
│   AnnotationLayer(畫布覆蓋層)  TextEditor(浮動輸入)          │
│   PageManager / DocController (pdf-lib 變更層)               │
└──────────────┬───────────────────────────────┬───────────────┘
               │ contextBridge (window.pdfusion)│
┌──────────────▼──────────────┐    ┌───────────▼──────────────┐
│ Main (menu, IPC, fs)        │    │ Rust core (napi-rs)      │
│  載入 core/*.node           │───▶│  pdfium-render:          │
└─────────────────────────────┘    │   渲染 / 文字 / 搜尋 /   │
                                   │   內嵌字型位元組抽取     │
                                   └───────────┬──────────────┘
                                               ▼
                                   PDFium (Apache-2.0, resources/)
```

- **讀 / 渲染層**：Rust + [PDFium](https://pdfium.googlesource.com/pdfium/)（`core/`，napi-rs 匯出 `.node`）
- **寫 / 變更層**：[pdf-lib](https://pdf-lib.js.org/)（MIT）— 頁面操作、註解烘焙、文字重繪
- **打包**：electron-vite + electron-builder（dmg / nsis），`.node` 走 `asarUnpack`，PDFium 動態庫以 `extraResources` 隨包

## 開發環境

前置：Node.js ≥ 18、Rust（rustup）。

```bash
npm install          # JS 相依
npm run core:build   # 建置 Rust core（需 cargo）
npm run dev          # 開發模式
```

## 建置與打包

```bash
npm run core:build   # 先編譯 Rust core
npm run build        # electron-vite 三區建置
npm run package:mac  # dmg (arm64 + x64)
npm run package:win  # nsis 安裝包（可在 Mac 交叉建置）
```

## 測試

```bash
npm run test         # vitest（PageManager / AnnotationModel / BakeToPdf）
npm run test:core    # Rust core 冒煙測試（node 端呼叫 .node）
npm run test:all     # 兩者都跑
cargo test           # core/（目前為佔位；主測試在 test:core）
```

## 文字編輯的限制

本專案的文字編輯為「覆蓋重繪」式（非真正的字型流重建）。
完整說明與已知限制請見 [docs/text-editing-limits.md](./docs/text-editing-limits.md)。

## 授權

- 本專案：MIT
- PDFium：Apache-2.0（`resources/` 內二進位，相容於 MIT 分發）
- pdf-lib / fontkit / zustand：MIT
