//! Village's master server: a list of player-hosted lobbies and a relay for one
//! WebRTC offer and one answer per join. See README.md for the protocol.

pub mod api;
pub mod config;
pub mod host;
pub mod stall;
pub mod state;
pub mod stun;
pub mod text;

use std::convert::Infallible;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use axum::routing::{get, post};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::net::TcpListener;
use tower::ServiceExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::timeout::TimeoutLayer;

use crate::config::secs;
use crate::state::Shared;

pub fn router(st: Shared) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .expose_headers([header::RETRY_AFTER])
        .max_age(Duration::from_secs(86_400));
    Router::new()
        .route("/", get(api::root))
        .route("/host", get(host::upgrade))
        .route("/ice", get(api::ice))
        .route("/lobbies", get(api::lobbies))
        .route("/lobbies/{key}", get(api::lobby).delete(api::take_off))
        .route("/lobbies/{key}/join", post(api::join))
        .route("/bans", post(api::ban))
        .fallback(|| async { api::ApiError(StatusCode::NOT_FOUND, "not found".into()) })
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            secs(st.cfg.request),
        ))
        .layer(axum::middleware::map_response(api::why_json))
        .layer(cors)
        .with_state(st)
}

/// Accept connections until the listener fails. Each one gets a header-read
/// deadline (axum::serve sets none) and counts against the connection limits.
pub async fn serve(listener: TcpListener, st: Shared) {
    let app = router(st.clone());
    let sweeper = st.clone();
    tokio::spawn(async move {
        let mut every = tokio::time::interval(Duration::from_secs(30));
        loop {
            every.tick().await;
            sweeper.sweep();
        }
    });
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(x) => x,
            Err(_) => {
                // Out of descriptors and the like: wait rather than spin.
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        let Some(guard) = st.connection(peer.ip()) else {
            continue;
        };
        let _ = stream.set_nodelay(true);
        let app = app.clone();
        let header_read = secs(st.cfg.header_read);
        let write_stall = secs(st.cfg.write_stall);
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |mut req: Request<Incoming>| {
                req.extensions_mut().insert(ConnectInfo(peer));
                let app = app.clone();
                async move {
                    Ok::<_, Infallible>(
                        app.oneshot(req.map(Body::new))
                            .await
                            .unwrap_or_else(|e| match e {}),
                    )
                }
            });
            let conn = http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(header_read)
                .max_buf_size(64 * 1024)
                .serve_connection(TokioIo::new(stall::Stall::new(stream, write_stall)), svc)
                .with_upgrades();
            let _ = conn.await;
            drop(guard);
        });
    }
}
