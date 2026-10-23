//! Desktop audio: a cpal output stream at 48 kHz stereo i16 that pulls from
//! the runtime's render closure. If the device refuses that format the
//! default configuration is opened instead and the audio resampled linearly.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, FromSample, SampleFormat, SizedSample, Stream, StreamConfig};
use parking_lot::Mutex;

use crate::{AudioOut, PlatformError};

const RATE: u32 = 48_000;
/// Frames pulled from the render closure per refill when resampling.
const CHUNK_FRAMES: usize = 512;

type Render = Box<dyn FnMut(&mut [i16]) + Send>;

pub struct HostAudio {
    stream: Option<Stream>,
    running: Arc<AtomicBool>,
}

impl HostAudio {
    pub(crate) fn new() -> HostAudio {
        HostAudio {
            stream: None,
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn call(render: &Mutex<Render>, data: &mut [i16]) {
    let mut render = render.lock();
    (*render)(data);
}

fn failed(what: &str, e: impl std::fmt::Display) -> PlatformError {
    eprintln!("[pk-platform] audio: {what}: {e}");
    PlatformError::Failed {
        what: format!("audio {what}"),
        code: -1,
    }
}

impl AudioOut for HostAudio {
    fn start(&mut self, render: Box<dyn FnMut(&mut [i16]) + Send>) -> Result<(), PlatformError> {
        if self.stream.is_some() {
            return Err(PlatformError::Busy);
        }
        let device = cpal::default_host()
            .default_output_device()
            .ok_or_else(|| PlatformError::Unsupported("no audio output device".into()))?;
        let render: Arc<Mutex<Render>> = Arc::new(Mutex::new(render));
        let running = self.running.clone();
        let on_error = {
            let running = running.clone();
            move |e: cpal::Error| {
                eprintln!("[pk-platform] audio stream error: {e}");
                running.store(false, Ordering::Relaxed);
            }
        };

        let exact = StreamConfig {
            channels: 2,
            sample_rate: RATE,
            buffer_size: BufferSize::Default,
        };
        let direct = {
            let render = render.clone();
            device.build_output_stream::<i16, _, _>(
                exact,
                move |data, _| call(&render, data),
                on_error.clone(),
                None,
            )
        };
        let stream = match direct {
            Ok(stream) => stream,
            Err(first) => {
                let default = device
                    .default_output_config()
                    .map_err(|e| failed("default config", e))?;
                let config = default.config();
                let (rate, channels) = (config.sample_rate, usize::from(config.channels));
                eprintln!(
                    "[pk-platform] audio: device refused 48 kHz stereo i16 ({first}); resampling to {rate} Hz x{channels}"
                );
                match default.sample_format() {
                    SampleFormat::I16 => {
                        build_resampled::<i16>(&device, config, channels, rate, render, on_error)?
                    }
                    SampleFormat::I32 => {
                        build_resampled::<i32>(&device, config, channels, rate, render, on_error)?
                    }
                    SampleFormat::F32 => {
                        build_resampled::<f32>(&device, config, channels, rate, render, on_error)?
                    }
                    SampleFormat::F64 => {
                        build_resampled::<f64>(&device, config, channels, rate, render, on_error)?
                    }
                    SampleFormat::U16 => {
                        build_resampled::<u16>(&device, config, channels, rate, render, on_error)?
                    }
                    other => {
                        return Err(PlatformError::Unsupported(format!(
                            "audio sample format {other}"
                        )));
                    }
                }
            }
        };
        stream.play().map_err(|e| failed("play", e))?;
        self.running.store(true, Ordering::Relaxed);
        self.stream = Some(stream);
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}

fn build_resampled<T>(
    device: &cpal::Device,
    config: StreamConfig,
    channels: usize,
    rate: u32,
    render: Arc<Mutex<Render>>,
    on_error: impl FnMut(cpal::Error) + Send + 'static,
) -> Result<Stream, PlatformError>
where
    T: SizedSample + FromSample<i16>,
{
    let mut resampler = Resampler::new(render, rate);
    device
        .build_output_stream::<T, _, _>(
            config,
            move |data, _| {
                for frame in data.chunks_mut(channels.max(1)) {
                    let [l, r] = resampler.next_frame();
                    for (i, out) in frame.iter_mut().enumerate() {
                        *out = T::from_sample(match i {
                            0 => l,
                            1 => r,
                            _ => 0,
                        });
                    }
                }
            },
            on_error,
            None,
        )
        .map_err(|e| failed("build stream", e))
}

/// 48 kHz stereo source → arbitrary device rate, linear interpolation.
struct Resampler {
    render: Arc<Mutex<Render>>,
    /// Source frames not yet fully consumed.
    src: Vec<[i16; 2]>,
    scratch: Vec<i16>,
    /// Read position in `src`, in source frames.
    pos: f64,
    /// Source frames advanced per output frame.
    step: f64,
}

impl Resampler {
    fn new(render: Arc<Mutex<Render>>, device_rate: u32) -> Resampler {
        Resampler {
            render,
            src: Vec::new(),
            scratch: vec![0; CHUNK_FRAMES * 2],
            pos: 0.0,
            step: f64::from(RATE) / f64::from(device_rate.max(1)),
        }
    }

    fn next_frame(&mut self) -> [i16; 2] {
        while self.pos as usize + 1 >= self.src.len() {
            let consumed = (self.pos as usize).min(self.src.len());
            self.src.drain(..consumed);
            self.pos -= consumed as f64;
            self.scratch.fill(0);
            call(&self.render, &mut self.scratch);
            self.src
                .extend(self.scratch.as_chunks::<2>().0.iter().copied());
        }
        let i = self.pos as usize;
        let t = self.pos - i as f64;
        let (a, b) = (self.src[i], self.src[i + 1]);
        let lerp =
            |x: i16, y: i16| (f64::from(x) + (f64::from(y) - f64::from(x)) * t).round() as i16;
        self.pos += self.step;
        [lerp(a[0], b[0]), lerp(a[1], b[1])]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp_renderer(step: i16) -> Arc<Mutex<Render>> {
        let mut n: i16 = 0;
        Arc::new(Mutex::new(Box::new(move |buf: &mut [i16]| {
            for frame in buf.as_chunks_mut::<2>().0 {
                frame[0] = n;
                frame[1] = -n;
                n = n.wrapping_add(step);
            }
        })))
    }

    #[test]
    fn resampling_down_interpolates_linearly() {
        // 24 kHz device: two source frames per output frame
        let mut r = Resampler::new(ramp_renderer(100), 24_000);
        assert_eq!(r.next_frame(), [0, 0]);
        assert_eq!(r.next_frame(), [200, -200]);
        assert_eq!(r.next_frame(), [400, -400]);
    }

    #[test]
    fn resampling_up_interpolates_between_frames() {
        // 96 kHz device: half a source frame per output frame
        let mut r = Resampler::new(ramp_renderer(100), 96_000);
        let got: Vec<_> = (0..4).map(|_| r.next_frame()[0]).collect();
        assert_eq!(got, [0, 50, 100, 150]);
    }

    #[test]
    fn long_runs_cross_chunk_boundaries_without_glitches() {
        let mut r = Resampler::new(ramp_renderer(1), 44_100);
        let mut last = -1.0f64;
        for _ in 0..5000 {
            let v = f64::from(r.next_frame()[0]);
            assert!(v >= last, "not monotonic: {last} then {v}");
            last = v;
        }
    }
}
