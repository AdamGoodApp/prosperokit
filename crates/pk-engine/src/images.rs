//! Image store (Phase 3 §10): decoded pixmaps keyed by `uri` with an LRU
//! byte budget (128 MiB). The engine never decodes or fetches: it queues the
//! uris it needs (`take_requests`) and the runtime answers with
//! `Engine::image_loaded`.

use std::sync::Arc;

use pk_protocol::NodeId;
use pk_protocol::Value;
use pk_protocol::events::{EventKind, UiEvent};
use pk_protocol::ops::NodeKind;
use tiny_skia::{IntSize, Pixmap};

use crate::Engine;
use crate::hash::FxMap;
use crate::lru::Lru;

pub const IMAGE_CACHE_BYTES: usize = 128 * 1024 * 1024;

/// Straight-alpha RGBA8 as produced by the runtime's decoder.
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Default)]
pub struct ImageStore {
    ready: Lru<String, Arc<Pixmap>>,
    loading: FxMap<String, ()>,
    failed: FxMap<String, String>,
    queue: Vec<String>,
    budget: usize,
}

impl ImageStore {
    pub fn new() -> ImageStore {
        ImageStore {
            budget: IMAGE_CACHE_BYTES,
            ..ImageStore::default()
        }
    }

    pub fn set_budget(&mut self, bytes: usize) {
        self.budget = bytes;
    }

    pub fn size(&self, uri: &str) -> Option<(u32, u32)> {
        self.ready
            .peek(&uri.to_string())
            .map(|p| (p.width(), p.height()))
    }

    pub fn is_failed(&self, uri: &str) -> bool {
        self.failed.contains_key(uri)
    }

    /// Queue a load unless the image is ready, loading or failed.
    pub fn request(&mut self, uri: &str) {
        let key = uri.to_string();
        if self.ready.contains(&key)
            || self.loading.contains_key(uri)
            || self.failed.contains_key(uri)
        {
            return;
        }
        self.loading.insert(key.clone(), ());
        self.queue.push(key);
    }

    /// The decoded pixmap, or `None` (queueing a load) when it is not resident.
    pub fn get_or_request(&mut self, uri: &str) -> Option<Arc<Pixmap>> {
        let key = uri.to_string();
        if let Some(p) = self.ready.get(&key) {
            return Some(p.clone());
        }
        self.request(uri);
        None
    }

    pub fn take_requests(&mut self) -> Vec<String> {
        std::mem::take(&mut self.queue)
    }

    pub fn clear_pending(&mut self) {
        self.queue.clear();
        self.loading.clear();
    }

    /// Store a decoded image (premultiplying it) or record the failure.
    pub fn loaded(
        &mut self,
        uri: &str,
        result: Result<DecodedImage, String>,
    ) -> Result<(), String> {
        self.loading.remove(uri);
        let img = match result {
            Ok(i) => i,
            Err(e) => {
                self.failed.insert(uri.to_string(), e.clone());
                return Err(e);
            }
        };
        let fail = |this: &mut ImageStore, msg: String| {
            this.failed.insert(uri.to_string(), msg.clone());
            Err(msg)
        };
        if img.rgba.len() != (img.width as usize) * (img.height as usize) * 4 {
            return fail(
                self,
                format!(
                    "decoded image has {} bytes, expected {}x{}x4",
                    img.rgba.len(),
                    img.width,
                    img.height
                ),
            );
        }
        let Some(size) = IntSize::from_wh(img.width, img.height) else {
            return fail(self, "image has zero size".to_string());
        };
        let mut data = img.rgba;
        for px in data.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a != 255 {
                px[0] = ((px[0] as u32 * a + 127) / 255) as u8;
                px[1] = ((px[1] as u32 * a + 127) / 255) as u8;
                px[2] = ((px[2] as u32 * a + 127) / 255) as u8;
            }
        }
        let Some(pm) = Pixmap::from_vec(data, size) else {
            return fail(self, "image could not be stored".to_string());
        };
        let cost = pm.data().len();
        self.ready.insert(uri.to_string(), Arc::new(pm), cost);
        self.ready.trim(self.budget, usize::MAX);
        Ok(())
    }

    pub fn resident_bytes(&self) -> usize {
        self.ready.total_cost()
    }

    pub fn clear(&mut self) {
        self.ready.clear();
        self.loading.clear();
        self.failed.clear();
        self.queue.clear();
    }
}

impl Engine {
    /// Queue the load for an `Image` node's `src`.
    pub(crate) fn request_image(&mut self, id: NodeId) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        if node.kind != NodeKind::Image {
            return;
        }
        if let Some(src) = node.props.src.clone() {
            self.images.request(&src);
        }
        self.mark_layout(id);
    }

    /// The runtime finished decoding (or failed to fetch/decode) `uri`.
    pub fn image_loaded(&mut self, uri: &str, result: Result<DecodedImage, String>) {
        let outcome = self.images.loaded(uri, result);
        let ids: Vec<NodeId> = self
            .tree
            .nodes
            .values()
            .filter(|n| n.kind == NodeKind::Image && n.props.src.as_deref() == Some(uri))
            .map(|n| n.id)
            .collect();
        for id in ids {
            self.mark_layout(id);
            let Some(node) = self.tree.get(id) else {
                continue;
            };
            match &outcome {
                Ok(()) if node.subscribed(EventKind::Load.bit()) => {
                    let (w, h) = self.images.size(uri).unwrap_or((0, 0));
                    self.events.push(UiEvent::with_payload(
                        id,
                        EventKind::Load,
                        Value::obj([
                            ("uri", Value::from(uri)),
                            ("width", Value::from(w)),
                            ("height", Value::from(h)),
                        ]),
                    ));
                }
                Err(msg) if node.subscribed(EventKind::Error.bit()) => {
                    self.events.push(UiEvent::with_payload(
                        id,
                        EventKind::Error,
                        Value::obj([
                            ("uri", Value::from(uri)),
                            ("message", Value::from(msg.as_str())),
                        ]),
                    ));
                }
                _ => {}
            }
        }
        self.scene_dirty = true;
    }

    /// Image uris the runtime should fetch and decode (drained).
    pub fn take_image_requests(&mut self) -> Vec<String> {
        self.images.take_requests()
    }
}
