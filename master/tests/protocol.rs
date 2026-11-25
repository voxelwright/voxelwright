//! The protocol end to end over real sockets: a host's WebSocket and a page's
//! HTTP, against a master on an ephemeral loopback port. Durations are short.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use reqwest::StatusCode;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use village_master::config::Config;
use village_master::state::{Lobby, Record, Shared, State};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const SDP: &str = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
const TOKEN: &str = "a-test-token-of-some-length";

fn cfg() -> Config {
    Config {
        join_wait: 0.5,
        silence: 0.8,
        hello_wait: 0.5,
        header_read: 0.5,
        request: 1.5,
        ..Config::default()
    }
}

struct M {
    base: String,
    ws: String,
    http: reqwest::Client,
    st: Shared,
}

async fn start(cfg: Config) -> M {
    start_with(cfg, None).await
}

async fn start_with(cfg: Config, token: Option<&str>) -> M {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    let st = State::new(cfg, token.map(String::from));
    tokio::spawn(village_master::serve(l, st.clone()));
    M {
        base: format!("http://{addr}"),
        ws: format!("ws://{addr}/host"),
        http: reqwest::Client::new(),
        st,
    }
}

fn hello(name: &str) -> Value {
    json!({ "hello": { "proto": 1, "name": name, "about": "a test lobby", "pin": "town", "most": 8, "locked": false, "listed": true } })
}

impl M {
    async fn get(&self, path: &str) -> (StatusCode, Value) {
        let r = self
            .http
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    async fn join(&self, key: &str, sdp: &str) -> (StatusCode, Value) {
        let r = self
            .http
            .post(format!("{}/lobbies/{key}/join", self.base))
            .json(&json!({ "sdp": sdp }))
            .send()
            .await
            .unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    async fn open(&self) -> Ws {
        connect_async(&self.ws).await.expect("host socket").0
    }
    /// A host that said hello: (socket, id, code).
    async fn host(&self, hello: Value) -> (Ws, String, String) {
        let mut ws = self.open().await;
        say(&mut ws, hello).await;
        let w = next(&mut ws).await;
        let id = w["welcome"]["id"].as_str().expect("welcome").to_string();
        let code = w["welcome"]["code"].as_str().unwrap().to_string();
        (ws, id, code)
    }
}

async fn say(ws: &mut Ws, v: Value) {
    ws.send(Message::text(v.to_string())).await.unwrap();
}

async fn next(ws: &mut Ws) -> Value {
    loop {
        let m = tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .expect("a message in time");
        match m.expect("socket open").expect("no error") {
            Message::Text(t) => return serde_json::from_str(&t).unwrap(),
            Message::Close(c) => {
                return json!({ "closed": c.map(|c| (u16::from(c.code), c.reason.to_string())) });
            }
            _ => continue,
        }
    }
}

/// The close code a host's socket ends with.
async fn closed(ws: &mut Ws) -> (u16, String) {
    let v = next(ws).await;
    let c = &v["closed"];
    (
        c[0].as_u64().unwrap_or(0) as u16,
        c[1].as_str().unwrap_or("").to_string(),
    )
}

#[tokio::test]
async fn root_and_ice() {
    let m = start(cfg()).await;
    let (s, v) = m.get("/").await;
    assert_eq!(s, 200);
    assert_eq!(v["name"], "village-master");
    assert_eq!(v["proto"], 1);
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(m.get("/ice").await.1, json!({ "iceServers": [] }));
    let m = start(Config {
        stun: vec!["stun:192.0.2.1:3478".into()],
        ..cfg()
    })
    .await;
    assert_eq!(
        m.get("/ice").await.1,
        json!({ "iceServers": [{ "urls": ["stun:192.0.2.1:3478"] }] })
    );
    let (s, v) = m.get("/nothing-here").await;
    assert_eq!(
        (s, v["why"].as_str()),
        (StatusCode::NOT_FOUND, Some("not found"))
    );
}

#[tokio::test]
async fn hello_welcome_and_the_list() {
    let m = start(cfg()).await;
    let (_ws, id, code) = m.host(hello("Ash Hollow")).await;
    assert_eq!(id.len(), 12);
    assert_eq!(code.len(), 20);
    let (s, v) = m.get("/lobbies").await;
    assert_eq!(s, 200);
    let l = &v["lobbies"][0];
    assert_eq!(l["id"], id.as_str());
    assert_eq!(l["name"], "Ash Hollow");
    assert_eq!(l["about"], "a test lobby");
    assert_eq!(l["pin"], "town");
    assert_eq!(l["players"], 0);
    assert_eq!(l["most"], 8);
    assert_eq!(l["locked"], false);
    assert!(l["since"].as_u64().unwrap() > 1_700_000_000);
    assert!(l.get("code").is_none() && l.get("listed").is_none());
    assert_eq!(m.get(&format!("/lobbies/{id}")).await.1, *l);
    assert_eq!(m.get(&format!("/lobbies/{code}")).await.1, *l);
    assert_eq!(
        m.get(&format!("/lobbies/{}", code.to_uppercase())).await.1,
        *l
    );
    assert_eq!(m.get("/lobbies/000000000000").await.0, 404);
}

#[tokio::test]
async fn a_private_lobby_is_found_only_by_its_code() {
    let m = start(cfg()).await;
    let mut h = hello("Quiet Room");
    h["hello"]["listed"] = json!(false);
    let (mut ws, id, code) = m.host(h).await;
    assert_eq!(
        m.get("/lobbies").await.1,
        json!({ "lobbies": [], "next": null })
    );
    let (s, v) = m.get(&format!("/lobbies/{id}")).await;
    let (s0, v0) = m.get("/lobbies/zzzzzzzzzzzz").await;
    assert_eq!(
        (s, &v),
        (s0, &v0),
        "an unlisted id answers as an unknown one"
    );
    assert_eq!(s, 404);
    assert_eq!(m.get("/").await.1["lobbies"], 0);
    assert_eq!(
        m.get(&format!("/lobbies/{code}")).await.1["name"],
        "Quiet Room"
    );
    assert_eq!(m.join(&id, SDP).await, m.join("zzzzzzzzzzzz", SDP).await);
    assert_eq!(m.join(&id, SDP).await.0, 404);
    // By its code, a join goes through.
    let join = tokio::spawn({
        let (http, base, code) = (m.http.clone(), m.base.clone(), code.clone());
        async move {
            http.post(format!("{base}/lobbies/{code}/join"))
                .json(&json!({ "sdp": SDP }))
                .send()
                .await
                .unwrap()
                .status()
        }
    });
    let o = next(&mut ws).await;
    say(
        &mut ws,
        json!({ "answer": { "n": o["offer"]["n"], "sdp": SDP } }),
    )
    .await;
    assert_eq!(join.await.unwrap(), 200);
    // Listing it later through `now` shows it.
    say(&mut ws, json!({ "now": { "players": 1, "listed": true } })).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(m.get("/lobbies").await.1["lobbies"][0]["players"], 1);
}

#[tokio::test]
async fn a_join_is_one_offer_and_one_answer() {
    let m = start(cfg()).await;
    let (mut ws, id, _) = m.host(hello("Fern Gate")).await;
    let offer = format!("{SDP}a=offer-marker\r\n");
    let join = tokio::spawn({
        let (http, base, id, offer) = (m.http.clone(), m.base.clone(), id.clone(), offer.clone());
        async move {
            let r = http
                .post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": offer }))
                .send()
                .await
                .unwrap();
            (r.status(), r.json::<Value>().await.unwrap())
        }
    });
    let o = next(&mut ws).await;
    assert_eq!(o["offer"]["sdp"], offer.as_str());
    assert_eq!(o["offer"]["n"], 1);
    let answer = format!("{SDP}a=answer-marker\r\n");
    say(&mut ws, json!({ "answer": { "n": 1, "sdp": answer } })).await;
    let (s, v) = join.await.unwrap();
    assert_eq!(s, 200);
    assert_eq!(v, json!({ "sdp": answer }));
}

#[tokio::test]
async fn a_refusal_is_409_with_why() {
    let m = start(cfg()).await;
    let (mut ws, id, _) = m.host(hello("Full House")).await;
    let join = tokio::spawn({
        let (http, base, id) = (m.http.clone(), m.base.clone(), id.clone());
        async move {
            let r = http
                .post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": SDP }))
                .send()
                .await
                .unwrap();
            (r.status(), r.json::<Value>().await.unwrap())
        }
    });
    let o = next(&mut ws).await;
    say(
        &mut ws,
        json!({ "refuse": { "n": o["offer"]["n"], "why": "full\u{0007}" } }),
    )
    .await;
    assert_eq!(
        join.await.unwrap(),
        (StatusCode::CONFLICT, json!({ "why": "full" }))
    );
}

#[tokio::test]
async fn a_host_that_never_answers_is_504() {
    let m = start(cfg()).await;
    let (_ws, id, _) = m.host(hello("Still Pond")).await;
    let (s, v) = m.join(&id, SDP).await;
    assert_eq!(s, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(v["why"], "the host did not answer");
}

#[tokio::test]
async fn two_joins_at_once_each_get_their_own_answer() {
    let m = start(cfg()).await;
    let (mut ws, id, _) = m.host(hello("Twin Oaks")).await;
    let mk = |tag: &'static str| {
        let (http, base, id) = (m.http.clone(), m.base.clone(), id.clone());
        tokio::spawn(async move {
            let r = http
                .post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": format!("{SDP}a=who:{tag}\r\n") }))
                .send()
                .await
                .unwrap();
            r.json::<Value>().await.unwrap()["sdp"]
                .as_str()
                .unwrap()
                .to_string()
        })
    };
    let (a, b) = (mk("a"), mk("b"));
    let o1 = next(&mut ws).await;
    let o2 = next(&mut ws).await;
    // Answer in the other order, echoing who each offer was from.
    for o in [&o2, &o1] {
        let who = o["offer"]["sdp"]
            .as_str()
            .unwrap()
            .split("a=who:")
            .nth(1)
            .unwrap()
            .trim()
            .to_string();
        say(
            &mut ws,
            json!({ "answer": { "n": o["offer"]["n"], "sdp": format!("{SDP}a=for:{who}\r\n") } }),
        )
        .await;
    }
    assert!(a.await.unwrap().contains("a=for:a"));
    assert!(b.await.unwrap().contains("a=for:b"));
}

#[tokio::test]
async fn a_host_cannot_answer_another_lobbys_join() {
    let m = start(cfg()).await;
    let (mut a, _, _) = m.host(hello("Lobby A")).await;
    let (mut b, id_b, _) = m.host(hello("Lobby B")).await;
    let join = tokio::spawn({
        let (http, base) = (m.http.clone(), m.base.clone());
        async move {
            http.post(format!("{base}/lobbies/{id_b}/join"))
                .json(&json!({ "sdp": SDP }))
                .send()
                .await
                .unwrap()
                .status()
        }
    });
    let o = next(&mut b).await;
    // A guesses B's join number and answers it.
    say(
        &mut a,
        json!({ "answer": { "n": o["offer"]["n"], "sdp": format!("{SDP}a=from-a\r\n") } }),
    )
    .await;
    assert_eq!(join.await.unwrap(), StatusCode::GATEWAY_TIMEOUT);
}

#[tokio::test]
async fn a_silent_host_is_gone_and_now_keeps_it() {
    let m = start(cfg()).await;
    let (mut quiet, quiet_id, _) = m.host(hello("Quiet")).await;
    let (mut busy, busy_id, _) = m.host(hello("Busy")).await;
    let t0 = std::time::Instant::now();
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        say(&mut busy, json!({ "now": { "players": 2 } })).await;
    }
    assert_eq!(closed(&mut quiet).await, (4408, "silent too long".into()));
    assert!(t0.elapsed() >= Duration::from_millis(700));
    assert_eq!(m.get(&format!("/lobbies/{quiet_id}")).await.0, 404);
    let v = m.get(&format!("/lobbies/{busy_id}")).await.1;
    assert_eq!(v["players"], 2);
}

#[tokio::test]
async fn a_closed_socket_ends_the_lobby_and_its_joins() {
    let m = start(Config {
        join_wait: 3.0,
        ..cfg()
    })
    .await;
    let (mut ws, id, _) = m.host(hello("Short Stay")).await;
    let join = tokio::spawn({
        let (http, base, id) = (m.http.clone(), m.base.clone(), id.clone());
        async move {
            http.post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": SDP }))
                .send()
                .await
                .unwrap()
                .status()
        }
    });
    next(&mut ws).await;
    ws.close(None).await.unwrap();
    assert_eq!(join.await.unwrap(), StatusCode::NOT_FOUND);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(m.get(&format!("/lobbies/{id}")).await.0, 404);
}

#[tokio::test]
async fn hello_rules() {
    let m = start(cfg()).await;
    // A second hello on one socket.
    let (mut ws, _, _) = m.host(hello("Once")).await;
    say(&mut ws, hello("Twice")).await;
    assert_eq!(closed(&mut ws).await, (4400, "hello once".into()));
    // Anything before the hello.
    let mut ws = m.open().await;
    say(&mut ws, json!({ "now": { "players": 1 } })).await;
    assert_eq!(closed(&mut ws).await.0, 4400);
    // Not JSON.
    let mut ws = m.open().await;
    ws.send(Message::text("{not json")).await.unwrap();
    assert_eq!(closed(&mut ws).await.0, 4400);
    // No hello in time.
    let mut ws = m.open().await;
    assert_eq!(closed(&mut ws).await, (4408, "no hello in time".into()));
    // Another proto.
    let mut ws = m.open().await;
    let mut h = hello("Future");
    h["hello"]["proto"] = json!(2);
    say(&mut ws, h).await;
    assert_eq!(closed(&mut ws).await.0, 4400);
    // A bad pin, and most of 0.
    for (k, v) in [("pin", json!("<script>")), ("most", json!(0))] {
        let mut ws = m.open().await;
        let mut h = hello("Bad");
        h["hello"][k] = v;
        say(&mut ws, h).await;
        assert_eq!(closed(&mut ws).await.0, 4400, "{k}");
    }
}

#[tokio::test]
async fn names_and_abouts_are_cleaned_then_counted() {
    let m = start(cfg()).await;
    let n48 = "n".repeat(48);
    let mut h = hello(&format!("\u{1b}\u{202E}{n48}\u{0}"));
    h["hello"]["about"] = json!("a".repeat(200));
    let (_ws, id, _) = m.host(h).await;
    let v = m.get(&format!("/lobbies/{id}")).await.1;
    assert_eq!(v["name"], n48.as_str());
    assert_eq!(v["about"].as_str().unwrap().len(), 200);
    for (k, v) in [
        ("name", "n".repeat(49)),
        ("about", "a".repeat(201)),
        ("name", "\u{7}".into()),
    ] {
        let mut ws = m.open().await;
        let mut h = hello("x");
        h["hello"][k] = json!(v);
        say(&mut ws, h).await;
        assert_eq!(closed(&mut ws).await.0, 4400, "{k} {}", v.len());
    }
    // `now` is held to the same rules, and a bad one changes nothing.
    let (mut ws, id, _) = m.host(hello("Keeps")).await;
    say(
        &mut ws,
        json!({ "now": { "players": 3, "name": "n".repeat(49) } }),
    )
    .await;
    assert_eq!(closed(&mut ws).await.0, 4400);
    let _ = id;
}

#[tokio::test]
async fn sdp_and_body_limits() {
    let m = start(cfg()).await;
    let (mut ws, id, _) = m.host(hello("Sizes")).await;
    let pad = |n: usize| format!("{SDP}a={}", "x".repeat(n - SDP.len() - 2));
    let exact = pad(16 * 1024);
    assert_eq!(exact.len(), 16 * 1024);
    let join = tokio::spawn({
        let (http, base, id, exact) = (m.http.clone(), m.base.clone(), id.clone(), exact.clone());
        async move {
            http.post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": exact }))
                .send()
                .await
                .unwrap()
                .status()
        }
    });
    let o = next(&mut ws).await;
    assert_eq!(o["offer"]["sdp"].as_str().unwrap().len(), 16 * 1024);
    say(
        &mut ws,
        json!({ "answer": { "n": o["offer"]["n"], "sdp": exact } }),
    )
    .await;
    assert_eq!(join.await.unwrap(), 200);
    let (s, v) = m.join(&id, &pad(16 * 1024 + 1)).await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(v["why"], "the SDP is over 16384 bytes");
    // A body far past any SDP.
    let big = format!("{{\"sdp\":\"{}\"}}", "x".repeat(40 * 1024));
    let r = m
        .http
        .post(format!("{}/lobbies/{id}/join", m.base))
        .body(big)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::PAYLOAD_TOO_LARGE);
    // Bad JSON, the wrong shape, and something that is not an SDP.
    for body in [
        "{not json",
        "{\"offer\":1}",
        "{\"sdp\":\"hello\"}",
        "{\"sdp\":\"v=0\\u0000\"}",
    ] {
        let r = m
            .http
            .post(format!("{}/lobbies/{id}/join", m.base))
            .body(body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST, "{body}");
        assert!(r.json::<Value>().await.unwrap()["why"].is_string());
    }
    // A host's answer that is not an SDP ends the join as a refusal.
    let join = tokio::spawn({
        let (http, base, id) = (m.http.clone(), m.base.clone(), id.clone());
        async move {
            http.post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": SDP }))
                .send()
                .await
                .unwrap()
                .status()
        }
    });
    let o = next(&mut ws).await;
    say(
        &mut ws,
        json!({ "answer": { "n": o["offer"]["n"], "sdp": "<html>" } }),
    )
    .await;
    assert_eq!(join.await.unwrap(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_host_message_over_the_frame_cap_closes_it() {
    let m = start(cfg()).await;
    let (mut ws, _, _) = m.host(hello("Big Talker")).await;
    let _ = ws
        .send(Message::text(format!(
            "{{\"now\":{{\"about\":\"{}\"}}}}",
            "a".repeat(64 * 1024)
        )))
        .await;
    // Message too big: tungstenite on the master's side errors and the socket ends.
    let end = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap();
    assert!(!matches!(end, Some(Ok(Message::Text(_)))));
}

#[tokio::test]
async fn limit_registrations_a_minute() {
    let m = start(Config {
        registrations_per_minute: 2,
        ..cfg()
    })
    .await;
    let _a = m.host(hello("One")).await;
    let _b = m.host(hello("Two")).await;
    match connect_async(&m.ws).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(r)) => assert_eq!(r.status(), 429),
        other => panic!("expected 429, got {:?}", other.map(|_| ())),
    }
}

#[tokio::test]
async fn limit_lobbies_per_address_and_in_all() {
    let m = start(Config {
        max_lobbies_per_addr: 2,
        ..cfg()
    })
    .await;
    let _a = m.host(hello("One")).await;
    let b = m.host(hello("Two")).await;
    let status = |r: Result<_, tokio_tungstenite::tungstenite::Error>| match r {
        Err(tokio_tungstenite::tungstenite::Error::Http(r)) => r.status().as_u16(),
        Ok(_) => 101,
        Err(e) => panic!("{e}"),
    };
    assert_eq!(status(connect_async(&m.ws).await.map(|_| ())), 429);
    // Closing one frees its place.
    drop(b);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(status(connect_async(&m.ws).await.map(|_| ())), 101);

    let m = start(Config {
        max_lobbies: 1,
        ..cfg()
    })
    .await;
    let _a = m.open().await; // a socket waiting for its hello holds a place too
    assert_eq!(status(connect_async(&m.ws).await.map(|_| ())), 503);
}

#[tokio::test]
async fn limit_joins_and_lookups_a_minute() {
    let m = start(Config {
        joins_per_minute: 2,
        lookups_per_minute: 3,
        ..cfg()
    })
    .await;
    for _ in 0..2 {
        assert_eq!(m.join("zzzzzzzzzzzz", SDP).await.0, 404);
    }
    let (s, v) = m.join("zzzzzzzzzzzz", SDP).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(v["why"], "over the limit of joins a minute");
    let r = m
        .http
        .get(format!("{}/lobbies", m.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    m.get("/lobbies/zzzzzzzzzzzz").await;
    m.get("/lobbies/zzzzzzzzzzzzzzzzzzzz").await;
    let r = m
        .http
        .get(format!("{}/lobbies", m.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 429);
    assert_eq!(r.headers()["retry-after"], "60");
}

#[tokio::test]
async fn limit_joins_waiting_on_one_host() {
    let m = start(Config {
        max_pending_joins: 1,
        silence: 5.0,
        ..cfg()
    })
    .await;
    let (_ws, id, _) = m.host(hello("Narrow Door")).await;
    let first = tokio::spawn({
        let (http, base, id) = (m.http.clone(), m.base.clone(), id.clone());
        async move {
            http.post(format!("{base}/lobbies/{id}/join"))
                .json(&json!({ "sdp": SDP }))
                .send()
                .await
                .unwrap()
                .status()
        }
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(m.join(&id, SDP).await.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(first.await.unwrap(), StatusCode::GATEWAY_TIMEOUT);
    // Its place is free again once the first is over.
    let again = m.join(&id, SDP).await.0;
    assert_eq!(again, StatusCode::GATEWAY_TIMEOUT);
}

async fn dropped(s: &mut TcpStream) -> bool {
    let mut buf = [0u8; 256];
    matches!(
        tokio::time::timeout(Duration::from_secs(2), s.read(&mut buf)).await,
        Ok(Ok(0)) | Ok(Err(_))
    )
}

#[tokio::test]
async fn limit_connections_and_slow_clients() {
    let m = start(Config {
        max_connections_per_addr: 2,
        ..cfg()
    })
    .await;
    let addr = m.base.trim_start_matches("http://").to_string();
    let mut a = TcpStream::connect(&addr).await.unwrap();
    let _b = TcpStream::connect(&addr).await.unwrap();
    let mut c = TcpStream::connect(&addr).await.unwrap();
    assert!(
        dropped(&mut c).await,
        "a third connection from one address is dropped"
    );
    // A connection that never sends its headers is closed after header_read.
    assert!(dropped(&mut a).await);
    // A body sent too slowly ends with 408.
    let mut s = TcpStream::connect(&addr).await.unwrap();
    s.write_all(b"POST /lobbies/zzzzzzzzzzzz/join HTTP/1.1\r\nhost: x\r\ncontent-length: 100\r\n\r\n{\"sdp\":").await.unwrap();
    let mut buf = vec![0u8; 512];
    let n = tokio::time::timeout(Duration::from_secs(3), s.read(&mut buf))
        .await
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.1 408"));
}

#[tokio::test]
async fn held_host_sockets_leave_the_connection_count() {
    // A WebSocket upgrade ends hyper's connection; host sockets are counted as lobbies.
    let m = start(Config {
        max_connections_per_addr: 2,
        ..cfg()
    })
    .await;
    let _hosts = [
        m.host(hello("A")).await,
        m.host(hello("B")).await,
        m.host(hello("C")).await,
    ];
    assert_eq!(
        m.get("/lobbies").await.1["lobbies"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[tokio::test]
async fn a_flooding_host_is_closed_and_long_reasons_are_cut() {
    let m = start(Config {
        host_messages_per_second: 5,
        ..cfg()
    })
    .await;
    let (mut ws, _, _) = m.host(hello("Chatty")).await;
    for _ in 0..6 {
        say(&mut ws, json!({ "now": { "players": 1 } })).await;
    }
    assert_eq!(closed(&mut ws).await, (4400, "too many messages".into()));
    let mut ws = m.open().await;
    say(&mut ws, json!({ format!("x{}", "é".repeat(200)): {} })).await;
    let (code, why) = closed(&mut ws).await;
    assert_eq!(code, 4400);
    assert!(why.len() <= 123 && why.starts_with("not a message of proto 1"));
}

#[tokio::test]
async fn proxy_headers_count_only_with_the_flag() {
    // Without --behind-proxy a forged header changes nothing.
    let m = start(Config {
        lookups_per_minute: 2,
        ..cfg()
    })
    .await;
    for (i, want) in [(1, 200), (2, 200), (3, 429)] {
        let r = m
            .http
            .get(format!("{}/lobbies", m.base))
            .header("x-forwarded-for", format!("198.51.100.{i}"))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), want);
    }
    // With it, the rightmost value of the last header is the caller.
    let m = start(Config {
        lookups_per_minute: 1,
        behind_proxy: Some("x-forwarded-for".into()),
        ..cfg()
    })
    .await;
    let get = |xff: Vec<&'static str>| {
        let mut r = m.http.get(format!("{}/lobbies", m.base));
        for v in xff {
            r = r.header("x-forwarded-for", v);
        }
        async move { r.send().await.unwrap().status().as_u16() }
    };
    assert_eq!(get(vec![]).await, 400, "no header, no caller");
    assert_eq!(get(vec!["not an address"]).await, 400);
    assert_eq!(get(vec!["203.0.113.9, 198.51.100.1"]).await, 200);
    assert_eq!(
        get(vec!["198.51.100.1"]).await,
        429,
        "the rightmost value was counted"
    );
    assert_eq!(
        get(vec!["198.51.100.1", "198.51.100.2"]).await,
        200,
        "the last header was counted"
    );
    assert_eq!(get(vec!["2001:db8:5:6::1"]).await, 200);
    assert_eq!(
        get(vec!["2001:db8:5:6::ffff"]).await,
        429,
        "one IPv6 /64 is one caller"
    );
}

#[tokio::test]
async fn the_operator_takes_off_and_refuses() {
    // Without a token the routes are not there.
    let m = start(cfg()).await;
    let (_ws, id, _) = m.host(hello("Anyone")).await;
    let r = m
        .http
        .delete(format!("{}/lobbies/{id}", m.base))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 404);

    let m = start_with(cfg(), Some(TOKEN)).await;
    let mut h = hello("Rude Words");
    h["hello"]["listed"] = json!(false);
    let (mut ws, id, _) = m.host(h).await;
    let r = m
        .http
        .delete(format!("{}/lobbies/{id}", m.base))
        .bearer_auth("wrong")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    let r = m
        .http
        .delete(format!("{}/lobbies/{id}", m.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    let r = m
        .http
        .delete(format!("{}/lobbies/{id}", m.base))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204, "an unlisted lobby can be taken off by id");
    assert_eq!(
        closed(&mut ws).await,
        (4403, "taken off by the operator".into())
    );

    // Refusing the address behind a lobby closes it and keeps that address out.
    let (mut ws, id, _) = m.host(hello("Again")).await;
    let r = m
        .http
        .post(format!("{}/bans", m.base))
        .bearer_auth(TOKEN)
        .json(&json!({ "lobby": id, "minutes": 10 }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.json::<Value>().await.unwrap()["lobbies_taken_off"], 1);
    assert_eq!(closed(&mut ws).await.0, 4403);
    match connect_async(&m.ws).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(r)) => assert_eq!(r.status(), 403),
        other => panic!("expected 403, got {:?}", other.map(|_| ())),
    }
    assert_eq!(m.get("/lobbies").await.0, 403);
    // Lifting it.
    let r = m
        .http
        .post(format!("{}/bans", m.base))
        .bearer_auth(TOKEN)
        .json(&json!({ "addr": "127.0.0.1", "minutes": 0 }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(m.get("/lobbies").await.0, 200);
}

#[tokio::test]
async fn cors_is_open_without_credentials() {
    let m = start(cfg()).await;
    let r = m
        .http
        .request(
            reqwest::Method::OPTIONS,
            format!("{}/lobbies/zzzzzzzzzzzz/join", m.base),
        )
        .header("origin", "https://example.test")
        .header("access-control-request-method", "POST")
        .header("access-control-request-headers", "content-type")
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success());
    assert_eq!(r.headers()["access-control-allow-origin"], "*");
    assert!(
        r.headers()
            .get("access-control-allow-credentials")
            .is_none()
    );
    let r = m
        .http
        .get(format!("{}/lobbies", m.base))
        .header("origin", "https://example.test")
        .send()
        .await
        .unwrap();
    assert_eq!(r.headers()["access-control-allow-origin"], "*");
    assert_eq!(r.headers()["content-type"], "application/json");
}

/// Lobbies put straight into the master's state, for tests about many of them.
fn fake_lobbies(st: &Shared, n: usize, name_len: usize, pin: &str) -> Vec<String> {
    let mut g = st.lock();
    let mut ids = vec![];
    for i in 0..n {
        let (id, code) = g.fresh();
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        let rec = Record {
            id: id.clone(),
            name: format!("{i:04}{}", "n".repeat(name_len.saturating_sub(4))),
            about: String::new(),
            pin: pin.into(),
            players: 0,
            most: 8,
            locked: false,
            since: 0,
        };
        g.codes.insert(code.clone(), id.clone());
        let lobby = Lobby {
            rec,
            code,
            listed: true,
            addr: "192.0.2.1".parse().unwrap(),
            tx,
            pending: Default::default(),
            next_n: 1,
        };
        g.lobbies.insert(id.clone(), lobby);
        ids.push(id);
    }
    ids
}

#[tokio::test]
async fn the_list_pages_and_filters() {
    let m = start(Config {
        page_size: 3,
        ..cfg()
    })
    .await;
    let mut all = fake_lobbies(&m.st, 7, 10, "town");
    all.extend(fake_lobbies(&m.st, 2, 10, "sha256-abc"));
    all.sort();
    let mut seen = vec![];
    let mut after = String::new();
    loop {
        let (s, v) = m.get(&format!("/lobbies?{after}")).await;
        assert_eq!(s, 200);
        let page: Vec<String> = v["lobbies"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["id"].as_str().unwrap().to_string())
            .collect();
        assert!(page.len() <= 3);
        seen.extend(page);
        match v["next"].as_str() {
            Some(n) => after = format!("after={n}"),
            None => break,
        }
    }
    assert_eq!(seen, all, "every listed lobby once, in id order");
    let v = m.get("/lobbies?pin=sha256-abc").await.1;
    assert_eq!(v["lobbies"].as_array().unwrap().len(), 2);
    assert!(v["next"].is_null());
    assert_eq!(
        m.get("/lobbies?limit=1").await.1["lobbies"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for bad in ["limit=0", "limit=4", "limit=x", "after=nope", "pin=%3Cb%3E"] {
        let (s, v) = m.get(&format!("/lobbies?{bad}")).await;
        assert_eq!(s, 400, "{bad}");
        assert!(v["why"].is_string());
    }
}

#[tokio::test]
async fn every_refusal_is_why_json() {
    let m = start(Config {
        join_wait: 3.0,
        request: 0.3,
        ..cfg()
    })
    .await;
    let (_ws, id, _) = m.host(hello("Slow Answers")).await;
    // 408 from the request timeout.
    let (s, v) = m.join(&id, SDP).await;
    assert_eq!(s, StatusCode::REQUEST_TIMEOUT);
    assert_eq!(v["why"], "request timeout");
    // 405 from the router, with its Allow header kept.
    let r = m
        .http
        .put(format!("{}/lobbies", m.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 405);
    assert!(r.headers().get("allow").is_some());
    assert!(r.json::<Value>().await.unwrap()["why"].is_string());
    // A GET /host that is not a WebSocket.
    let (s, v) = m.get("/host").await;
    assert_eq!(s, 400);
    assert!(v["why"].as_str().unwrap().contains("upgrade"), "{v}");
    // A page on another origin can read Retry-After.
    let m = start(Config {
        lookups_per_minute: 0,
        ..cfg()
    })
    .await;
    let r = m
        .http
        .get(format!("{}/lobbies", m.base))
        .header("origin", "https://example.test")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 429);
    assert_eq!(r.headers()["access-control-expose-headers"], "retry-after");
}

#[tokio::test]
async fn a_body_that_breaks_off_is_400_not_413() {
    let m = start(cfg()).await;
    let addr = m.base.trim_start_matches("http://").to_string();
    let mut s = TcpStream::connect(&addr).await.unwrap();
    s.write_all(b"POST /lobbies/zzzzzzzzzzzz/join HTTP/1.1\r\nhost: x\r\ntransfer-encoding: chunked\r\n\r\nzz\r\n").await.unwrap();
    let mut buf = vec![0u8; 512];
    let n = tokio::time::timeout(Duration::from_secs(2), s.read(&mut buf))
        .await
        .unwrap()
        .unwrap();
    let head = String::from_utf8_lossy(&buf[..n]).to_string();
    assert!(head.starts_with("HTTP/1.1 400"), "{head}");
}

#[tokio::test]
async fn a_client_that_stops_reading_loses_its_connection() {
    // header_read is long here, so only the write deadline can end the connection.
    let m = start(Config {
        page_size: 5000,
        write_stall: 0.5,
        request: 10.0,
        header_read: 10.0,
        ..cfg()
    })
    .await;
    fake_lobbies(&m.st, 5000, 48, "town");
    for l in m.st.lock().lobbies.values_mut() {
        l.rec.about = "a".repeat(200); // a page of about 1.6 MB, more than the sockets hold
    }
    let addr: std::net::SocketAddr = m.base.trim_start_matches("http://").parse().unwrap();
    let sock = tokio::net::TcpSocket::new_v4().unwrap();
    sock.set_recv_buffer_size(1024).unwrap();
    let mut s = sock.connect(addr).await.unwrap();
    s.write_all(b"GET /lobbies?limit=5000 HTTP/1.1\r\nhost: x\r\n\r\n")
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(m.st.lock().conns, 1, "the answer is still being written");
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(m.st.lock().conns, 0, "dropped once its writes stalled");
}

#[tokio::test]
async fn one_ipv6_48_is_capped_as_a_whole() {
    let m = start(Config {
        behind_proxy: Some("x-forwarded-for".into()),
        max_lobbies_per_addr: 1,
        max_lobbies_per_48: 3,
        ..cfg()
    })
    .await;
    let open = |xff: String| {
        let url = m.ws.clone();
        async move {
            use tokio_tungstenite::tungstenite::client::IntoClientRequest;
            let mut req = url.into_client_request().unwrap();
            req.headers_mut()
                .insert("x-forwarded-for", xff.parse().unwrap());
            match connect_async(req).await {
                Ok((ws, _)) => Ok(ws),
                Err(tokio_tungstenite::tungstenite::Error::Http(r)) => Err(r.status().as_u16()),
                Err(e) => panic!("{e}"),
            }
        }
    };
    // Three /56s of one /48 hold a lobby each; a fourth is refused; another /48 is not.
    let mut held = vec![];
    for i in 1..=3 {
        held.push(open(format!("2001:db8:7:{i}00::1")).await.expect("a lobby"));
    }
    assert_eq!(open("2001:db8:7:400::1".into()).await.err(), Some(429));
    assert!(open("2001:db8:8:100::1".into()).await.is_ok());
    // Two addresses in one /56 are one caller.
    assert_eq!(open("2001:db8:7:1ff::2".into()).await.err(), Some(429));
    drop(held);
}

#[tokio::test]
async fn stun_cannot_fill_the_table_http_needs() {
    let st = State::new(
        Config {
            max_tracked_addrs: 2,
            ..cfg()
        },
        None,
    );
    for i in 0..100u8 {
        st.stun(std::net::IpAddr::from([198, 51, 100, i]));
    }
    assert!(st.connection("127.0.0.1".parse().unwrap()).is_some());
    assert!(
        st.charge(
            "127.0.0.1".parse().unwrap(),
            village_master::state::Kind::Lookup
        )
        .is_ok()
    );
}
