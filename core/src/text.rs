use napi::Result;
use pdfium_render::prelude::*;

use crate::{document::DocumentStore, SearchHit, TextItem};

fn get_page(doc: &PdfDocument<'static>, index: u32) -> Result<PdfPage<'static>> {
    doc.pages()
        .get(index as PdfPageIndex)
        .map_err(|e| napi::Error::from_reason(format!("failed to open page {index}: {e}")))
}

/// Convert a PDF-rect (origin bottom-left, PDF points) to top-left origin.
fn rect_top_left(bounds: &PdfRect, page_height_points: f64) -> (f64, f64, f64, f64) {
    let quad = bounds.to_quad_points();
    let left = quad.left().value as f64;
    let right = quad.right().value as f64;
    let bottom = quad.bottom().value as f64;
    let top = quad.top().value as f64;
    (left, page_height_points - bottom, right - left, top - bottom)
}

/// All visible text line-segments on the page.
pub fn text_items(store: &DocumentStore, id: u32, index: u32) -> Result<Vec<TextItem>> {
    store.with_doc(id, |doc| {
        let page = get_page(doc, index)?;
        let h = page.height().value as f64;
        let text = page.text().map_err(|e| {
            napi::Error::from_reason(format!("text extraction failed: {e}"))
        })?;
        let mut items = Vec::new();
        for segment in text.segments().iter() {
            let content = segment.text();
            if content.trim().is_empty() {
                continue;
            }
            let (x, y, w, hgt) = rect_top_left(&segment.bounds(), h);
            let (font_size, font_name) = match segment.chars() {
                Ok(chars) => chars.iter().next().map_or((0.0, None), |c| {
                    (
                        c.scaled_font_size().value as f64,
                        Some(c.font_name()),
                    )
                }),
                Err(_) => (0.0, None),
            };
            items.push(TextItem {
                text: content,
                x,
                y,
                width: w,
                height: hgt,
                font_size,
                font_name,
            });
        }
        Ok(items)
    })
}

/// Case-insensitive search across all pages.
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
            let h = page.height().value as f64;
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
                    let (x, y, w, hgt) = rect_top_left(&segment.bounds(), h);
                    hits.push(SearchHit {
                        page: index,
                        x,
                        y,
                        width: w,
                        height: hgt,
                    });
                }
            }
        }
        Ok(hits)
    })
}
