use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use pdfium_render::prelude::*;

mod document;
mod fonts;
mod render;
mod text;

use document::DocumentStore;

/// Initialize the global PDFium wrapper.
///
/// Library resolution order:
/// 1. `PDFIUM_DYNAMIC_PATH` env var (a directory containing the PDFium lib)
/// 2. System dynamic library search paths
fn global_pdfium() -> napi::Result<&'static Pdfium> {
    static PDFIUM: OnceLock<Pdfium> = OnceLock::new();
    if let Some(p) = PDFIUM.get() {
        return Ok(p);
    }

    let candidate: Option<std::path::PathBuf> = std::env::var("PDFIUM_DYNAMIC_PATH")
        .ok()
        .and_then(|dir| {
            let lib = Pdfium::pdfium_platform_library_name_at_path(dir.as_str());
            if lib.exists() {
                Some(lib)
            } else {
                None
            }
        });

    let bindings = match candidate {
        Some(lib) => Pdfium::bind_to_library(lib),
        None => Pdfium::bind_to_system_library(),
    };
    let bindings = bindings.map_err(|e| {
        napi::Error::from_reason(format!(
            "could not load PDFium library: {e} (set PDFIUM_DYNAMIC_PATH to a directory containing libPDFium.dylib / pdfium.dll)"
        ))
    })?;
    Ok(PDFIUM.get_or_init(|| Pdfium::new(bindings)))
}

#[napi]
pub struct PdfCore {
    store: Mutex<DocumentStore>,
}

#[napi]
impl PdfCore {
    #[napi(constructor)]
    pub fn new() -> Self {
        // Warm up dynamic library loading so failures surface early (logged only).
        if let Err(e) = global_pdfium() {
            eprintln!("pdfusion-core: {}", e.reason);
        }
        Self {
            store: Mutex::new(DocumentStore::new()),
        }
    }

    /// Load a PDF from raw bytes. Returns an opaque document id.
    #[napi]
    pub fn load_pdf(&self, bytes: Buffer) -> Result<u32> {
        let pdfium = global_pdfium()?;
        let mut guard = self.store.lock().unwrap();
        guard.load(pdfium, bytes.to_vec())
    }

    /// Close a previously loaded document.
    #[napi]
    pub fn close(&self, id: u32) -> Result<()> {
        let mut guard = self.store.lock().unwrap();
        guard.close(id)
    }

    #[napi]
    pub fn page_count(&self, id: u32) -> Result<u32> {
        let guard = self.store.lock().unwrap();
        render::page_count(&guard, id)
    }

    /// Page size in PDF points (72 dpi).
    #[napi]
    pub fn page_size(&self, id: u32, index: u32) -> Result<PageSize> {
        let guard = self.store.lock().unwrap();
        render::page_size(&guard, id, index)
    }

    /// Render a page at the given scale (1.0 == 72 dpi). Returns RGBA.
    #[napi]
    pub fn render_page(&self, id: u32, index: u32, scale: f64) -> Result<RenderedPage> {
        let guard = self.store.lock().unwrap();
        render::render(&guard, id, index, scale, None)
    }

    /// Render a page thumbnail (max dimension = size pixels).
    #[napi]
    pub fn render_thumbnail(&self, id: u32, index: u32, size: u32) -> Result<RenderedPage> {
        let guard = self.store.lock().unwrap();
        render::render(&guard, id, index, 1.0, Some(size))
    }

    /// Text line segments on a page with rects (PDF points, top-left origin).
    #[napi]
    pub fn get_text_items(&self, id: u32, index: u32) -> Result<Vec<TextItem>> {
        let guard = self.store.lock().unwrap();
        text::text_items(&guard, id, index)
    }

    /// Case-insensitive search across the whole document.
    #[napi]
    pub fn search(&self, id: u32, query: String) -> Result<Vec<SearchHit>> {
        let guard = self.store.lock().unwrap();
        text::search_document(&guard, id, &query)
    }

    #[napi]
    pub fn list_fonts(&self, id: u32) -> Result<Vec<FontInfo>> {
        let guard = self.store.lock().unwrap();
        fonts::list(&guard, id)
    }

    /// Return embedded font file bytes (TTF/OTF/CFF) for the named font.
    #[napi]
    pub fn get_font(&self, id: u32, name: String) -> Result<Buffer> {
        let guard = self.store.lock().unwrap();
        fonts::get(&guard, id, &name)
    }
}

#[napi(object)]
pub struct PageSize {
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    /// RGBA pixel data, row-major, width * height * 4 bytes.
    pub rgba: Buffer,
}

#[napi(object)]
pub struct TextItem {
    pub text: String,
    /// Rect in PDF points, origin top-left (converted from PDF coords).
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_size: f64,
    pub font_name: Option<String>,
}

#[napi(object)]
pub struct SearchHit {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
pub struct FontInfo {
    pub name: String,
    pub is_embedded: bool,
}
