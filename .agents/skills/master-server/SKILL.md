---
name: master-server
description: The crates, versions and verified recipes behind master/ (village-master, Rust), the server that lists player-hosted lobbies and passes one WebRTC offer and one answer per join (issue #526). Load before changing the master, building a host or page against its protocol, or adding a crate to it.
---

# Master server

Pinned in `master/Cargo.lock`, built with Rust 1.96.1 (edition 2024), checked November 25,
2026. The protocol and its numbers are in `master/README.md`; why WebRTC is in
`.agents/skills/lobby-transport/SKILL.md`.

## Crates and why each is there

| Crate | Version | Why |
| --- | --- | --- |
| `tokio` | 1.54.1 | the runtime, `current_thread`: one thread serves everything (`rt net time macros sync signal` only) |
| `axum` | 0.8.9 | routing, extractors and its WebSocket upgrade (`http1 tokio ws json`, no defaults) |
| `hyper` | 1.13.0 | the HTTP/1 connection itself, for its header-read timeout (below) |
| `hyper-util` | 0.1.21 | `TokioIo` and `TokioTimer` for hyper (`tokio service`) |
| `tower` | 0.5.3 | `ServiceExt::oneshot` to call the router per request (`util`) |
| `tower-http` | 0.7.1 | `CorsLayer` and `TimeoutLayer` (`cors timeout`) |
| `http-body-util` | 0.1.5 | `LengthLimitError`, to tell a too-big body from a broken one |
| `serde`, `serde_json` | 1.0.229, 1.0.154 | the messages; an externally tagged enum is exactly `{"hello": {...}}` |
| `clap` | 4.6.10 | the flags, derive, without colour or suggestions |
| `getrandom` | 0.3.4 | ids and codes from the OS; 0.3, not 0.4, because tungstenite already pulls 0.3 |

No TLS, no allocator, no logging crate (plain `eprintln!`, never an address). Tests add
`tokio-tungstenite` 0.29 (axum's tungstenite), `reqwest` 0.13.5 and `futures-util`.
`cargo tree -d -e normal` is empty apart from build-time `syn`.

## Verified (by `cargo test`, `master/test/e2e.mjs`, `master/test/load.mjs`)

- **axum 0.8's `serve` sets no timer**, so hyper's header-read timeout (30 s by default) is
  off and a connection that never sends headers stays open forever (read in
  `axum-0.8.9/src/serve/mod.rs`: `Builder::new(TokioExecutor::new())`). `master/src/lib.rs`
  runs its own accept loop: `http1::Builder::new().timer(TokioTimer::new()).header_read_timeout(..)`
  `.serve_connection(..).with_upgrades()`, with `ConnectInfo` put into each request by hand.
  The test opens a connection, sends nothing, and sees it closed.
- **tungstenite's defaults cost 128 KiB a socket** (`read_buffer_size`). 1,000 host sockets took
  157 MB; with `read_buffer_size(4096)`, `write_buffer_size(0)` and a bounded
  `max_write_buffer_size` they take 32 MB, and relay p99 fell from 430 ms to under 10 ms.
- **Nothing in hyper or axum bounds a stalled response write.** A client that sends
  `GET /lobbies` and never reads held its connection (and the answer) forever. `master/src/stall.rs`
  wraps each socket and fails a write that makes no progress for `--write-stall` seconds; the
  test fails without it.
- **Framework refusals are not JSON**: axum's 405, `TimeoutLayer`'s 408 (empty) and a failed
  WebSocket upgrade (plain text). `api::why_json`, a `map_response` layer, rewrites them as
  `{"why"}`. `Retry-After` needs `expose_headers` for a cross-origin page to read it.
- **`to_bytes` errors are not all "too big"**: walk the error's sources for
  `http_body_util::LengthLimitError` (413); anything else (a broken chunked body) is 400.
- **`TimeoutLayer` covers a slow body**: extractors run inside the service, so a join whose
  body trickles in ends with 408.
- **A WebSocket upgrade ends hyper's connection future**, so a per-connection guard does not
  count held host sockets: count those separately (a host slot is taken before the upgrade).
- **hyper's header-read timeout also covers an idle keep-alive connection**: it starts in
  `poll_read_head` whenever the connection is idle (hyper 1.13.0 `proto/h1/conn.rs:224`).
- **Chromium 158's mDNS-only offer works on one machine with no STUN**: the node-datachannel
  host's answer carries real host candidates and the pair opens host-host (200 to 270 ms click to
  open). No `--disable-features=WebRtcHideLocalIpsWithMdns` needed.
- **The master's own STUN answer works for both ends**: with `--stun-port` and
  `--stun stun:127.0.0.1:<port>`, Chromium and libdatachannel each gathered a srflx candidate
  from it and the pair was srflx-srflx. The encoding passes RFC 5769's IPv4 and IPv6 vectors.
- **CI** (`.github/workflows/master.yml`): musl builds need no C toolchain beyond the runner's
  `musl-tools`; `ubuntu-24.04-arm` builds aarch64 musl natively; one `macos-latest` runner builds
  both macOS targets. `rust:1.96-alpine` builds a static binary for a `FROM scratch` image.

## Not verified

Either TLS recipe in the README (Caddy, Cloudflare Tunnel); the master on the public
internet or across any real network; a browser other than Playwright Chromium 158 through
it; `workflow_dispatch` (works only once the file is on the default branch); the Docker image
run locally (no daemon here; CI builds and runs `--version`); memory on Linux (measured on
macOS arm64 only); behaviour past 1,000 lobbies or 100 joins a second; whether hyper's
IPv6 limits beyond the /56 and /48 caps (a holder of many /48s still adds up). Refresh
when a pinned version changes or a probe contradicts a line above.
