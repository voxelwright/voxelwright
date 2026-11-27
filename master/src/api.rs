//! The page's requests, and the operator's. JSON in, JSON out; every refusal is
//! `{"why": "..."}` with its status.

use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use axum::Json;
use axum::body::{Body, Bytes, to_bytes};
use std::ops::Bound;

use axum::extract::{ConnectInfo, Path, RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use http_body_util::LengthLimitError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::config::secs;
use crate::state::{Kind, Record, Refused, Reply, Shared, ToHost, unix_now};
use crate::text::{self, SdpError};

pub struct ApiError(pub StatusCode, pub String);

impl ApiError {
    fn new(code: StatusCode, why: impl Into<String>) -> Self {
        ApiError(code, why.into())
    }
    fn gone() -> Self {
        ApiError::new(StatusCode::NOT_FOUND, "no such lobby")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut r = (self.0, Json(json!({ "why": self.1 }))).into_response();
        if self.0 == StatusCode::TOO_MANY_REQUESTS {
            r.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        }
        r
    }
}

impl From<Refused> for ApiError {
    fn from(r: Refused) -> Self {
        match r {
            Refused::Banned => {
                ApiError::new(StatusCode::FORBIDDEN, "this address is refused for now")
            }
            Refused::Limit(what) => ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                format!("over the limit of {what}"),
            ),
            Refused::Busy => ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "the master is full"),
        }
    }
}

/// The caller's address for limits and bans. With --behind-proxy the named
/// header must be there (rightmost value of its last instance); without it the
/// header is ignored, whatever a caller writes.
pub fn caller(st: &Shared, headers: &HeaderMap, peer: SocketAddr) -> Result<IpAddr, ApiError> {
    let Some(name) = st
        .cfg
        .behind_proxy
        .as_ref()
        .filter(|_| st.cfg.trusts_proxy(peer.ip()))
    else {
        return Ok(text::addr_key(peer.ip()));
    };
    let ip = headers
        .get_all(name.as_str())
        .iter()
        .next_back()
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit(',').next())
        .and_then(|v| v.trim().parse::<IpAddr>().ok());
    ip.map(text::addr_key).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("no caller address in {name}"),
        )
    })
}

fn too_big(e: &(dyn std::error::Error + 'static)) -> bool {
    let mut at = Some(e);
    while let Some(e) = at {
        if e.is::<LengthLimitError>() {
            return true;
        }
        at = e.source();
    }
    false
}

async fn body<T: for<'de> Deserialize<'de>>(b: Body, limit: usize) -> Result<T, ApiError> {
    let bytes: Bytes = to_bytes(b, limit).await.map_err(|e| {
        if too_big(&e) {
            ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "the body is too big")
        } else {
            ApiError::new(StatusCode::BAD_REQUEST, "the body did not arrive whole")
        }
    })?;
    serde_json::from_slice(&bytes).map_err(|e| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("not the JSON this wants: {e}"),
        )
    })
}

pub async fn root(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    st.charge(caller(&st, &headers, peer)?, Kind::Lookup)?;
    let listed = st.lock().listed;
    Ok(Json(json!({
        "name": "village-master",
        "version": env!("CARGO_PKG_VERSION"),
        "proto": 1,
        "about": "Lists Village lobbies and passes one WebRTC offer and one answer for each join. It carries no game traffic and keeps nothing on disk.",
        "lobbies": listed,
    })))
}

pub async fn ice(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    st.charge(caller(&st, &headers, peer)?, Kind::Lookup)?;
    let servers: Vec<Value> = if st.cfg.stun.is_empty() {
        vec![]
    } else {
        vec![json!({ "urls": st.cfg.stun })]
    };
    Ok(Json(json!({ "iceServers": servers })))
}

/// One page of the listed lobbies, in id order: `?after=<id>` continues from a
/// page's `next`, `?limit=<n>` (at most --page-size), `?pin=<pin>` only that world.
pub async fn lobbies(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Result<Response, ApiError> {
    let addr = caller(&st, &headers, peer)?;
    st.charge(addr, Kind::Lookup)?;
    let (mut after, mut pin, mut limit) = (None, None, st.cfg.page_size);
    for (k, v) in query
        .as_deref()
        .unwrap_or("")
        .split('&')
        .filter_map(|kv| kv.split_once('='))
    {
        match k {
            "after" => {
                after =
                    Some(text::key(v).ok_or_else(|| {
                        ApiError::new(StatusCode::BAD_REQUEST, "after is not an id")
                    })?)
            }
            "pin" => {
                pin = Some(text::pin(v).map_err(|why| ApiError::new(StatusCode::BAD_REQUEST, why))?)
            }
            "limit" => {
                limit = v
                    .parse::<usize>()
                    .ok()
                    .filter(|n| (1..=st.cfg.page_size).contains(n))
                    .ok_or_else(|| {
                        ApiError::new(
                            StatusCode::BAD_REQUEST,
                            format!("limit is not 1 to {}", st.cfg.page_size),
                        )
                    })?
            }
            _ => {}
        }
    }
    #[derive(Serialize)]
    struct Page<'a> {
        lobbies: Vec<&'a Record>,
        next: Option<&'a str>,
    }
    let g = st.lock();
    let from = match &after {
        Some(a) => Bound::Excluded(a.as_str()),
        None => Bound::Unbounded,
    };
    let mut it = g
        .lobbies
        .range::<str, _>((from, Bound::Unbounded))
        .map(|(_, l)| l)
        .filter(|l| l.listed && pin.as_ref().is_none_or(|p| &l.rec.pin == p));
    let lobbies: Vec<&Record> = it.by_ref().take(limit).map(|l| &l.rec).collect();
    let more = lobbies.len() == limit && it.next().is_some();
    let next = if more {
        lobbies.last().map(|r| r.id.as_str())
    } else {
        None
    };
    let bytes = serde_json::to_vec(&Page { lobbies, next }).expect("a page serializes");
    drop(g);
    Ok(([(header::CONTENT_TYPE, "application/json")], bytes).into_response())
}

pub async fn lobby(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let addr = caller(&st, &headers, peer)?;
    st.charge(addr, Kind::Lookup)?;
    let key = text::key(&key).ok_or_else(ApiError::gone)?;
    let g = st.lock();
    let id = g.find(&key).ok_or_else(ApiError::gone)?;
    Ok(Json(json!(g.lobbies[id].rec)))
}

#[derive(Deserialize)]
struct Join {
    sdp: String,
}

/// Removes a join's slot on the host however the request ends (answered, timed
/// out, or the page went away).
struct Waiting<'a> {
    st: &'a Shared,
    id: String,
    n: u64,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        if let Some(l) = self.st.lock().lobbies.get_mut(&self.id) {
            l.pending.remove(&self.n);
        }
    }
}

pub async fn join(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(key): Path<String>,
    b: Body,
) -> Result<Json<Value>, ApiError> {
    let addr = caller(&st, &headers, peer)?;
    st.charge(addr, Kind::Join)?;
    let j: Join = body(b, 2 * st.cfg.max_sdp + 1024).await?;
    match text::sdp(&j.sdp, st.cfg.max_sdp) {
        Ok(()) => {}
        Err(SdpError::TooBig) => {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("the SDP is over {} bytes", st.cfg.max_sdp),
            ));
        }
        Err(SdpError::Bad) => {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "that is not an SDP"));
        }
    }
    let key = text::key(&key).ok_or_else(ApiError::gone)?;
    let (rx, waiting) = {
        let mut g = st.lock();
        let id = g.find(&key).ok_or_else(ApiError::gone)?.to_string();
        let l = g.lobbies.get_mut(&id).ok_or_else(ApiError::gone)?;
        if l.pending.len() >= st.cfg.max_pending_joins {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "the host is busy; try again",
            ));
        }
        let n = l.next_n;
        l.next_n += 1;
        if l.tx.try_send(ToHost::Offer { n, sdp: j.sdp }).is_err() {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "the host is busy; try again",
            ));
        }
        let (tx, rx) = oneshot::channel();
        l.pending.insert(n, tx);
        (rx, Waiting { st: &st, id, n })
    };
    let reply = timeout(secs(st.cfg.join_wait), rx).await;
    drop(waiting);
    match reply {
        Ok(Ok(Reply::Answer(sdp))) => Ok(Json(json!({ "sdp": sdp }))),
        Ok(Ok(Reply::Refuse(why))) => Err(ApiError(StatusCode::CONFLICT, why)),
        Ok(Err(_)) => Err(ApiError::gone()),
        Err(_) => Err(ApiError::new(
            StatusCode::GATEWAY_TIMEOUT,
            "the host did not answer",
        )),
    }
}

// ---- the operator's ----

fn operator(st: &Shared, headers: &HeaderMap, peer: SocketAddr) -> Result<(), ApiError> {
    let Some(token) = &st.admin_token else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not found"));
    };
    let addr = caller(st, headers, peer)?;
    if st.operator_locked(addr) {
        return Err(Refused::Banned.into());
    }
    let given = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    use subtle::ConstantTimeEq;
    if bool::from(text::digest(given.as_bytes()).ct_eq(token)) {
        // The operator is never held to limits or bans (one may ban their own address).
        return Ok(());
    }
    st.charge(addr, Kind::AdminFail)?;
    Err(ApiError::new(
        StatusCode::UNAUTHORIZED,
        "not the operator's token",
    ))
}

pub async fn take_off(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<StatusCode, ApiError> {
    operator(&st, &headers, peer)?;
    let key = text::key(&key).ok_or_else(ApiError::gone)?;
    let mut g = st.lock();
    let id = g.find_any(&key).ok_or_else(ApiError::gone)?;
    g.remove(&id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Ban {
    /// A lobby's id or code: refuse the address behind it, without anyone seeing it.
    lobby: Option<String>,
    addr: Option<IpAddr>,
    /// How long; 0 lifts a ban on `addr`.
    minutes: u64,
}

pub async fn ban(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    b: Body,
) -> Result<Json<Value>, ApiError> {
    operator(&st, &headers, peer)?;
    let ban: Ban = body(b, 4096).await?;
    let mut g = st.lock();
    let target = match (&ban.lobby, ban.addr) {
        (Some(k), None) => {
            let key = text::key(k).ok_or_else(ApiError::gone)?;
            let id = g.find_any(&key).ok_or_else(ApiError::gone)?;
            g.lobbies[&id].addr
        }
        (None, Some(a)) => text::addr_key(a),
        _ => return Err(ApiError::new(StatusCode::BAD_REQUEST, "give lobby or addr")),
    };
    if ban.minutes == 0 {
        g.bans.remove(&target);
        return Ok(Json(json!({ "until": null })));
    }
    if !g.bans.contains_key(&target) && g.bans.len() >= st.cfg.max_bans {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "too many bans held",
        ));
    }
    let minutes = ban.minutes.min(60 * 24 * 365);
    g.bans
        .insert(target, Instant::now() + Duration::from_secs(minutes * 60));
    let gone: Vec<String> = g
        .lobbies
        .values()
        .filter(|l| l.addr == target)
        .map(|l| l.rec.id.clone())
        .collect();
    for id in &gone {
        g.remove(id);
    }
    Ok(Json(
        json!({ "until": unix_now() + minutes * 60, "lobbies_taken_off": gone.len() }),
    ))
}

/// Responses the framework makes itself (405, 408, a failed upgrade) come as
/// empty or plain text; give every refusal the same `{"why"}` shape.
pub async fn why_json(res: Response) -> Response {
    let status = res.status();
    let json = res
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|v| v.as_bytes().starts_with(b"application/json"));
    if status.as_u16() < 400 || json {
        return res;
    }
    let (parts, b) = res.into_parts();
    let said = to_bytes(b, 1024)
        .await
        .ok()
        .map(|b| text::clean(&String::from_utf8_lossy(&b)))
        .filter(|s| !s.is_empty());
    let why = said.unwrap_or_else(|| {
        status
            .canonical_reason()
            .unwrap_or("refused")
            .to_lowercase()
    });
    let mut r = ApiError(status, why).into_response();
    for (k, v) in &parts.headers {
        if k != header::CONTENT_TYPE && k != header::CONTENT_LENGTH {
            r.headers_mut().append(k, v.clone());
        }
    }
    r
}
