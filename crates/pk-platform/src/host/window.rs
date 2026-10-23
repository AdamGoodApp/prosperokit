//! The windowed desktop loop: winit event loop at 60 Hz, softbuffer surface.

use std::num::NonZeroU32;
use std::rc::Rc;
use std::time::{Duration, Instant};

use pk_protocol::{SCREEN_HEIGHT, SCREEN_WIDTH};
use softbuffer::{Context, Surface};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalSize, Size};
use winit::event::{ElementState, KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, NamedKey, PhysicalKey};
use winit::window::{Window, WindowId};

use super::HostFrameHost;
use super::ime::ImeKey;
use crate::{FrameHost, HostEvent};

const FRAME: Duration = Duration::from_nanos(16_666_667);

pub(super) fn run(
    host: HostFrameHost,
    frame: Box<dyn FnMut(&mut dyn FrameHost)>,
    title: &str,
) -> ! {
    let event_loop = match EventLoop::new() {
        Ok(event_loop) => event_loop,
        Err(e) => {
            eprintln!("[pk-host] cannot create the event loop: {e}");
            std::process::exit(1);
        }
    };
    let mut app = App {
        host,
        frame,
        title: title.to_string(),
        window: None,
        surface: None,
        context: None,
        next_frame: Instant::now(),
        close_requests: 0,
    };
    if let Err(e) = event_loop.run_app(&mut app) {
        eprintln!("[pk-host] event loop failed: {e}");
        std::process::exit(1);
    }
    std::process::exit(0)
}

struct App {
    host: HostFrameHost,
    frame: Box<dyn FnMut(&mut dyn FrameHost)>,
    title: String,
    window: Option<Rc<Window>>,
    // Dropped before `context`: declaration order.
    surface: Option<Surface<Rc<Window>, Rc<Window>>>,
    context: Option<Context<Rc<Window>>>,
    next_frame: Instant,
    close_requests: u32,
}

impl App {
    /// The initial window size: exactly 1920×1080 *physical* pixels when that
    /// fits the display (one frame pixel per screen pixel, so text is sharp;
    /// on a 2× Retina display that is 960×540 points), otherwise the largest
    /// 16:9 size that fits, reduced by averaging.
    fn initial_size(event_loop: &ActiveEventLoop) -> Size {
        let (w, h) = (f64::from(SCREEN_WIDTH), f64::from(SCREEN_HEIGHT));
        let Some(monitor) = event_loop
            .primary_monitor()
            .or_else(|| event_loop.available_monitors().next())
        else {
            return LogicalSize::new(w, h).into();
        };
        let physical = monitor.size();
        // Leave room for the title bar, menu bar and dock.
        let (room_w, room_h) = (
            f64::from(physical.width) * 0.9,
            f64::from(physical.height) * 0.8,
        );
        if w <= room_w && h <= room_h {
            return PhysicalSize::new(SCREEN_WIDTH, SCREEN_HEIGHT).into();
        }
        let scale = (room_w / w).min(room_h / h);
        PhysicalSize::new((w * scale).round() as u32, (h * scale).round() as u32).into()
    }

    fn blit(&mut self) {
        let (Some(window), Some(surface)) = (&self.window, &mut self.surface) else {
            return;
        };
        let size = window.inner_size();
        let (Some(w), Some(h)) = (NonZeroU32::new(size.width), NonZeroU32::new(size.height)) else {
            return;
        };
        if let Err(e) = surface.resize(w, h) {
            eprintln!("[pk-host] surface resize failed: {e}");
            return;
        }
        match surface.buffer_mut() {
            Ok(mut buffer) => {
                self.host
                    .video
                    .blit(&mut buffer, w.get() as usize, h.get() as usize);
                if let Err(e) = buffer.present() {
                    eprintln!("[pk-host] present failed: {e}");
                }
            }
            Err(e) => eprintln!("[pk-host] no surface buffer: {e}"),
        }
    }

    fn key(&mut self, event: &KeyEvent) {
        let pressed = event.state == ElementState::Pressed;
        if self.host.ime.is_open() {
            if !pressed {
                return;
            }
            match &event.logical_key {
                Key::Named(NamedKey::Enter) => self.host.ime.input(ImeKey::Enter),
                Key::Named(NamedKey::Escape) => self.host.ime.input(ImeKey::Escape),
                Key::Named(NamedKey::Backspace) => self.host.ime.input(ImeKey::Backspace),
                _ => {
                    if let Some(text) = &event.text {
                        self.host.ime.input(ImeKey::Text(text));
                    }
                }
            }
            return;
        }
        if let PhysicalKey::Code(code) = event.physical_key
            && !event.repeat
        {
            self.host.pad.key(code, pressed);
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attributes = Window::default_attributes()
            .with_title(self.title.as_str())
            .with_inner_size(Self::initial_size(event_loop));
        let window = match event_loop.create_window(attributes) {
            Ok(window) => Rc::new(window),
            Err(e) => {
                eprintln!("[pk-host] cannot create the window: {e}");
                std::process::exit(1);
            }
        };
        let context = match Context::new(window.clone()) {
            Ok(context) => context,
            Err(e) => {
                eprintln!("[pk-host] cannot create the graphics context: {e}");
                std::process::exit(1);
            }
        };
        match Surface::new(&context, window.clone()) {
            Ok(surface) => self.surface = Some(surface),
            Err(e) => {
                eprintln!("[pk-host] cannot create the window surface: {e}");
                std::process::exit(1);
            }
        }
        self.context = Some(context);
        self.window = Some(window);
        self.next_frame = Instant::now();
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_frame));
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                self.close_requests += 1;
                if self.close_requests > 1 {
                    // The runtime did not react to the first request: force it.
                    event_loop.exit();
                } else {
                    self.host.push_event(HostEvent::CloseRequested);
                }
            }
            WindowEvent::Resized(_)
            | WindowEvent::ScaleFactorChanged { .. }
            | WindowEvent::Occluded(false) => {
                self.host.video.invalidate();
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => {
                self.host.video.take_dirty();
                self.blit();
            }
            WindowEvent::KeyboardInput { event, .. } => self.key(&event),
            WindowEvent::Focused(false) => self.host.pad.release_keys(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            return;
        }
        let now = Instant::now();
        if now >= self.next_frame {
            (self.frame)(&mut self.host);
            if self.host.video.take_dirty() {
                self.blit();
            }
            self.next_frame += FRAME;
            if self.next_frame < now {
                self.next_frame = now + FRAME;
            }
        }
        if self.host.exit_requested() {
            event_loop.exit();
            return;
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_frame));
    }
}
