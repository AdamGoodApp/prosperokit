//! Minimal SVG path-data parser (`d` attribute) producing a tiny-skia path.
//! Supports M/L/H/V/C/S/Q/T/A/Z in absolute and relative forms.

use tiny_skia::{Path, PathBuilder};

struct Lexer<'a> {
    s: &'a [u8],
    i: usize,
}

impl Lexer<'_> {
    fn skip_sep(&mut self) {
        while self.i < self.s.len()
            && (self.s[self.i].is_ascii_whitespace() || self.s[self.i] == b',')
        {
            self.i += 1;
        }
    }

    fn peek_cmd(&mut self) -> Option<u8> {
        self.skip_sep();
        self.s
            .get(self.i)
            .copied()
            .filter(|c| c.is_ascii_alphabetic())
    }

    fn has_number(&mut self) -> bool {
        self.skip_sep();
        matches!(self.s.get(self.i), Some(c) if c.is_ascii_digit() || *c == b'-' || *c == b'+' || *c == b'.')
    }

    fn number(&mut self) -> Option<f32> {
        self.skip_sep();
        let start = self.i;
        let mut seen_dot = false;
        let mut seen_exp = false;
        if matches!(self.s.get(self.i), Some(b'-') | Some(b'+')) {
            self.i += 1;
        }
        while let Some(&c) = self.s.get(self.i) {
            match c {
                b'0'..=b'9' => self.i += 1,
                b'.' if !seen_dot && !seen_exp => {
                    seen_dot = true;
                    self.i += 1;
                }
                b'e' | b'E' if !seen_exp => {
                    seen_exp = true;
                    self.i += 1;
                    if matches!(self.s.get(self.i), Some(b'-') | Some(b'+')) {
                        self.i += 1;
                    }
                }
                _ => break,
            }
        }
        std::str::from_utf8(&self.s[start..self.i])
            .ok()?
            .parse()
            .ok()
    }

    /// Arc flags may be written without separators (`a1 1 0 00 1 1`).
    fn flag(&mut self) -> Option<bool> {
        self.skip_sep();
        let c = *self.s.get(self.i)?;
        self.i += 1;
        match c {
            b'0' => Some(false),
            b'1' => Some(true),
            _ => None,
        }
    }
}

pub fn parse_svg_path(d: &str) -> Option<Path> {
    let mut lx = Lexer {
        s: d.as_bytes(),
        i: 0,
    };
    let mut pb = PathBuilder::new();
    let (mut cx, mut cy) = (0.0f32, 0.0f32);
    let (mut sx, mut sy) = (0.0f32, 0.0f32);
    // Last control point for S/T reflection.
    let mut last_c: Option<(f32, f32)> = None;
    let mut last_q: Option<(f32, f32)> = None;
    let mut cmd = 0u8;
    loop {
        if let Some(c) = lx.peek_cmd() {
            lx.i += 1;
            cmd = c;
            if cmd == b'Z' || cmd == b'z' {
                pb.close();
                cx = sx;
                cy = sy;
                last_c = None;
                last_q = None;
                continue;
            }
        } else if !lx.has_number() || cmd == 0 {
            break;
        } else if cmd == b'M' {
            cmd = b'L';
        } else if cmd == b'm' {
            cmd = b'l';
        }
        let rel = cmd.is_ascii_lowercase();
        let (ox, oy) = if rel { (cx, cy) } else { (0.0, 0.0) };
        let mut next_c = None;
        let mut next_q = None;
        match cmd.to_ascii_uppercase() {
            b'M' => {
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                pb.move_to(x, y);
                cx = x;
                cy = y;
                sx = x;
                sy = y;
            }
            b'L' => {
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                pb.line_to(x, y);
                cx = x;
                cy = y;
            }
            b'H' => {
                let x = lx.number()? + ox;
                pb.line_to(x, cy);
                cx = x;
            }
            b'V' => {
                let y = lx.number()? + oy;
                pb.line_to(cx, y);
                cy = y;
            }
            b'C' => {
                let x1 = lx.number()? + ox;
                let y1 = lx.number()? + oy;
                let x2 = lx.number()? + ox;
                let y2 = lx.number()? + oy;
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                pb.cubic_to(x1, y1, x2, y2, x, y);
                next_c = Some((x2, y2));
                cx = x;
                cy = y;
            }
            b'S' => {
                let (x1, y1) = match last_c {
                    Some((px, py)) => (2.0 * cx - px, 2.0 * cy - py),
                    None => (cx, cy),
                };
                let x2 = lx.number()? + ox;
                let y2 = lx.number()? + oy;
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                pb.cubic_to(x1, y1, x2, y2, x, y);
                next_c = Some((x2, y2));
                cx = x;
                cy = y;
            }
            b'Q' => {
                let x1 = lx.number()? + ox;
                let y1 = lx.number()? + oy;
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                pb.quad_to(x1, y1, x, y);
                next_q = Some((x1, y1));
                cx = x;
                cy = y;
            }
            b'T' => {
                let (x1, y1) = match last_q {
                    Some((px, py)) => (2.0 * cx - px, 2.0 * cy - py),
                    None => (cx, cy),
                };
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                pb.quad_to(x1, y1, x, y);
                next_q = Some((x1, y1));
                cx = x;
                cy = y;
            }
            b'A' => {
                let rx = lx.number()?;
                let ry = lx.number()?;
                let rot = lx.number()?;
                let large = lx.flag()?;
                let sweep = lx.flag()?;
                let x = lx.number()? + ox;
                let y = lx.number()? + oy;
                arc_to(&mut pb, cx, cy, rx, ry, rot, large, sweep, x, y);
                cx = x;
                cy = y;
            }
            _ => return None,
        }
        last_c = next_c;
        last_q = next_q;
    }
    pb.finish()
}

#[allow(clippy::too_many_arguments)]
fn arc_to(
    pb: &mut PathBuilder,
    x0: f32,
    y0: f32,
    rx: f32,
    ry: f32,
    rot_deg: f32,
    large: bool,
    sweep: bool,
    x: f32,
    y: f32,
) {
    if (x0 - x).abs() < 1e-6 && (y0 - y).abs() < 1e-6 {
        return;
    }
    let (mut rx, mut ry) = (rx.abs() as f64, ry.abs() as f64);
    if rx == 0.0 || ry == 0.0 {
        pb.line_to(x, y);
        return;
    }
    let phi = (rot_deg as f64).to_radians();
    let (sin_phi, cos_phi) = phi.sin_cos();
    let dx2 = (x0 as f64 - x as f64) / 2.0;
    let dy2 = (y0 as f64 - y as f64) / 2.0;
    let x1p = cos_phi * dx2 + sin_phi * dy2;
    let y1p = -sin_phi * dx2 + cos_phi * dy2;
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let s = lambda.sqrt();
        rx *= s;
        ry *= s;
    }
    let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let mut coef = if den == 0.0 {
        0.0
    } else {
        (num / den).max(0.0).sqrt()
    };
    if large == sweep {
        coef = -coef;
    }
    let cxp = coef * (rx * y1p / ry);
    let cyp = coef * -(ry * x1p / rx);
    let cx = cos_phi * cxp - sin_phi * cyp + (x0 as f64 + x as f64) / 2.0;
    let cy = sin_phi * cxp + cos_phi * cyp + (y0 as f64 + y as f64) / 2.0;
    let ang = |ux: f64, uy: f64, vx: f64, vy: f64| {
        let dot = ux * vx + uy * vy;
        let len = (ux * ux + uy * uy).sqrt() * (vx * vx + vy * vy).sqrt();
        let mut a = (dot / len).clamp(-1.0, 1.0).acos();
        if ux * vy - uy * vx < 0.0 {
            a = -a;
        }
        a
    };
    let theta1 = ang(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut dtheta = ang(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry,
    );
    if !sweep && dtheta > 0.0 {
        dtheta -= std::f64::consts::TAU;
    } else if sweep && dtheta < 0.0 {
        dtheta += std::f64::consts::TAU;
    }
    let segs = (dtheta.abs() / (std::f64::consts::FRAC_PI_2))
        .ceil()
        .max(1.0) as usize;
    let delta = dtheta / segs as f64;
    let t = 4.0 / 3.0 * (delta / 4.0).tan();
    let mut th = theta1;
    for _ in 0..segs {
        let (s1, c1) = th.sin_cos();
        let (s2, c2) = (th + delta).sin_cos();
        let p = |ex: f64, ey: f64| {
            (
                (cos_phi * rx * ex - sin_phi * ry * ey + cx) as f32,
                (sin_phi * rx * ex + cos_phi * ry * ey + cy) as f32,
            )
        };
        let (c1x, c1y) = p(c1 - t * s1, s1 + t * c1);
        let (c2x, c2y) = p(c2 + t * s2, s2 - t * c2);
        let (ex, ey) = p(c2, s2);
        pb.cubic_to(c1x, c1y, c2x, c2y, ex, ey);
        th += delta;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lucide_like_paths() {
        let p = parse_svg_path("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z m-3 8 l2 2 4-4").unwrap();
        let b = p.bounds();
        assert!(
            (b.left() - 2.0).abs() < 0.05 && (b.right() - 22.0).abs() < 0.05,
            "{b:?}"
        );
        assert!(parse_svg_path("M0 0h24v24H0z").is_some());
        assert!(parse_svg_path("garbage").is_none());
    }
}
