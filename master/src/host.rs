//! A host's WebSocket at GET /host: hello, welcome, now, offer, answer, refuse.
//!
//! Close codes the master uses (the reason says more, as text):
//! 4400 a message the master cannot take, 4403 taken off or refused,
//! 4408 no hello in time, or silent too long.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tokio::time::{Instant, sleep_until, timeout};

use crate::api::{ApiError, caller};
use crate::config::secs;
use crate::state::{Kind, Lobby, Record, Reply, Shared, SlotGuard, ToHost, unix_now};
use crate::text;

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum FromHost {
    Hello(Hello),
    Now(Now),
    Answer { n: u64, sdp: String },
    Refuse { n: u64, why: String },
}

#[derive(Deserialize)]
struct Hello {
    proto: u32,
    name: String,
    #[serde(default)]
    about: String,
    pin: String,
    most: u32,
    #[serde(default)]
    locked: bool,
    #[serde(default = "yes")]
    listed: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
struct Now {
    players: Option<u32>,
    name: Option<String>,
    about: Option<String>,
    pin: Option<String>,
    most: Option<u32>,
    locked: Option<bool>,
    listed: Option<bool>,
}

pub async fn upgrade(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let addr = caller(&st, &headers, peer)?;
    st.charge(addr, Kind::Registration)?;
    let slot = st.slot(addr)?;
    let frame = 2 * st.cfg.max_sdp + 4096;
    Ok(ws
        .max_message_size(frame)
        .max_frame_size(frame)
        // tungstenite's defaults hold 128 KiB a socket for reading; a host sends
        // little, so read 4 KiB at a time and write each message straight out.
        .read_buffer_size(4096)
        .write_buffer_size(0)
        .max_write_buffer_size(2 * frame)
        .on_upgrade(move |sock| run(st, sock, slot))
        .into_response())
}

/// A close frame. Its reason may hold at most 123 bytes (RFC 6455 5.5), so a
/// long one is cut at a character boundary.
fn close(code: u16, why: &str) -> Message {
    let mut end = why.len().min(123);
    while !why.is_char_boundary(end) {
        end -= 1;
    }
    Message::Close(Some(CloseFrame {
        code,
        reason: Utf8Bytes::from(why[..end].to_string()),
    }))
}

fn parse(m: Message) -> Result<Option<FromHost>, String> {
    let text = match m {
        Message::Text(t) => t,
        Message::Binary(_) => return Err("send JSON text".into()),
        _ => return Ok(None),
    };
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("not a message of proto 1: {e}"))
}

async fn send(st: &Shared, sock: &mut WebSocket, m: Message) -> bool {
    matches!(
        timeout(secs(st.cfg.host_write), sock.send(m)).await,
        Ok(Ok(()))
    )
}

async fn bye(st: &Shared, sock: &mut WebSocket, code: u16, why: &str) {
    let _ = send(st, sock, close(code, why)).await;
}

async fn run(st: Shared, mut sock: WebSocket, slot: SlotGuard) {
    // The hello, within its time.
    let hello_by = Instant::now() + secs(st.cfg.hello_wait);
    let hello = loop {
        let got = tokio::select! {
            m = sock.recv() => m,
            _ = sleep_until(hello_by) => return bye(&st, &mut sock, 4408, "no hello in time").await,
        };
        let Some(Ok(m)) = got else { return };
        match parse(m) {
            Ok(None) => continue,
            Ok(Some(FromHost::Hello(h))) => break h,
            Ok(Some(_)) => return bye(&st, &mut sock, 4400, "hello first").await,
            Err(why) => return bye(&st, &mut sock, 4400, &why).await,
        }
    };
    if hello.proto != 1 {
        return bye(&st, &mut sock, 4400, "this master speaks proto 1").await;
    }
    let cfg = &st.cfg;
    let checked = (|| {
        let name = text::field(&hello.name, "name", cfg.max_name, false)?;
        let about = text::field(&hello.about, "about", cfg.max_about, true)?;
        let pin = text::pin(&hello.pin)?;
        if hello.most == 0 || hello.most > cfg.max_most {
            return Err(format!("most is not 1 to {}", cfg.max_most));
        }
        Ok::<_, String>((name, about, pin))
    })();
    let (name, about, pin) = match checked {
        Ok(v) => v,
        Err(why) => return bye(&st, &mut sock, 4400, &why).await,
    };

    let (tx, mut rx) = mpsc::channel(st.cfg.max_pending_joins + 2);
    let made = {
        let mut g = st.lock();
        if g.banned(slot.addr, std::time::Instant::now()) {
            None
        } else {
            let (id, code) = g.fresh();
            let rec = Record {
                id: id.clone(),
                name,
                about,
                pin,
                players: 0,
                most: hello.most,
                locked: hello.locked,
                since: unix_now(),
            };
            g.codes.insert(code.clone(), id.clone());
            g.lobbies.insert(
                id.clone(),
                Lobby {
                    rec,
                    code: code.clone(),
                    listed: hello.listed,
                    addr: slot.addr,
                    tx,
                    pending: HashMap::new(),
                    next_n: 1,
                },
            );
            Some((id, code))
        }
    };
    let Some((id, code)) = made else {
        return bye(&st, &mut sock, 4403, "refused").await;
    };
    eprintln!("lobby {id} up (listed: {})", hello.listed);
    let welcome = json!({ "welcome": { "id": id, "code": code } }).to_string();
    let why = if send(&st, &mut sock, Message::Text(welcome.into())).await {
        serve(&st, &mut sock, &id, &mut rx).await
    } else {
        "write timed out"
    };
    {
        let mut g = st.lock();
        if g.lobbies.get(&id).is_some_and(|l| l.code == code) {
            g.remove(&id);
        }
    }
    eprintln!("lobby {id} gone ({why})");
    drop(slot);
}

/// The lobby's life after its welcome. Returns why it ended.
async fn serve(
    st: &Shared,
    sock: &mut WebSocket,
    id: &str,
    rx: &mut mpsc::Receiver<ToHost>,
) -> &'static str {
    let silence = secs(st.cfg.silence);
    let mut heard = Instant::now();
    let (mut second, mut said) = (Instant::now(), 0u32);
    loop {
        tokio::select! {
            m = sock.recv() => {
                let Some(Ok(m)) = m else { return "socket closed" };
                heard = Instant::now();
                if heard.duration_since(second) >= Duration::from_secs(1) {
                    (second, said) = (heard, 0);
                }
                said += 1;
                if said > st.cfg.host_messages_per_second {
                    bye(st, sock, 4400, "too many messages").await;
                    return "too many messages";
                }
                let msg = match parse(m) {
                    Ok(Some(msg)) => msg,
                    Ok(None) => continue,
                    Err(why) => { bye(st, sock, 4400, &why).await; return "bad message" }
                };
                if let Err(why) = take(st, id, msg) {
                    bye(st, sock, 4400, &why).await;
                    return "bad message";
                }
            }
            cmd = rx.recv() => match cmd {
                Some(ToHost::Offer { n, sdp }) => {
                    let m = json!({ "offer": { "n": n, "sdp": sdp } }).to_string();
                    if !send(st, sock, Message::Text(m.into())).await { return "write timed out" }
                }
                // The lobby was taken off: its sender is gone with it.
                None => { bye(st, sock, 4403, "taken off by the operator").await; return "taken off" }
            },
            _ = sleep_until(heard + silence) => { bye(st, sock, 4408, "silent too long").await; return "silent" }
        }
    }
}

/// Apply one message from a host to its own lobby.
fn take(st: &Shared, id: &str, msg: FromHost) -> Result<(), String> {
    let cfg = &st.cfg;
    let mut g = st.lock();
    let Some(l) = g.lobbies.get_mut(id) else {
        return Ok(());
    };
    match msg {
        FromHost::Hello(_) => return Err("hello once".into()),
        FromHost::Now(now) => {
            // Check everything before changing anything.
            let name = now
                .name
                .as_deref()
                .map(|s| text::field(s, "name", cfg.max_name, false))
                .transpose()?;
            let about = now
                .about
                .as_deref()
                .map(|s| text::field(s, "about", cfg.max_about, true))
                .transpose()?;
            let pin = now.pin.as_deref().map(text::pin).transpose()?;
            if now.most.is_some_and(|m| m == 0 || m > cfg.max_most) {
                return Err(format!("most is not 1 to {}", cfg.max_most));
            }
            if now.players.is_some_and(|p| p > cfg.max_most) {
                return Err(format!("players is over {}", cfg.max_most));
            }
            let r = &mut l.rec;
            if let Some(v) = name {
                r.name = v
            }
            if let Some(v) = about {
                r.about = v
            }
            if let Some(v) = pin {
                r.pin = v
            }
            if let Some(v) = now.most {
                r.most = v
            }
            if let Some(v) = now.players {
                r.players = v
            }
            if let Some(v) = now.locked {
                r.locked = v
            }
            if let Some(v) = now.listed {
                l.listed = v
            }
        }
        FromHost::Answer { n, sdp } => {
            // An answer that is not an SDP still ends that join, as a refusal.
            let reply = match text::sdp(&sdp, cfg.max_sdp) {
                Ok(()) => Reply::Answer(sdp),
                Err(_) => Reply::Refuse("the host's answer was not an SDP".into()),
            };
            if let Some(w) = l.pending.remove(&n) {
                let _ = w.send(reply);
            }
        }
        FromHost::Refuse { n, why } => {
            let why =
                text::field(&why, "why", cfg.max_about, true).unwrap_or_else(|_| "refused".into());
            if let Some(w) = l.pending.remove(&n) {
                let _ = w.send(Reply::Refuse(why));
            }
        }
    }
    Ok(())
}
