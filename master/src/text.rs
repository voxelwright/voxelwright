//! What the master accepts as text, and the random ids and codes it hands out.

use std::net::{IpAddr, Ipv6Addr};

/// Text someone typed: control characters and bidirectional overrides removed,
/// whitespace trimmed. It stays text; nothing here is ever interpreted.
pub fn clean(s: &str) -> String {
    s.chars()
        .filter(|&c| !c.is_control() && !is_bidi_control(c))
        .collect::<String>()
        .trim()
        .to_string()
}

fn is_bidi_control(c: char) -> bool {
    matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}' | '\u{061C}')
}

/// Cleaned text of at most `max` characters, or why not.
pub fn field(s: &str, what: &str, max: usize, may_be_empty: bool) -> Result<String, String> {
    let c = clean(s);
    if !may_be_empty && c.is_empty() {
        return Err(format!("{what} is empty"));
    }
    if c.chars().count() > max {
        return Err(format!("{what} is over {max} characters"));
    }
    Ok(c)
}

/// The world's release digest, or "town": letters, digits and . _ : - only.
pub fn pin(s: &str) -> Result<String, String> {
    let ok = !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'));
    if ok {
        Ok(s.to_string())
    } else {
        Err("pin is not a digest".into())
    }
}

pub enum SdpError {
    TooBig,
    Bad,
}

/// An SDP is passed on whole and untouched; it only has to look like one.
pub fn sdp(s: &str, max: usize) -> Result<(), SdpError> {
    if s.len() > max {
        return Err(SdpError::TooBig);
    }
    if !s.starts_with("v=0") || s.chars().any(|c| c.is_control() && c != '\r' && c != '\n') {
        return Err(SdpError::Bad);
    }
    Ok(())
}

const ALPHABET: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";
/// A lobby's public id: 12 characters, 60 bits.
pub const ID_LEN: usize = 12;
/// A lobby's private code: 20 characters, 100 bits.
pub const CODE_LEN: usize = 20;

/// `len` characters of Crockford base32 from the operating system's randomness.
pub fn random(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes).expect("the operating system's randomness");
    bytes
        .iter()
        .map(|b| ALPHABET[(b & 31) as usize] as char)
        .collect()
}

/// Ids and codes are looked up in lower case, so a code read aloud or retyped works.
pub fn key(s: &str) -> Option<String> {
    let k = s.to_ascii_lowercase();
    let ok = (k.len() == ID_LEN || k.len() == CODE_LEN) && k.bytes().all(|b| ALPHABET.contains(&b));
    ok.then_some(k)
}

pub fn digest(token: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(token).into()
}

/// Who a caller is for limits and bans: an IPv4 address, or an IPv6 /64 (a home
/// is usually given a /56 or a /48, so counting single v6 addresses would let one
/// machine look like billions). A /48 is also capped as a whole; see state.rs.
pub fn addr_key(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => ip,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let s = v6.segments();
                IpAddr::V6(Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_controls_and_overrides() {
        assert_eq!(clean(" a\u{0}b\u{1b}[31mc\u{202E}d\n "), "ab[31mcd");
        assert_eq!(field("<b>hi</b>", "name", 48, false).unwrap(), "<b>hi</b>");
    }

    #[test]
    fn keys() {
        let id = random(ID_LEN);
        let code = random(CODE_LEN);
        assert_eq!(key(&id).unwrap(), id);
        assert_eq!(key(&code.to_uppercase()).unwrap(), code);
        assert!(key("short").is_none());
        assert!(key("iiiiiiiiiiii").is_none());
    }

    #[test]
    fn v6_by_64() {
        let a: IpAddr = "2001:db8:1:2:aaaa::1".parse().unwrap();
        let b: IpAddr = "2001:db8:1:2:bbbb::9".parse().unwrap();
        let c: IpAddr = "2001:db8:1:100::1".parse().unwrap();
        assert_eq!(addr_key(a), addr_key(b));
        assert_ne!(addr_key(a), addr_key(c));
        let m: IpAddr = "::ffff:192.0.2.7".parse().unwrap();
        assert_eq!(addr_key(m), "192.0.2.7".parse::<IpAddr>().unwrap());
    }
}
