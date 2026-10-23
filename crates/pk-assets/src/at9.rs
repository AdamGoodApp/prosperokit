const MAX_LEN: usize = 2_097_152;
const GUID: [u8; 16] = [
    0xD2, 0x42, 0xE1, 0x47, 0xBA, 0x36, 0x8D, 0x4D, 0x88, 0xFC, 0x61, 0x65, 0x4F, 0x8C, 0x83, 0x6C,
];

fn u16at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}
fn u32at(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

/// Validate ATRAC9 RIFF/WAVE; the error names the violated rule.
pub fn check_at9(data: &[u8]) -> Result<(), String> {
    if data.len() > MAX_LEN {
        return Err(format!("is larger than {MAX_LEN} bytes"));
    }
    if data.len() < 12
        || &data[..4] != b"RIFF"
        || &data[8..12] != b"WAVE"
        || u32at(data, 4) as usize + 8 != data.len()
    {
        return Err("is not a complete RIFF/WAVE file".into());
    }
    let mut chunks: Vec<([u8; 4], usize, usize)> = Vec::new();
    let mut pos = 12;
    while pos + 8 <= data.len() {
        let id = [data[pos], data[pos + 1], data[pos + 2], data[pos + 3]];
        let size = u32at(data, pos + 4) as usize;
        let payload = pos + 8;
        if payload + size > data.len() {
            return Err("contains a truncated RIFF chunk".into());
        }
        chunks.push((id, payload, size));
        pos = payload + size + size % 2;
    }
    let find = |id: &[u8; 4]| chunks.iter().find(|c| &c.0 == id).copied();
    let mut found = Vec::new();
    for name in [b"fmt ", b"fact", b"smpl", b"data"] {
        match find(name) {
            Some(c) => found.push(c),
            None => {
                return Err(format!(
                    "is missing required RIFF chunk '{}'",
                    String::from_utf8_lossy(name).trim()
                ));
            }
        }
    }
    let (_, fmt, fmt_size) = found[0];
    let (_, smpl, smpl_size) = found[2];
    if fmt_size < 40 {
        return Err("fmt chunk must be at least 40 bytes".into());
    }
    if smpl_size < 32 {
        return Err("smpl chunk must be at least 32 bytes".into());
    }
    if u16at(data, fmt) != 0xFFFE {
        return Err("format tag must be 0xFFFE".into());
    }
    let ch = u16at(data, fmt + 2);
    if !(1..=2).contains(&ch) {
        return Err("must have 1 or 2 channels".into());
    }
    if u32at(data, fmt + 4) != 48_000 {
        return Err("sample rate must be 48000 Hz".into());
    }
    let rate = u32at(data, fmt + 8);
    if rate == 0 || rate > u32::from(ch) * 12_000 {
        return Err("byte rate must be > 0 and <= channels * 12000".into());
    }
    if data[fmt + 24..fmt + 40] != GUID {
        return Err("subformat GUID is not ATRAC9".into());
    }
    if u32at(data, smpl + 28) < 1 {
        return Err("smpl loop count must be >= 1".into());
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn build(mutate: impl Fn(&mut Vec<u8>, &mut Vec<u8>, &mut Vec<u8>)) -> Vec<u8> {
        let mut fmt = vec![0u8; 40];
        fmt[0..2].copy_from_slice(&0xFFFEu16.to_le_bytes());
        fmt[2..4].copy_from_slice(&2u16.to_le_bytes());
        fmt[4..8].copy_from_slice(&48_000u32.to_le_bytes());
        fmt[8..12].copy_from_slice(&24_000u32.to_le_bytes());
        fmt[24..40].copy_from_slice(&GUID);
        let mut smpl = vec![0u8; 36];
        smpl[28..32].copy_from_slice(&1u32.to_le_bytes());
        let mut fact = vec![0u8; 12];
        mutate(&mut fmt, &mut smpl, &mut fact);
        let mut body = b"WAVE".to_vec();
        for (id, p) in [(b"fmt ", &fmt), (b"fact", &fact), (b"smpl", &smpl)] {
            body.extend_from_slice(id);
            body.extend_from_slice(&(p.len() as u32).to_le_bytes());
            body.extend_from_slice(p);
        }
        body.extend_from_slice(b"data");
        body.extend_from_slice(&8u32.to_le_bytes());
        body.extend_from_slice(&[0; 8]);
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend(body);
        out
    }

    #[test]
    fn valid_passes() {
        assert!(check_at9(&build(|_, _, _| {})).is_ok());
    }

    #[test]
    fn invalid_fail_naming_rule() {
        let rate = build(|f, _, _| f[4..8].copy_from_slice(&44_100u32.to_le_bytes()));
        assert!(check_at9(&rate).unwrap_err().contains("48000"));
        let lp = build(|_, s, _| s[28..32].copy_from_slice(&0u32.to_le_bytes()));
        assert!(check_at9(&lp).unwrap_err().contains("loop count"));
        let guid = build(|f, _, _| f[24] = 0);
        assert!(check_at9(&guid).unwrap_err().contains("GUID"));
        let big = vec![0u8; MAX_LEN + 1];
        assert!(check_at9(&big).unwrap_err().contains("larger"));
        let mut missing = build(|_, _, _| {});
        let pos = missing.windows(4).position(|w| w == b"fact").unwrap();
        missing[pos..pos + 4].copy_from_slice(b"junk");
        assert!(check_at9(&missing).unwrap_err().contains("'fact'"));
        let byte_rate = build(|f, _, _| f[8..12].copy_from_slice(&99_999u32.to_le_bytes()));
        assert!(check_at9(&byte_rate).unwrap_err().contains("byte rate"));
    }
}
