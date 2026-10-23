//! Colours: straight (non-premultiplied) RGBA in 0..1. JS sends `0xRRGGBBAA`
//! numbers (the Tailwind compiler's output) or CSS-like strings (`#rgb`,
//! `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `transparent`, a few names).

use crate::value::Value;

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const TRANSPARENT: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };
    pub const BLACK: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };
    pub const WHITE: Color = Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };

    pub const fn rgba(r: f32, g: f32, b: f32, a: f32) -> Color {
        Color { r, g, b, a }
    }

    pub const fn rgb8(r: u8, g: u8, b: u8) -> Color {
        Color {
            r: r as f32 / 255.0,
            g: g as f32 / 255.0,
            b: b as f32 / 255.0,
            a: 1.0,
        }
    }

    /// `0xRRGGBBAA`.
    pub fn from_rgba_u32(v: u32) -> Color {
        Color {
            r: ((v >> 24) & 0xff) as f32 / 255.0,
            g: ((v >> 16) & 0xff) as f32 / 255.0,
            b: ((v >> 8) & 0xff) as f32 / 255.0,
            a: (v & 0xff) as f32 / 255.0,
        }
    }

    pub fn to_rgba_u32(self) -> u32 {
        let q = |c: f32| (c.clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
        q(self.r) << 24 | q(self.g) << 16 | q(self.b) << 8 | q(self.a)
    }

    pub fn with_alpha(self, a: f32) -> Color {
        Color { a, ..self }
    }

    pub fn is_transparent(self) -> bool {
        self.a <= 0.0
    }

    /// Linear interpolation in straight RGBA.
    pub fn lerp(self, to: Color, t: f32) -> Color {
        let t = t.clamp(0.0, 1.0);
        Color {
            r: self.r + (to.r - self.r) * t,
            g: self.g + (to.g - self.g) * t,
            b: self.b + (to.b - self.b) * t,
            a: self.a + (to.a - self.a) * t,
        }
    }

    pub fn parse(text: &str) -> Option<Color> {
        let s = text.trim();
        if let Some(hex) = s.strip_prefix('#') {
            let digits: Vec<u8> = hex.bytes().map(hex_val).collect::<Option<Vec<_>>>()?;
            return match digits.len() {
                3 => Some(Color::rgb8(digits[0] * 17, digits[1] * 17, digits[2] * 17)),
                4 => Some(
                    Color::rgb8(digits[0] * 17, digits[1] * 17, digits[2] * 17)
                        .with_alpha((digits[3] * 17) as f32 / 255.0),
                ),
                6 => Some(Color::rgb8(
                    digits[0] << 4 | digits[1],
                    digits[2] << 4 | digits[3],
                    digits[4] << 4 | digits[5],
                )),
                8 => Some(
                    Color::rgb8(
                        digits[0] << 4 | digits[1],
                        digits[2] << 4 | digits[3],
                        digits[4] << 4 | digits[5],
                    )
                    .with_alpha((digits[6] << 4 | digits[7]) as f32 / 255.0),
                ),
                _ => None,
            };
        }
        let lower = s.to_ascii_lowercase();
        if let Some(inner) = lower
            .strip_prefix("rgba(")
            .or_else(|| lower.strip_prefix("rgb("))
        {
            let inner = inner.strip_suffix(')')?;
            let parts: Vec<&str> = inner
                .split([',', '/', ' '])
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .collect();
            if parts.len() < 3 {
                return None;
            }
            let chan = |p: &str| -> Option<f32> {
                if let Some(pct) = p.strip_suffix('%') {
                    pct.parse::<f32>().ok().map(|v| v / 100.0)
                } else {
                    p.parse::<f32>().ok().map(|v| v / 255.0)
                }
            };
            let alpha = |p: &str| -> Option<f32> {
                if let Some(pct) = p.strip_suffix('%') {
                    pct.parse::<f32>().ok().map(|v| v / 100.0)
                } else {
                    p.parse::<f32>().ok()
                }
            };
            return Some(Color {
                r: chan(parts[0])?,
                g: chan(parts[1])?,
                b: chan(parts[2])?,
                a: parts.get(3).map(|p| alpha(p)).unwrap_or(Some(1.0))?,
            });
        }
        match lower.as_str() {
            "transparent" => Some(Color::TRANSPARENT),
            "black" => Some(Color::BLACK),
            "white" => Some(Color::WHITE),
            "red" => Some(Color::rgb8(255, 0, 0)),
            "green" => Some(Color::rgb8(0, 128, 0)),
            "blue" => Some(Color::rgb8(0, 0, 255)),
            "yellow" => Some(Color::rgb8(255, 255, 0)),
            "gray" | "grey" => Some(Color::rgb8(128, 128, 128)),
            "currentcolor" => None,
            _ => None,
        }
    }

    /// Accepts a number (`0xRRGGBBAA`) or a string.
    pub fn from_value(v: &Value) -> Option<Color> {
        match v {
            Value::Num(_) => v.as_u32().map(Color::from_rgba_u32),
            Value::Str(s) => Color::parse(s),
            _ => None,
        }
    }
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_rgb_and_numbers() {
        assert_eq!(Color::parse("#fff"), Some(Color::WHITE));
        assert_eq!(Color::parse("#0070d1"), Some(Color::rgb8(0, 0x70, 0xd1)));
        assert_eq!(Color::parse("#0070d180").unwrap().a, 128.0 / 255.0);
        assert_eq!(
            Color::parse("rgba(255, 255, 255, 0.5)"),
            Some(Color::WHITE.with_alpha(0.5))
        );
        assert_eq!(
            Color::parse("rgb(0 112 209 / 50%)").unwrap().g,
            112.0 / 255.0
        );
        assert_eq!(Color::from_rgba_u32(0x0070d1ff), Color::rgb8(0, 0x70, 0xd1));
        assert_eq!(Color::rgb8(0, 0x70, 0xd1).to_rgba_u32(), 0x0070d1ff);
        assert_eq!(
            Color::from_value(&Value::Num(0xff00_00ff_u32 as f64)),
            Some(Color::rgb8(255, 0, 0))
        );
        assert_eq!(Color::parse("transparent"), Some(Color::TRANSPARENT));
        assert_eq!(Color::parse("nope"), None);
    }
}
