//! A STUN binding responder (RFC 8489, the Binding method only), so players can
//! learn their public address from the master instead of from a third party.
//! It answers a Binding request with the sender's address in XOR-MAPPED-ADDRESS
//! and drops everything else. The answer is 32 bytes (IPv4) or 44 (IPv6) for a
//! request of at least 20, and each address is held to --stun-per-minute.

use std::net::{IpAddr, SocketAddr};

use tokio::net::UdpSocket;

use crate::state::Shared;
use crate::text;

const COOKIE: u32 = 0x2112_A442;
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;

pub async fn serve(sock: UdpSocket, st: Shared) {
    let mut buf = [0u8; 1500];
    loop {
        let Ok((n, from)) = sock.recv_from(&mut buf).await else {
            continue;
        };
        let Some(reply) = answer(&buf[..n], from) else {
            continue;
        };
        if !st.stun(text::addr_key(from.ip())) {
            continue;
        }
        let _ = sock.send_to(&reply, from).await;
    }
}

/// The answer to one datagram, or None if it is not a Binding request.
pub fn answer(req: &[u8], from: SocketAddr) -> Option<Vec<u8>> {
    if req.len() < 20 || req[0] & 0xC0 != 0 {
        return None;
    }
    let kind = u16::from_be_bytes([req[0], req[1]]);
    let len = u16::from_be_bytes([req[2], req[3]]) as usize;
    let cookie = u32::from_be_bytes([req[4], req[5], req[6], req[7]]);
    if kind != BINDING_REQUEST || cookie != COOKIE || len != req.len() - 20 || len % 4 != 0 {
        return None;
    }
    let txid = &req[8..20];
    let ip = from.ip().to_canonical();
    let port = from.port() ^ (COOKIE >> 16) as u16;
    let mut value = vec![0u8, 0, 0, 0];
    value[2..4].copy_from_slice(&port.to_be_bytes());
    match ip {
        IpAddr::V4(v4) => {
            value[1] = 0x01;
            let x = u32::from(v4) ^ COOKIE;
            value.extend_from_slice(&x.to_be_bytes());
        }
        IpAddr::V6(v6) => {
            value[1] = 0x02;
            let mut key = COOKIE.to_be_bytes().to_vec();
            key.extend_from_slice(txid);
            value.extend(v6.octets().iter().zip(key).map(|(a, k)| a ^ k));
        }
    }
    let mut out = Vec::with_capacity(20 + 4 + value.len());
    out.extend_from_slice(&BINDING_SUCCESS.to_be_bytes());
    out.extend_from_slice(&((4 + value.len()) as u16).to_be_bytes());
    out.extend_from_slice(&COOKIE.to_be_bytes());
    out.extend_from_slice(txid);
    out.extend_from_slice(&XOR_MAPPED_ADDRESS.to_be_bytes());
    out.extend_from_slice(&(value.len() as u16).to_be_bytes());
    out.extend_from_slice(&value);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(txid: [u8; 12]) -> Vec<u8> {
        let mut r = vec![0x00, 0x01, 0x00, 0x00];
        r.extend_from_slice(&COOKIE.to_be_bytes());
        r.extend_from_slice(&txid);
        r
    }

    #[test]
    fn answers_ipv4_with_the_rfc_5769_encoding() {
        // RFC 5769 2.2: 192.0.2.1:32853 encodes as port 0xa147, address 0xe112a643.
        let txid = [
            0xb7, 0xe7, 0xa7, 0x01, 0xbc, 0x34, 0xd6, 0x86, 0xfa, 0x87, 0xdf, 0xae,
        ];
        let r = answer(&request(txid), "192.0.2.1:32853".parse().unwrap()).unwrap();
        assert_eq!(&r[0..2], &[0x01, 0x01]);
        assert_eq!(&r[8..20], &txid);
        assert_eq!(&r[20..24], &[0x00, 0x20, 0x00, 0x08]);
        assert_eq!(
            &r[24..32],
            &[0x00, 0x01, 0xa1, 0x47, 0xe1, 0x12, 0xa6, 0x43]
        );
    }

    #[test]
    fn answers_ipv6_with_the_rfc_5769_encoding() {
        // RFC 5769 2.3: 2001:db8:1234:5678:11:2233:4455:6677 port 32853.
        let txid = [
            0xb7, 0xe7, 0xa7, 0x01, 0xbc, 0x34, 0xd6, 0x86, 0xfa, 0x87, 0xdf, 0xae,
        ];
        let from: SocketAddr = "[2001:db8:1234:5678:11:2233:4455:6677]:32853"
            .parse()
            .unwrap();
        let r = answer(&request(txid), from).unwrap();
        let want = [
            0x00, 0x02, 0xa1, 0x47, 0x01, 0x13, 0xa9, 0xfa, 0xa5, 0xd3, 0xf1, 0x79, 0xbc, 0x25,
            0xf4, 0xb5, 0xbe, 0xd2, 0xb9, 0xd9,
        ];
        assert_eq!(&r[24..], &want);
    }

    #[test]
    fn drops_what_is_not_a_binding_request() {
        let ok = request([7; 12]);
        let from: SocketAddr = "198.51.100.4:4000".parse().unwrap();
        assert!(answer(&ok[..19], from).is_none());
        let mut r = ok.clone();
        r[1] = 0x11; // an indication
        assert!(answer(&r, from).is_none());
        let mut r = ok.clone();
        r[4] = 0; // no cookie
        assert!(answer(&r, from).is_none());
        let mut r = ok.clone();
        r.extend_from_slice(&[0, 0, 0, 0]); // length field disagrees
        assert!(answer(&r, from).is_none());
        // A request with attributes (Chromium sends some) is answered.
        let mut r = ok.clone();
        r[3] = 8;
        r.extend_from_slice(&[0x80, 0x22, 0x00, 0x04, b'a', b'b', b'c', b'd']);
        assert!(answer(&r, from).is_some());
    }
}
