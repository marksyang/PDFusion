use napi::bindgen_prelude::Buffer;
use napi::Result;
use pdfium_render::prelude::*;

use crate::{document::DocumentStore, PageSize, RenderedPage};

fn get_page(doc: &PdfDocument<'static>, index: u32) -> Result<PdfPage<'static>> {
    doc.pages()
        .get(index as PdfPageIndex)
        .map_err(|e| napi::Error::from_reason(format!("failed to open page {index}: {e}")))
}

pub fn page_count(store: &DocumentStore, id: u32) -> Result<u32> {
    store.with_doc(id, |doc| Ok(doc.pages().len() as u32))
}

pub fn page_size(store: &DocumentStore, id: u32, index: u32) -> Result<PageSize> {
    store.with_doc(id, |doc| {
        let page = get_page(doc, index)?;
        Ok(PageSize {
            width: page.width().value as f64,
            height: page.height().value as f64,
        })
    })
}

/// The page's /Rotate value: 0, 90, 180 or 270 (clockwise degrees).
pub fn page_rotation(store: &DocumentStore, id: u32, index: u32) -> Result<u32> {
    store.with_doc(id, |doc| {
        let page = get_page(doc, index)?;
        let rot = page.rotation().map_err(|e| {
            napi::Error::from_reason(format!("failed to read rotation for page {index}: {e}"))
        })?;
        Ok(match rot {
            PdfPageRenderRotation::None => 0,
            PdfPageRenderRotation::Degrees90 => 90,
            PdfPageRenderRotation::Degrees180 => 180,
            PdfPageRenderRotation::Degrees270 => 270,
        })
    })
}

pub fn render(
    store: &DocumentStore,
    id: u32,
    index: u32,
    scale: f64,
    max_pixels: Option<u32>,
) -> Result<RenderedPage> {
    store.with_doc(id, |doc| {
        let page = get_page(doc, index)?;
        let config = match max_pixels {
            Some(size) => PdfRenderConfig::new().thumbnail(size as i32),
            None => {
                let mut config = PdfRenderConfig::new();
                if scale > 0.0 && (scale - 1.0).abs() > 1e-6 {
                    config = config.scale_page_by_factor(scale as f32);
                }
                config
            }
        };
        let bitmap = page.render_with_config(&config).map_err(|e| {
            napi::Error::from_reason(format!("render failed for page {index}: {e}"))
        })?;
        let width = bitmap.width();
        let height = bitmap.height();
        let rgba = bitmap.as_rgba_bytes();
        if width as usize * height as usize * 4 != rgba.len() {
            return Err(napi::Error::from_reason(
                "unexpected bitmap size from pdfium render",
            ));
        }
        Ok(RenderedPage {
            width: width as u32,
            height: height as u32,
            rgba: Buffer::from(rgba),
        })
    })
}
