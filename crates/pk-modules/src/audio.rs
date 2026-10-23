//! The software mixer: WAV decode, 16 voices, 48 kHz stereo output.

use std::f32::consts::TAU;
use std::sync::Arc;

use pk_js::NativeError;

/// Output sample rate of the mixer (and of every decoded sound).
pub const OUT_RATE: u32 = 48_000;
/// Simultaneous voices; starting a 17th steals the oldest.
pub const MAX_VOICES: usize = 16;
/// The master limiter ceiling, as a fraction of full scale.
pub const LIMIT: f32 = 0.9;

/// Linear-knee soft limiter: transparent below 0.7, asymptotic to [`LIMIT`].
fn limit(x: f32) -> f32 {
    const KNEE: f32 = 0.7;
    let a = x.abs();
    let y = if a <= KNEE {
        a
    } else {
        KNEE + (LIMIT - KNEE) * ((a - KNEE) / (LIMIT - KNEE)).tanh()
    };
    y.copysign(x)
}

/// A decoded sound: stereo frames at [`OUT_RATE`].
struct Sound {
    frames: Vec<[f32; 2]>,
}

struct Voice {
    id: u32,
    sound: Arc<Sound>,
    pos: usize,
    volume: f32,
    looping: bool,
}

pub struct Mixer {
    sounds: Vec<Arc<Sound>>,
    builtins: Vec<(&'static str, Arc<Sound>)>,
    voices: Vec<Voice>,
    next_voice: u32,
}

impl Default for Mixer {
    fn default() -> Self {
        Mixer::new()
    }
}

impl Mixer {
    /// A mixer with the four built-in blips already synthesised.
    pub fn new() -> Mixer {
        let builtins = vec![
            ("navigate", Arc::new(synth(1200.0, 1200.0, 30.0))),
            ("select", Arc::new(synth(900.0, 1400.0, 60.0))),
            ("back", Arc::new(synth(700.0, 700.0, 50.0))),
            ("error", Arc::new(synth(220.0, 220.0, 120.0))),
        ];
        Mixer {
            sounds: Vec::new(),
            builtins,
            voices: Vec::new(),
            next_voice: 1,
        }
    }

    pub fn has_builtin(&self, name: &str) -> bool {
        self.builtins.iter().any(|(n, _)| *n == name)
    }

    /// Decodes a WAV file; returns `(sound id, duration in ms)`. Ids start at 1.
    pub fn load_wav(&mut self, bytes: &[u8]) -> Result<(u32, f64), NativeError> {
        let sound = decode_wav(bytes)?;
        let duration_ms = sound.frames.len() as f64 * 1000.0 / OUT_RATE as f64;
        self.sounds.push(Arc::new(sound));
        Ok((self.sounds.len() as u32, duration_ms))
    }

    /// Starts a loaded sound; returns the voice id.
    pub fn play(&mut self, id: u32, volume: f32, looping: bool) -> Result<u32, NativeError> {
        let sound = id
            .checked_sub(1)
            .and_then(|i| self.sounds.get(i as usize))
            .cloned()
            .ok_or_else(|| NativeError::new("ENOENT", format!("no loaded sound with id {id}")))?;
        Ok(self.start(sound, volume, looping))
    }

    /// Plays a built-in blip; `None` for an unknown name.
    pub fn play_builtin(&mut self, name: &str, volume: f32) -> Option<u32> {
        let sound = self
            .builtins
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, s)| s.clone())?;
        Some(self.start(sound, volume, false))
    }

    fn start(&mut self, sound: Arc<Sound>, volume: f32, looping: bool) -> u32 {
        if self.voices.len() >= MAX_VOICES {
            // Voices are pushed in id order, so index 0 is the oldest.
            self.voices.remove(0);
        }
        let id = self.next_voice;
        self.next_voice = self.next_voice.wrapping_add(1).max(1);
        self.voices.push(Voice {
            id,
            sound,
            pos: 0,
            volume: volume.clamp(0.0, 4.0),
            looping,
        });
        id
    }

    pub fn stop(&mut self, voice: u32) {
        self.voices.retain(|v| v.id != voice);
    }

    pub fn set_volume(&mut self, voice: u32, volume: f32) {
        if let Some(v) = self.voices.iter_mut().find(|v| v.id == voice) {
            v.volume = volume.clamp(0.0, 4.0);
        }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.len()
    }

    /// Fills `out` with interleaved stereo i16 frames (silence when idle).
    pub fn render(&mut self, out: &mut [i16]) {
        for frame in out.as_chunks_mut::<2>().0 {
            let (mut l, mut r) = (0.0f32, 0.0f32);
            for v in &mut self.voices {
                if v.pos >= v.sound.frames.len() {
                    if v.looping && !v.sound.frames.is_empty() {
                        v.pos = 0;
                    } else {
                        continue;
                    }
                }
                let s = v.sound.frames[v.pos];
                l += s[0] * v.volume;
                r += s[1] * v.volume;
                v.pos += 1;
            }
            frame[0] = (limit(l) * 32767.0) as i16;
            frame[1] = (limit(r) * 32767.0) as i16;
        }
        self.voices
            .retain(|v| v.looping || v.pos < v.sound.frames.len());
    }
}

/// A sine blip sweeping `f0 → f1` over `ms`, with short fades.
fn synth(f0: f32, f1: f32, ms: f32) -> Sound {
    let n = (OUT_RATE as f32 * ms / 1000.0) as usize;
    let fade_in = (OUT_RATE as f32 * 0.002) as usize;
    let fade_out = (OUT_RATE as f32 * 0.008) as usize;
    let mut phase = 0.0f32;
    let frames = (0..n)
        .map(|i| {
            let t = i as f32 / n as f32;
            phase += TAU * (f0 + (f1 - f0) * t) / OUT_RATE as f32;
            let mut env = 1.0f32;
            if i < fade_in {
                env = i as f32 / fade_in as f32;
            }
            if n - i <= fade_out {
                env = env.min((n - i) as f32 / fade_out as f32);
            }
            let s = phase.sin() * 0.5 * env;
            [s, s]
        })
        .collect();
    Sound { frames }
}

fn eformat(msg: impl Into<String>) -> NativeError {
    NativeError::new("EFORMAT", msg)
}

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}

fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// RIFF/WAVE, PCM 16-bit, 44.1/48 kHz, mono/stereo → stereo f32 at 48 kHz.
fn decode_wav(b: &[u8]) -> Result<Sound, NativeError> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return Err(eformat("not a RIFF/WAVE file"));
    }
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    let mut data: Option<&[u8]> = None;
    let mut off = 12;
    while off + 8 <= b.len() {
        let id = &b[off..off + 4];
        let size = u32_at(b, off + 4) as usize;
        let body = off + 8;
        let end = body.saturating_add(size).min(b.len());
        if id == b"fmt " && end - body >= 16 {
            fmt = Some((
                u16_at(b, body),
                u16_at(b, body + 2),
                u32_at(b, body + 4),
                u16_at(b, body + 14),
            ));
        } else if id == b"data" {
            data = Some(&b[body..end]);
        }
        off = body.saturating_add(size).saturating_add(size & 1);
    }
    let (tag, channels, rate, bits) = fmt.ok_or_else(|| eformat("WAV has no fmt chunk"))?;
    let data = data.ok_or_else(|| eformat("WAV has no data chunk"))?;
    if tag != 1 || bits != 16 {
        return Err(eformat(format!(
            "unsupported WAV encoding (format {tag}, {bits}-bit); only 16-bit PCM is supported"
        )));
    }
    if channels != 1 && channels != 2 {
        return Err(eformat(format!("unsupported WAV channel count {channels}")));
    }
    if rate != 44_100 && rate != 48_000 {
        return Err(eformat(format!(
            "unsupported WAV sample rate {rate}; use 44100 or 48000"
        )));
    }
    let ch = channels as usize;
    let src: Vec<[f32; 2]> = data
        .chunks_exact(2 * ch)
        .map(|f| {
            let l = i16::from_le_bytes([f[0], f[1]]) as f32 / 32768.0;
            let r = if ch == 2 {
                i16::from_le_bytes([f[2], f[3]]) as f32 / 32768.0
            } else {
                l
            };
            [l, r]
        })
        .collect();
    if src.is_empty() {
        return Err(eformat("WAV contains no samples"));
    }
    Ok(Sound {
        frames: resample(&src, rate),
    })
}

/// Linear resampling to [`OUT_RATE`].
fn resample(src: &[[f32; 2]], rate: u32) -> Vec<[f32; 2]> {
    if rate == OUT_RATE {
        return src.to_vec();
    }
    let n = (src.len() as u64 * OUT_RATE as u64 / rate as u64) as usize;
    let step = rate as f64 / OUT_RATE as f64;
    (0..n)
        .map(|i| {
            let pos = i as f64 * step;
            let i0 = (pos as usize).min(src.len() - 1);
            let i1 = (i0 + 1).min(src.len() - 1);
            let f = (pos - i0 as f64) as f32;
            [
                src[i0][0] + (src[i1][0] - src[i0][0]) * f,
                src[i0][1] + (src[i1][1] - src[i0][1]) * f,
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn wav(rate: u32, channels: u16, bits: u16, samples: &[i16]) -> Vec<u8> {
        let data_len = (samples.len() * 2) as u32;
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&(36 + data_len).to_le_bytes());
        v.extend_from_slice(b"WAVEfmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&channels.to_le_bytes());
        v.extend_from_slice(&rate.to_le_bytes());
        v.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        v.extend_from_slice(&(channels * 2).to_le_bytes());
        v.extend_from_slice(&bits.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            v.extend_from_slice(&s.to_le_bytes());
        }
        v
    }

    #[test]
    fn decodes_mono_and_stereo() {
        let mut m = Mixer::new();
        let (id, dur) = m.load_wav(&wav(48_000, 1, 16, &[1000; 480])).unwrap();
        assert_eq!(id, 1);
        assert!((dur - 10.0).abs() < 1e-6);
        let (id2, dur2) = m.load_wav(&wav(48_000, 2, 16, &[1000; 960])).unwrap();
        assert_eq!(id2, 2);
        assert!((dur2 - 10.0).abs() < 1e-6);
    }

    #[test]
    fn rejects_other_formats() {
        let mut m = Mixer::new();
        for bytes in [
            wav(22_050, 1, 16, &[0; 10]),
            wav(48_000, 3, 16, &[0; 10]),
            b"not a wav file at all".to_vec(),
        ] {
            assert_eq!(m.load_wav(&bytes).unwrap_err().code, "EFORMAT");
        }
        let mut eight = wav(48_000, 1, 16, &[0; 10]);
        eight[34] = 8;
        assert_eq!(m.load_wav(&eight).unwrap_err().code, "EFORMAT");
    }

    #[test]
    fn resamples_44k1_to_48k() {
        let mut m = Mixer::new();
        let (_, dur) = m.load_wav(&wav(44_100, 1, 16, &[8000; 4410])).unwrap();
        assert!((dur - 100.0).abs() < 0.1, "{dur}");
        assert_eq!(m.sounds[0].frames.len(), 4800);
        // a constant signal stays constant
        assert!(
            m.sounds[0]
                .frames
                .iter()
                .all(|f| (f[0] - 8000.0 / 32768.0).abs() < 1e-4)
        );
        // a ramp stays monotonic
        let ramp: Vec<i16> = (0..441).map(|i| (i * 10) as i16).collect();
        m.load_wav(&wav(44_100, 1, 16, &ramp)).unwrap();
        let f = &m.sounds[1].frames;
        assert!(f.windows(2).all(|w| w[1][0] >= w[0][0]));
    }

    #[test]
    fn builtins_render_and_finish() {
        let mut m = Mixer::new();
        for n in ["navigate", "select", "back", "error"] {
            assert!(m.has_builtin(n));
        }
        assert!(m.play_builtin("nope", 1.0).is_none());
        m.play_builtin("select", 1.0).unwrap();
        let mut out = vec![0i16; 2 * 4800];
        m.render(&mut out);
        assert!(out.iter().any(|s| s.abs() > 1000));
        assert_eq!(m.active_voices(), 0);
        let mut again = vec![1i16; 64];
        m.render(&mut again);
        assert!(again.iter().all(|s| *s == 0));
    }

    #[test]
    fn limiter_caps_at_point_nine() {
        let mut m = Mixer::new();
        let (id, _) = m.load_wav(&wav(48_000, 1, 16, &[32767; 4800])).unwrap();
        for _ in 0..8 {
            m.play(id, 1.0, false).unwrap();
        }
        let mut out = vec![0i16; 2 * 1000];
        m.render(&mut out);
        let max = out.iter().map(|s| s.unsigned_abs()).max().unwrap();
        let cap = (0.9 * 32767.0) as u16;
        assert!(max <= cap, "{max} > {cap}");
        assert!(
            max > cap - 50,
            "limiter should saturate near the cap, got {max}"
        );
    }

    #[test]
    fn voices_loop_stop_and_steal() {
        let mut m = Mixer::new();
        let (id, _) = m.load_wav(&wav(48_000, 1, 16, &[4000; 100])).unwrap();
        let v = m.play(id, 0.5, true).unwrap();
        let mut out = vec![0i16; 2 * 1000];
        m.render(&mut out);
        assert_eq!(m.active_voices(), 1);
        assert!(out[1990] != 0, "looping voice is still sounding");
        m.set_volume(v, 0.0);
        m.render(&mut out);
        assert!(out.iter().all(|s| *s == 0));
        m.stop(v);
        assert_eq!(m.active_voices(), 0);
        assert_eq!(m.play(99, 1.0, false).unwrap_err().code, "ENOENT");
        for _ in 0..20 {
            m.play(id, 1.0, true).unwrap();
        }
        assert_eq!(m.active_voices(), MAX_VOICES);
    }
}
