use napi::Result;
use pdfium_render::prelude::*;

use crate::{document::DocumentStore, SearchHit, TextItem};

fn get_page(doc: &PdfDocument<'static>, index: u32) -> Result<PdfPage<'static>> {
    doc.pages()
        .get(index as PdfPageIndex)
        .map_err(|e| napi::Error::from_reason(format!("failed to open page {index}: {e}")))
}

/// Maps unrotated PDF-space geometry into the rendered (rotated) view space.
///
/// pdfium reports the ROTATED page size via `page.width()/height()` while text
/// extraction returns UNROTATED PDF coordinates (bottom-left origin). The
/// rendered bitmap, however, shows the rotated view — so all rectangles we
/// hand to the renderer must be in view space (top-left origin).
struct ViewTransform {
    rot: u32,
    /// Unrotated MediaBox width.
    w: f64,
    /// Unrotated MediaBox height.
    h: f64,
}

impl ViewTransform {
    fn new(page: &PdfPage<'static>) -> Result<Self> {
        let rot = match page
            .rotation()
            .map_err(|e| napi::Error::from_reason(format!("failed to read page rotation: {e}")))?
        {
            PdfPageRenderRotation::None => 0,
            PdfPageRenderRotation::Degrees90 => 90,
            PdfPageRenderRotation::Degrees180 => 180,
            PdfPageRenderRotation::Degrees270 => 270,
        };
        // page.width()/height() return the ROTATED (effective) size; recover
        // the unrotated MediaBox dimensions from it.
        let eff_w = page.width().value as f64;
        let eff_h = page.height().value as f64;
        let (w, h) = if rot == 90 || rot == 270 {
            (eff_h, eff_w)
        } else {
            (eff_w, eff_h)
        };
        Ok(Self { rot, w, h })
    }

    /// (x, y_bottom, w, h) in unrotated PDF space → (x, y_top, w, h) in view space.
    fn rect(&self, x: f64, y_b: f64, w: f64, h: f64) -> (f64, f64, f64, f64) {
        match self.rot {
            0 => (x, self.h - y_b - h, w, h),
            90 => (y_b, x, h, w),
            180 => (self.w - x - w, y_b, w, h),
            270 => (self.h - y_b - h, self.w - x - w, h, w),
            _ => (x, y_b, w, h),
        }
    }
}

/// All visible text line-segments on the page, in VIEW space (matches the rendered bitmap).
pub fn text_items(store: &DocumentStore, id: u32, index: u32) -> Result<Vec<TextItem>> {
    store.with_doc(id, |doc| {
        let page = get_page(doc, index)?;
        let t = ViewTransform::new(&page)?;
        let text = page.text().map_err(|e| {
            napi::Error::from_reason(format!("text extraction failed: {e}"))
        })?;
        let mut items = Vec::new();
        for segment in text.segments().iter() {
            let content = segment.text();
            if content.trim().is_empty() {
                continue;
            }
            let quad = segment.bounds().to_quad_points();
            let left = quad.left().value as f64;
            let right = quad.right().value as f64;
            let bottom = quad.bottom().value as f64;
            let top = quad.top().value as f64;
            let (x, y, width, height) = t.rect(left, bottom, right - left, top - bottom);
            let (font_size, font_name) = match segment.chars() {
                Ok(chars) => chars.iter().next().map_or((0.0, None), |c| {
                    (c.scaled_font_size().value as f64, Some(c.font_name()))
                }),
                Err(_) => (0.0, None),
            };
            items.push(TextItem {
                text: content,
                x,
                y,
                width,
                height,
                font_size,
                font_name,
            });
        }
        Ok(items)
    })
}

/// Case-insensitive search across all pages; hit rects are in VIEW space.
pub fn search_document(store: &DocumentStore, id: u32, query: &str) -> Result<Vec<SearchHit>> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    store.with_doc(id, |doc| {
        let count = doc.pages().len() as u32;
        let options = PdfSearchOptions::new(); // case-sensitive off by default? verify empirically
        let mut hits = Vec::new();
        for index in 0..count {
            let page = match doc.pages().get(index as PdfPageIndex) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let t = match ViewTransform::new(&page) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let text = match page.text() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let search = match text.search(query, &options) {
                Ok(s) => s,
                Err(_) => continue,
            };
            while let Some(segments) = search.find_next() {
                for segment in segments.iter() {
                    let quad = segment.bounds().to_quad_points();
                    let left = quad.left().value as f64;
                    let right = quad.right().value as f64;
                    let bottom = quad.bottom().value as f64;
                    let top = quad.top().value as f64;
                    let (x, y, width, height) = t.rect(left, bottom, right - left, top - bottom);
                    hits.push(SearchHit {
                        page: index,
                        x,
                        y,
                        width,
                        height,
                    });
                }
            }
        }
        Ok(hits)
    })
}
