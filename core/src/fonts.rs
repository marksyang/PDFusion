use std::collections::HashSet;

use napi::bindgen_prelude::Buffer;
use napi::Result;
use pdfium_render::prelude::*;

use crate::{document::DocumentStore, FontInfo};

/// Enumerate fonts across all pages (deduplicated by name).
pub fn list(store: &DocumentStore, id: u32) -> Result<Vec<FontInfo>> {
    store.with_doc(id, |doc| {
        let count = doc.pages().len() as u32;
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        for index in 0..count {
            let page = match doc.pages().get(index as PdfPageIndex) {
                Ok(p) => p,
                Err(_) => continue,
            };
            for font in page.fonts() {
                let name = font.name();
                if seen.insert(name.clone()) {
                    out.push(FontInfo {
                        name,
                        is_embedded: font.is_embedded().unwrap_or(false),
                    });
                }
            }
        }
        Ok(out)
    })
}

/// Font file bytes for the font with the given name.
pub fn get(store: &DocumentStore, id: u32, name: &str) -> Result<Buffer> {
    store.with_doc(id, |doc| {
        let count = doc.pages().len() as u32;
        for index in 0..count {
            let page = match doc.pages().get(index as PdfPageIndex) {
                Ok(p) => p,
                Err(_) => continue,
            };
            for font in page.fonts() {
                if font.name().eq_ignore_ascii_case(name) {
                    return font
                        .data()
                        .map(Buffer::from)
                        .map_err(|e| napi::Error::from_reason(format!("font data failed: {e}")));
                }
            }
        }
        Err(napi::Error::from_reason(format!(
            "font not found in document: {name}"
        )))
    })
}
