---
name: lobby-transport
description: Verified facts and recipes for player-hosted multiplayer from an https page (zahynailo.dev) - WebRTC data channels signalled by a master server, WebTransport by certificate hash, NAT traversal, and a page reaching a helper on the visitor's own 127.0.0.1. Load before building the master server, the dedicated server's door, the lobby list, or the local model helper (issue #526).
---

# Lobby transport

Verified November 24-25, 2026 by `probes/lobby-transport/` (exact commands in its
README, results in `results/`). Library versions and the seat-protocol facts are in
`.agents/skills/seat-transport/SKILL.md`; this pack adds what internet play needs.

| Package | Version | Role |
| --- | --- | --- |
| `node-datachannel` | 0.33.6 (libdatachannel 0.24.6) | the host's WebRTC end, W3C API through `node-datachannel/polyfill` |
| `@fails-components/webtransport` (+ `-transport-http3-quiche`) | 1.6.11 | WebTransport server (and a Node client) |
| `playwright` | 1.65.0 (Chromium 158.0.8127.18) | headless and headed Chromium |

Browsers: Playwright Chromium 158, and the real Safari 27.2 on macOS 27.2 (Apple silicon),
opened with `open -a Safari` and closed by AppleScript. Node 25.1 on the Mac, 24.22 on runners.
Page origin: `tailscale serve` https on the tailnet (a real certificate). The far end for NAT
tests: a GitHub-hosted `ubuntu-latest` runner, signalled through comments on a private issue.

## Decision

WebRTC data channels, signalled by the master. WebTransport needs the host's UDP port
reachable: the runner's attempt to the Mac's public address timed out, and unsolicited UDP
to the Mac was dropped (`p1_recv: 0`). That attempt had no positive control (the Node
WebTransport client never connected anywhere in this probe), and that a browser's QUIC cannot
hole-punch is reasoning, not a run. Chromium also gates WebTransport to LAN and loopback
addresses behind a permission.

- **Master**: keeps one socket open to each host (built as a WebSocket at `GET /host`);
  takes one request from a client carrying its whole offer, pushes it to the host, and
  replies with the host's whole answer. No trickle. It never sees game traffic.
- **Host**: holds that socket, answers each offer with node-datachannel, and serves the
  world over three reliable data channels: `ctl`, `down` (the stream) and `up` (the
  requests). The door closes any other channel. Pace `down` by
  `bufferedAmount` and the `bufferedamountlow` event.

## Measured (see `results/`)

- **Across a real NAT, both ways** (Mac on a home NAT and a runner on Azure, no port
  forward): Node, Chromium 158 and Safari 27.2 clients all opened, every time through
  a **srflx-srflx** pair. Answer applied to channel open: 0.4-0.6 s. Round trip 50-58 ms.
  20 small messages a second for a minute, reliable and unordered: 0 lost.
- **Click to open on one machine through the stand-in master** (`server.mjs`, a host
  holding an SSE socket): Chromium 0.8 s, Safari 0.5 s. Over the NAT through the
  issue mailbox: 3.5-3.8 s, of which 2.4-2.7 s was the mailbox's polling. A real master
  should land near 1 s (gather 0.35 s, two master round trips, answer 0.05-0.2 s, open 0.4-0.6 s);
  that sum is inferred, not measured.
- **Throughput down at 50-56 ms round trip** (20 MB): Node to Node 17 Mbps with default
  SCTP buffers and 90 Mbps with `setSctpSettings({ sendBufferSize: 8 MiB, recvBufferSize: 8 MiB })`.
  Browsers sit at 6-15 Mbps whatever the host's buffers: Chromium 5.9 and 9.5 Mbps on one
  connection (default host), 12.6 with an 8 MiB host; Safari 13.3 and 15.2, then 12.0. The
  buffer change is within that spread, so it is not shown to help browsers. A 20 MB browser
  join took 13-28 s at that distance. Keep the join payload small; 8 MiB buffers only proved
  out Node to Node, with both ends changed.
- **NAT shapes** (STUN from one socket to three servers): the home NAT maps endpoint-
  independently and kept the port; the runner's maps endpoint-independently and did not.
  Both drop unsolicited UDP from a stranger; a two-way punch got through both ways.
  Two home networks of this kind will connect directly.

## Verified recipes

- **Whole-offer signalling needs a gathering deadline.** Chromium did not reach
  `iceGatheringState === 'complete'` within 15 s, and libdatachannel never did (below).
  Stop at `complete`, or once a `srflx` candidate is in and nothing new came for 300 ms,
  or at 3 s (`gathered()` in `lib/rtc-load.mjs`). Gathering then takes 0.35-0.42 s in
  browsers and 10-60 ms in Node.
- **libdatachannel and STUN hostnames**: with a STUN *hostname* and no IPv6 route,
  libjuice registers a second (AAAA) entry that stays pending forever, so gathering never
  completes. Resolve STUN servers to IPv4 literals before building the config. Pass
  `portRangeBegin`/`portRangeEnd` through the polyfill's config to pin the host's ICE ports.
- **Same code both ends**: `lib/rtc-load.mjs` runs on the W3C API in browsers and on
  `node-datachannel/polyfill` in Node. The polyfill reports `getStats()` round trips in a
  different unit; read candidate types, not RTT, from it.
- **WebTransport by hash works in Safari 27.2** (connect 97 ms on one machine) and Chromium
  158 (37 ms). Cert: ECDSA P-256, at most 14 days (`lib/cert.mjs`). With the
  fails-components Node client, pass `requireUnreliable: true`, or a failed QUIC
  handshake falls back to HTTP/2 and rejects later, unhandled.
- **Slow reader**: a data channel has no receive backpressure. The host's `bufferedAmount`
  stays at its 1 MiB high-water mark and the reader holds up to 19 MB. A WebTransport stream
  in Chromium pushes back: the host's writes took 8 s for a reader taking 2 MB/s. Safari 27.2
  does not: it buffered all 20 MB and the host finished in 0.5 s.

## A page reaching the visitor's own machine (test 4)

- **Chromium 158, Local Network Access**: a page whose origin is public (forced with
  `--ip-address-space-overrides=<ip>:<port>=public`; the tailnet's 100.64/10 origin counts
  as local, where nothing was gated) cannot `fetch` `http://127.0.0.1`, `localhost` or
  `[::1]`, nor open WebTransport to `127.0.0.1` or a LAN address, until the visitor allows it.
  The console says `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. Headless denies at once.
  Headed Playwright Chromium: the fetch had not settled after 12 s (presumably waiting on a
  prompt; no prompt was seen or captured, and the installed Chrome 158.0.8127.37 was not run).
  Granting `local-network-access` lets
  fetch and WebTransport through. WebRTC to a LAN host was not gated. The preflight carried no
  `Access-Control-Request-Private-Network` header; CORS headers alone were enough once allowed.
- **Safari 27.2 blocks `fetch` to `http://127.0.0.1`, `http://localhost` and `http://[::1]`**
  from an https page ("Load failed"; nothing reaches the helper). What works there:
  **WebTransport by certificate hash to `https://127.0.0.1:<port>`** (35 ms). The helper makes
  a 13-day cert and gives the page its hash through a link it prints
  (`https://zahynailo.dev/#helperwt=<hex>`; the fragment never reaches a server).
  The same WebTransport door also works in Chromium once the visitor allows local network access.
  Also verified: a page served by the helper itself on `http://127.0.0.1` is a secure context
  in Safari 27.2 (WebTransport defined) and reaches the helper by plain `fetch`.

## Shipping the host's end (read, not built)

- `node-datachannel` 0.33.6 ships prebuilt N-API 8 addons as optional packages:
  darwin-arm64, darwin-x64, linux-x64-gnu/musl, linux-arm64-gnu/musl, win32-x64-msvc,
  win32-arm64-msvc, android-arm64. **Loaded and opened a channel** on darwin-arm64 (Mac),
  linux-x64 and linux-arm64 (`ubuntu-24.04-arm`) and win32-x64 runners (`loads.mjs`).
  A packaged server would carry the right `.node` file on disk beside the executable;
  packaging was not tried, and whether a single-file executable can embed it was not read.
- `werift` 0.28.0 (released November 19, 2026) is pure TypeScript with its own `ice`, `dtls`
  and `sctp` packages in the repo (Node 22 or later, no native code): nothing to ship per
  platform. Read from npm and the repo only; not run, throughput unmeasured.
- A Rust sidecar (`str0m` 0.26, "a Sans I/O WebRTC implementation" per its README; `webrtc` 0.21) suits the Rust master but
  adds a second process and its own build matrix. Not needed while the server is Node.

## What needs a relay

A direct path fails when either end has endpoint-dependent (symmetric) mapping and the
other filters by address and port, which is typical of carrier-grade NAT on mobile
networks and some corporate firewalls. Neither tested end was like that. Then the only path is a
TURN relay: a public server carrying every byte of the game between that player and
the host (a 20 MB join per player), with short-lived credentials handed out by the
master. That is the owner's decision; none was set up. How often it is needed was not
measured, and no published figure was read in this probe.

## Not verified

A browser client to the home-NAT host (direction A's client was Node; browsers crossed the NAT
only to the runner host); `workflow_dispatch` (runs were started by a push); the darwin-x64 and
win32-arm64 prebuilds loading; iPhone Safari (and Safari on any other network); a client on cellular or carrier-grade NAT;
symmetric NAT at either end; a real master on the public internet (click to open over the
NAT is inferred from parts); WebTransport throughput across a real network; werift; a
packaged server binary; the wording of Chrome's local-network prompt (not captured);
Firefox. Refresh when a pinned version changes, when Safari or Chrome change local network
rules, or when a probe contradicts a line above.
