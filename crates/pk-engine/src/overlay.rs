//! Overlays (Phase 3 §11), drawn after the whole tree: toast, host IME
//! overlay, dev error panel (full width, top, `#3a0d0d`, white 28 px text,
//! wraps) and dev stats (bottom-left, 20 px mono).

use std::sync::Arc;

use pk_protocol::{Color, Rect, SCREEN_HEIGHT, SCREEN_WIDTH};
use tiny_skia::Transform;

use crate::display::{Builder, NO_CLIP, NO_RADII, circ};
use crate::text::{TextContent, TextRun, TextStyle};
use crate::{Engine, FrameStats, ImeOverlay};

const ERROR_BG: Color = Color::rgb8(0x3a, 0x0d, 0x0d);
const PANEL_BG: Color = Color::rgb8(0x1a, 0x22, 0x33);
const FIELD_BG: Color = Color::rgb8(0x0b, 0x0f, 0x17);
const MUTED: Color = Color::rgba(1.0, 1.0, 1.0, 0.5);

struct Toast {
    text: String,
    expires_at: f64,
}

/// A shaped string cached by `(text, width)`.
#[derive(Default)]
struct CachedRun {
    key: Option<(String, u32, u32)>,
    run: Option<Arc<TextRun>>,
}

impl CachedRun {
    fn get(
        &mut self,
        b: &mut Builder,
        text: &str,
        style: &TextStyle,
        width: Option<f32>,
    ) -> Arc<TextRun> {
        let key = (
            text.to_string(),
            width.map_or(u32::MAX, f32::to_bits),
            style.hash64() as u32,
        );
        if self.key.as_ref() != Some(&key) || self.run.is_none() {
            self.run = Some(Arc::new(b.text.layout(
                &TextContent::plain(text),
                style,
                width,
            )));
            self.key = Some(key);
        }
        self.run.clone().unwrap_or_default()
    }
}

#[derive(Default)]
pub struct OverlayState {
    toast: Option<Toast>,
    error: Option<String>,
    stats: Option<FrameStats>,
    ime: Option<ImeOverlay>,
    toast_run: CachedRun,
    error_run: CachedRun,
    stats_run: CachedRun,
    ime_title: CachedRun,
    ime_text: CachedRun,
    ime_hint: CachedRun,
}

impl OverlayState {
    pub fn reset_transient(&mut self) {
        self.toast = None;
    }

    /// Drop an expired toast; true if the overlay changed.
    pub fn expire(&mut self, now: f64) -> bool {
        if self.toast.as_ref().is_some_and(|t| now >= t.expires_at) {
            self.toast = None;
            return true;
        }
        false
    }

    pub fn emit(&mut self, b: &mut Builder) {
        let id = Transform::identity();
        let white = Color::WHITE;
        if let Some(ime) = self.ime.clone() {
            b.fill_rect(
                Rect::new(0.0, 0.0, SCREEN_WIDTH as f32, SCREEN_HEIGHT as f32),
                NO_RADII,
                Color::rgba(0.0, 0.0, 0.0, 0.6),
                id,
                NO_CLIP,
                1.0,
            );
            let panel = Rect::new(460.0, 380.0, 1000.0, 220.0);
            b.fill_rect(panel, circ([16.0; 4]), PANEL_BG, id, NO_CLIP, 1.0);
            let title_run = self.ime_title.get(
                b,
                &ime.title,
                &TextStyle::plain(28.0, 600, false),
                Some(936.0),
            );
            b.text_run(
                &title_run,
                (panel.x + 32.0, panel.y + 24.0),
                white,
                id,
                NO_CLIP,
                1.0,
            );
            let field = Rect::new(panel.x + 32.0, panel.y + 90.0, 936.0, 64.0);
            b.fill_rect(field, circ([8.0; 4]), FIELD_BG, id, NO_CLIP, 1.0);
            let shown = if ime.text.is_empty() {
                ime.placeholder.clone()
            } else if ime.secure {
                "•".repeat(ime.text.chars().count())
            } else {
                ime.text.clone()
            };
            let style = TextStyle::plain(28.0, 400, false);
            let run = self.ime_text.get(b, &shown, &style, None);
            let (tx, ty) = (
                field.x + 16.0,
                field.y + ((field.h - run.height) / 2.0).floor(),
            );
            b.text_run(
                &run,
                (tx, ty),
                if ime.text.is_empty() { MUTED } else { white },
                id,
                NO_CLIP,
                1.0,
            );
            if !ime.text.is_empty() {
                // Caret after the typed text.
                b.fill_rect(
                    Rect::new(tx + run.width + 2.0, field.y + 14.0, 2.0, field.h - 28.0),
                    NO_RADII,
                    white,
                    id,
                    NO_CLIP,
                    1.0,
                );
            } else {
                b.fill_rect(
                    Rect::new(tx, field.y + 14.0, 2.0, field.h - 28.0),
                    NO_RADII,
                    white,
                    id,
                    NO_CLIP,
                    1.0,
                );
            }
            let hint = self.ime_hint.get(
                b,
                "Enter to confirm  ·  Esc to cancel",
                &TextStyle::plain(20.0, 400, false),
                None,
            );
            b.text_run(
                &hint,
                (panel.x + 32.0, panel.y + 172.0),
                MUTED,
                id,
                NO_CLIP,
                1.0,
            );
        }
        if let Some(t) = &self.toast {
            let run = self.toast_run.get(
                b,
                &t.text,
                &TextStyle::plain(24.0, 500, false),
                Some(1200.0),
            );
            let w = run.width.ceil() + 56.0;
            let h = run.height.max(30.0) + 28.0;
            let r = Rect::new(
                ((SCREEN_WIDTH as f32 - w) / 2.0).floor(),
                SCREEN_HEIGHT as f32 - h - 80.0,
                w,
                h,
            );
            b.fill_rect(
                r,
                circ([h / 2.0; 4]),
                Color::rgba(0.11, 0.14, 0.2, 0.96),
                id,
                NO_CLIP,
                1.0,
            );
            b.text_run(&run, (r.x + 28.0, r.y + 14.0), white, id, NO_CLIP, 1.0);
        }
        if let Some(text) = self.error.clone() {
            let run = self.error_run.get(
                b,
                &text,
                &TextStyle::plain(28.0, 400, false),
                Some(SCREEN_WIDTH as f32 - 48.0),
            );
            let h = (run.height + 48.0).ceil().min(SCREEN_HEIGHT as f32);
            b.fill_rect(
                Rect::new(0.0, 0.0, SCREEN_WIDTH as f32, h),
                NO_RADII,
                ERROR_BG,
                id,
                NO_CLIP,
                1.0,
            );
            b.text_run(&run, (24.0, 24.0), white, id, NO_CLIP, 1.0);
        }
        if let Some(s) = self.stats {
            let line = format!(
                "frame {:.1} ms  raster {:.1} ms  tiles {}  js {:.1} ms",
                s.frame_ms, s.raster_ms, s.dirty_tiles, s.js_commit_ms
            );
            let run = self
                .stats_run
                .get(b, &line, &TextStyle::plain(20.0, 500, true), None);
            let r = Rect::new(
                12.0,
                SCREEN_HEIGHT as f32 - run.height - 24.0,
                run.width.ceil() + 16.0,
                run.height + 12.0,
            );
            b.fill_rect(
                r,
                circ([6.0; 4]),
                Color::rgba(0.0, 0.0, 0.0, 0.65),
                id,
                NO_CLIP,
                1.0,
            );
            b.text_run(&run, (r.x + 8.0, r.y + 6.0), white, id, NO_CLIP, 1.0);
        }
    }
}

impl Engine {
    /// Show a transient message at the bottom of the screen.
    pub fn toast(&mut self, text: &str, duration_ms: f32) {
        self.overlay
            .toast_set(text, self.now_ms + duration_ms as f64);
        self.scene_dirty = true;
    }

    /// Dev error panel (`None` hides it).
    pub fn set_error_overlay(&mut self, text: Option<String>) {
        self.overlay.error = text.filter(|t| !t.is_empty());
        self.scene_dirty = true;
    }

    pub fn set_stats_overlay(&mut self, stats: Option<FrameStats>) {
        self.overlay.stats = stats;
        self.scene_dirty = true;
    }

    /// Host text-entry overlay (the desktop backend collects keystrokes).
    pub fn set_ime_overlay(&mut self, ime: Option<ImeOverlay>) {
        self.overlay.ime = ime;
        self.scene_dirty = true;
    }
}

impl OverlayState {
    fn toast_set(&mut self, text: &str, expires_at: f64) {
        self.toast = Some(Toast {
            text: text.to_string(),
            expires_at,
        });
    }
}
