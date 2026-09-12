use std::collections::HashMap;

use napi::Result;
use pdfium_render::prelude::*;

/// A loaded PDF document. `load_pdf_from_byte_vec` takes ownership of the
/// source bytes, so the document is self-contained and 'static.
pub struct StoredDoc {
    pub doc: PdfDocument<'static>,
}

pub struct DocumentStore {
    next_id: u32,
    docs: HashMap<u32, StoredDoc>,
}

impl DocumentStore {
    pub fn new() -> Self {
        Self {
            next_id: 1,
            docs: HashMap::new(),
        }
    }

    pub fn load(&mut self, pdfium: &'static Pdfium, bytes: Vec<u8>) -> Result<u32> {
        let doc = pdfium
            .load_pdf_from_byte_vec(bytes, None)
            .map_err(|e| napi::Error::from_reason(format!("failed to load PDF: {e}")))?;
        let id = self.next_id;
        self.next_id += 1;
        self.docs.insert(id, StoredDoc { doc });
        Ok(id)
    }

    pub fn close(&mut self, id: u32) -> Result<()> {
        if self.docs.remove(&id).is_none() {
            return Err(napi::Error::from_reason(format!(
                "unknown document id: {id}"
            )));
        }
        Ok(())
    }

    pub fn with_doc<R>(
        &self,
        id: u32,
        f: impl FnOnce(&PdfDocument<'static>) -> Result<R>,
    ) -> Result<R> {
        match self.docs.get(&id) {
            Some(entry) => f(&entry.doc),
            None => Err(napi::Error::from_reason(format!(
                "unknown document id: {id}"
            ))),
        }
    }
}
