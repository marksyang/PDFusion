# PDFusion — 跨平台 PDF 編輯器（Mac / Windows）

## Context

在空專案（僅有 MIT LICENSE，Copyright Mark Yang）上從零打造 **PDFusion**：一個 MIT 授權的開源桌面 PDF 編輯器，支援 macOS 與 Windows。

**已確認的決策：**
- 技術棧：**Electron**（+ TypeScript + Vite）
- **核心引擎：Rust → PDFium**（透過 napi-rs 橋接 Node）負責渲染、文字搜尋/抽取（含嵌入字型位元組抽取）、頁面資訊
- 寫入/修改層：**pdf-lib**（MIT）負責頁面操作、註解、文字重寫
- MVP 功能：**檢視 + 頁面管理、標註註解、文字編輯**
- 產品形態：**開源/自用工具**，無程式簽名，免成本分發

**文字編輯策略（升級後）：**
PDFium 本身無「直接替換任意文字 span」的公開 API，因此仍採疊加式寫回（遮蔽原文字 + 重寫新文字），但引入 PDFium 引擎後忠度大幅提升：
1. Rust 核心用 PDFium `FPDFText` API 抽取每項文字的精確 bbox、字型名稱、大小；
2. **從 PDF 抽出原文字所嵌入的 TTF 字型位元組**（`FPDFDocument_LoadFontBuffer` / `FPDF_LoadPageFontFile` 系列），交給 pdf-lib `embedFont()` 使用 → 重寫文字用「原文字型」，視覺一致性遠勝 pdf.js 方案的字型推測；
3. 對文件/表單類版面接近無縫；仍極端依賴特殊排版（Art 化文字、逐筆劃描邊字型）的檔案屬已知上限，於 `docs/text-editing-limits.md` 記錄。

PDFium 授權：Apache-2.0，與 MIT 專案相容。各平台 PDFium 執行檔（Windows `pdfium.dll` / macOS `libpdfium.dylib`）由 `unblob`/官方 release 取得並隨包附帶。

## Approach

### 架構總覽

```
┌─────────────────────────── Electron ───────────────────────────┐
│ main (Node)                preload               renderer       │
│ · 視窗/選單                contextBridge:         · pdfium 頁面 canvas │
│ · dialog + fs              window.core = {        · 標註覆蓋層 (canvas) │
│ · 載入 native .node         renderPage,            · 文字編輯覆蓋層     │
│                           getTextItems,        · 頁面縮圖欄(拖拽排序) │
│  ┌─ Rust core (napi-rs) ─┐ getTextFont,     └───────────────────────┘
│  │ pdfium-render:        │ pageInfo }
│  │ render (bitmap)       │
│  │ text extract + font   │──▶ pdfium dynamic lib (per-OS)
│  │ font buffer extract   │
│  └───────────────────────┘
│
│ 寫入層（純 JS，renderer/main 皆可跑）：pdf-lib
│ · PageManager：刪/插/排序/合併/拆分
│ · BakeToPdf：標註 → 原生 PDF 註解
│ · CommitText：rect 遮蔽 + drawText（用 Rust 抽出的原始 TTF）
└──────────────────────────────────────────────────────────────────┘
```

- **渲染**：Rust 核心 `renderPage(doc, pageIndex, scale) -> RgbaBuffer`，renderer 轉 ImageData 畫到 canvas；縮放/重繪皆走此路徑（離散 scale 預渲染快取）。
- **文字命中與編輯**：Rust `getTextItems(page) -> [{text, x, y, w, h, fontSize, fontName}]`；點擊命中文字塊 → 覆蓋 contenteditable 編輯 → `getTextFont(doc, fontName) -> TTF bytes` → pdf-lib embed + drawText。
- **標註**：renderer 覆蓋 canvas JSON 模型；「烘焙」時以 pdf-lib annotation API（Highlight / FreeText / Ink / Square / Circle / Line）寫成 PDF 原生註解，其他查看器可見。
- **頁面管理**：pdf-lib 操作 `PDFDocument`（deletePage / insertPage / insertPages / copyPages / 圖片轉頁），改完以新 bytes 重新載入 Rust doc 句柄。
- **native 橋接**：napi-rs（`napi build --platform`），dev 用 `electron-rebuild`/`napi-cli`，產物 `.node` 放 `asarUnpack`；PDFium dylib 以 `napi-build` 動態載入或打包於 resources。

### 技術選型細節

| 項目 | 選擇 | 說明 |
|---|---|---|
| 殼/建置 | **electron-vite** + electron-builder | 三區（main/preload/renderer）+ HMR + 打包 |
| Rust 核心 | **napi-rs + pdfium-render**（crates.io，Apache-2.0 生態） | N-API，`.node` 產物跨 Mac/Win |
| PDFium | 官方動態庫（Win: pdfium.dll / mac: libpdfium.dylib） | 版本鎖定，resources 隨包分發 |
| 寫入層 | **pdf-lib** | 頁面/註解/文字寫回（MIT） |
| UI | 原生 DOM + CSS | 保持輕量，後續需要再評估 Svelte |
| 狀態 | Zustand | doc 句柄 id、頁索引、標註集、編輯態 |
| 測試 | Vitest（TS unit）+ cargo test（Rust unit） | 各層獨立測試 |

## Files to modify（全部為新增）

```
PDFusion/
├─ package.json                      # dev/build/package:mac/package:win、napi 建置 script
├─ electron.vite.config.ts
├─ electron-builder.yml              # mac: dmg; win: nsis; asarUnpack: **/*.node
├─ tsconfig.json
├─ core/                             # ★ Rust crate（napi-rs）
│  ├─ Cargo.toml                     # deps: napi, napi-derive, pdfium-render
│  ├─ src/lib.rs                     # 模組匯出
│  ├─ src/document.rs                # FPDFDocument 管理：load(bytes)/pageCount/句柄
│  ├─ src/render.rs                  # renderPage -> Vec<u8> RGBA
│  ├─ src/text.rs                    # getTextItems（bbox/font/size）、search(text)
│  ├─ src/fonts.rs                   # getTextFont -> TTF bytes（嵌入字型抽取）
│  ├─ build.rs                       # napi-build
│  └─ tests/render_smoke.rs          # cargo test：載入 fixture 渲染/抽取
├─ resources/
│  ├─ pdfium-windows/pdfium.dll
│  └─ pdfium-mac/libpdfium.dylib    # 版本鎖（README 記錄來源與 version）
├─ build/
│  ├─ icon.icns / icon.ico
├─ src/
│  ├─ main/
│  │  ├─ index.ts                    # 視窗、載入 .node（app.isPackaged 路徑處理）
│  │  ├─ menu.ts                     # 開啟/另存/翻頁/縮放、Cmd-S
│  │  └─ ipc.ts                      # openFile/saveFile → Buffer；native 呼叫全部走 IPC（renderer 不直接觸 node）
│  ├─ preload/
│  │  └─ index.ts                    # window.core：loadPdf, renderPage, getTextItems, getTextFont, search; fs: openFile/saveFile
│  └─ renderer/
│     ├─ index.html
│     ├─ src/
│     │  ├─ main.ts / store.ts       # Zustand：docId、pageIndex、annotations、editing
│     │  ├─ pdf/
│     │  │  ├─ PdfViewer.ts          # 以 core.renderPage 繪製頁面 canvas 池（scale 快取）
│     │  │  └─ PageThumbnails.ts     # 低分辨率渲染縮圖 + 拖拽排序
│     │  ├─ pageops/
│     │  │  ├─ PageManager.ts        # pdf-lib 刪/插(空白/圖片/他檔)/排序/拆分
│     │  │  └─ SaveExport.ts         # 組裝最終 bytes → fs.saveFile
│     │  ├─ annotations/
│     │  │  ├─ AnnotationModel.ts    # JSON schema + 序列化/還原
│     │  │  ├─ AnnotationLayer.ts    # 覆蓋 canvas：游標/繪製/選取/刪除
│     │  │  ├─ tools/{highlight,freeText,shape,ink}.ts
│     │  │  └─ BakeToPdf.ts          # → pdf-lib 原生註解
│     │  ├─ textedit/
│     │  │  ├─ TextHitTest.ts        # core.getTextItems → 點擊命中
│     │  │  ├─ TextEditor.ts         # contenteditable 覆蓋輸入
│     │  │  └─ CommitText.ts         # core.getTextFont → pdf-lib embed + rect 遮蔽 + drawText
│     │  ├─ ui/{Toolbar.ts,StatusBar.ts}
│     │  └─ styles.css
├─ tests/
│  ├─ unit/pageops.test.ts           # pdf-lib 操作 roundtrip
│  ├─ unit/annotation-model.test.ts
│  └─ unit/commit-text.test.ts       # 用 fixture TTF 驗證 drawText
├─ scripts/make-fixtures.mjs         # pdf-lib 產生 fixtures/*.pdf
├─ fixtures/{small.pdf, two-page.pdf}
├─ README.md                         # 開發（含 Rust 工具鏈步驟）、打包、PDFium 來源、Mac 未簽名放行
└─ docs/text-editing-limits.md       # 文字編輯已知限制
```

## Reuse（外部庫現成能力）

- **pdfium-render（Rust）**：`render_page()` 出 RGBA bitmap、文字抽取、字型 buffer 載入
- **PDFium C API**：`FPDF_LoadMemDocument / FPDFPage_GenerateContent / FPDFText_FindAll / FPDF_GetText`、嵌入字型 `FPDF_LoadFontFileAtIndex` 系列
- **pdf-lib**：`deletePage / insertPage / insertPages / copyPages`、`embedJpg/embedPng`、`embedFont(bytes)`、annotation API（addHighlightAnnotation / addFreeText / addInkAnnotation / addSquare / addCircle / addLine）、`drawRectangle / drawText`
- **napi-rs + napi-cli**：Rust↔Node 橋接與交叉建置（`napi build --platform windows --release`）
- **electron-vite / electron-builder / Zustand**：建置、打包（dmg/nsis）、狀態

## Steps

- [x] **1. 專案骨架**：npm 初始化 + electron-vite + TS；`npm run dev` 見 Hello 視窗（Mac/Win 各測）
- [x] **2. Rust 核心**：建立 `core/` crate（napi-rs + pdfium-render）；resources 放兩平台 PDFium；`npm run dev` 中透過 preload 呼叫 `loadPdf(bytes) -> {ok, pageCount}` smoke test 通過
- [x] **3. 開啟/存檔管道**：main dialog+fs IPC；renderer `PdfViewer` 用 core.renderPage 顯示多頁 + 捲動
- [x] **4. 檢視功能**：縮放（離散 scale 快取）、翻頁、全文搜尋定位（core.search + 命中框高亮）、左側縮圖欄
- [x] **5. 頁面管理**：PageManager（pdf-lib）刪/插空白・圖片・他檔頁、縮圖拖拽排序、拆分另存；改動後重新載入 Rust doc 句柄
- [x] **6. 標註系統**：AnnotationModel + AnnotationLayer（螢光/文字框/矩形/圓形/Ink）、選取刪除；BakeToPdf 寫原生註解
- [x] **7. 文字編輯**：TextHitTest（core.getTextItems）→ TextEditor → CommitText（core.getTextFont 抽原始 TTF → pdf-lib embed + 遮蔽 + 重寫）；撰寫 limits 文件
- [x] **8. 選單與快捷键**：macOS 原生選單 + Cmd/Ctrl-S、翻頁、縮放
- [x] **9. 測試**：cargo test（core smoke：render/text/font）、Vitest unit（PageManager、AnnotationModel、CommitText），fixtures 產生 script
- [x] **10. 打包**：`napi build --platform windows/mac --release` 交叉建置 .node；electron-builder dmg（macOS）+ nsis（Windows）；resources/pdfium 隨包；README 寫明 Rust 工具鏈安裝、Mac Gatekeeper 放行
- [x] **11. 收尾**：README、授權相容性檢查（PDFium Apache-2.0、pdf-lib MIT、napi-rs MIT/Apache — 與 MIT 相容）、`docs/text-editing-limits.md`

## Verification

1. **Rust core**：`cd core && cargo test` — fixture PDF 渲染出非空白 bitmap、getTextItems 項目數>0、getTextFont 回傳有效 TTF（魔數驗證）
2. **開發流程（macOS）**：`npm run dev` → 開啟 `fixtures/small.pdf` → 縮放/搜尋 → 刪頁 → 插圖片頁 → 拖拽排序 → 螢光+文字框+Ink → 烘焙註解 → 另存 → macOS「預覽」開啟確認原生註解存在
3. **文字編輯**：改一句純文字，另存重開確認顯示正確、字型與原文一致（對比截圖）
4. **Windows 驗證**：實體機/VM 執行 `npm run dev` 與 nsis 安裝包（含 pdfium.dll + windows .node），重複核心流程
5. **自動化**：`npm test` + `cargo test` 全綠（pdf-lib roundtrip：生成→改動→重開驗證頁數/註解數）
6. **打包產物**：dmg/nsis 安裝後啟動、開啟 PDF、文字編輯各做一次
7. **授權檢查**：`npm ls` + `cargo tree` 確認無 GPL/AGPL 混入
