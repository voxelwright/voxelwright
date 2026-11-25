---
name: seat-transport
description: Versions, verified recipes and limits for the seat protocol's transports (WebTransport via @fails-components, WebRTC data channels via node-datachannel, MCP via @modelcontextprotocol/sdk, browser checks via Playwright). Load before building or changing the room server, a seat transport or the agent gateway (issue #81).
---

# Seat transport

Verified November 8, 2026 on macOS 27.2 (Apple silicon), Node 25.1, by the
probe in `probes/seat-transport/` (pinned in its `package.json`):

| Package | Version | Role |
| --- | --- | --- |
| `@fails-components/webtransport` (+ `-transport-http3-quiche`) | 1.6.11 | HTTP/3 WebTransport server and Node client |
| `node-datachannel` | 0.33.6 (libdatachannel 0.24.6) | WebRTC data channels in Node |
| `@modelcontextprotocol/sdk` | 1.32.2 (with `zod` 4.6.7) | MCP server, client, streamable HTTP |
| `playwright` | 1.65.0 (Chromium 158, WebKit 27.2) | headless browser end of the probe |

Primary sources: each package's README and shipped `dist/` types;
`@fails-components/webtransport/readme.md` and `lib/session.js`;
`@modelcontextprotocol/sdk/dist/esm/shared/transport.d.ts` and
`server/streamableHttp.d.ts`; `node-datachannel/dist/types/lib/types.d.ts`.

## Verified recipes

- **WebTransport server**: `new Http3Server({ port, host, secret, cert, privKey })`,
  `sessionStream('/path')` before `startServer()`, then `await server.ready`.
  Prebuilt quiche binaries load on darwin-arm64; no build needed.
- **Self-signed certs**: browsers accept `serverCertificateHashes` only for an
  ECDSA P-256 cert valid at most 14 days. `lib/cert.mjs` makes one with openssl
  (13 days). No browser flags. Both Chromium 158 and Playwright WebKit 27.2
  accepted the hash. The page must be a secure context, so the probe serves it
  from `http://localhost`.
- **Datagrams**: the library has both `datagrams.writable` (logs "deprecated")
  and `datagrams.createWritable()`. Feature-detect in the browser.
- **WebRTC**: node-datachannel option names are `unordered: true` and
  `maxRetransmits: 0` (not the browser's `ordered: false`). Launch Chromium with
  `--disable-features=WebRtcHideLocalIpsWithMdns` for loopback host candidates.
  Signal through `page.evaluate`; wait for gathering `complete` on both sides.
- **MCP over any byte stream**: implement `start/send/close` with
  `onmessage/onclose/onerror` and newline-delimited JSON
  (`lib/stream-transport.mjs`). `Client.connect()` calls `start()` itself.
- **Streamable HTTP gateway**: stateless mode needs a fresh `McpServer` and
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request.
  Return a bare 401 with no `WWW-Authenticate` for a bad token and 404 on
  `/.well-known/*`.

## Facts that bit

- Playwright 1.65 wants its own browser builds (`npx playwright install chromium webkit`);
  older cached builds are ignored.
- Playwright WebKit closed the page during `RTCPeerConnection` setup, so WebRTC
  was not measured in WebKit here. The real Safari 27.2 runs both WebRTC data channels and
  WebTransport by certificate hash (#526, `.agents/skills/lobby-transport`).
- Claude Code 2.1.319 prints "OAuth fallback is disabled when headers.Authorization
  is set" on a 401. The gateway serves no OAuth metadata, so the probe did not
  test the older bug (headers ignored when OAuth is advertised). Keep serving none.
- In the Bash tool, `claude` is a shell function in the owner's profile; spawn it
  with `NODE_OPTIONS` and `CLAUDECODE` removed from the environment.
- `claude mcp add ... -s local` writes the header into `~/.claude.json`. The probe
  runs it from a temp directory and removes the entry afterwards.

## Verified by the street (#118), November 10, 2026

- **Over the tailnet**: `tailscale serve` proxies HTTP over TCP and does not carry QUIC.
  Serve the page through it (a secure context) and open the session straight to the
  machine's tailnet address; put the tailnet name and address in the certificate's
  subjectAltName. Chrome 158 and Playwright WebKit 27.2 accepted it by hash. The test was a
  Mac reaching its own tailnet address, so no real network was crossed.
- One `Http3Server` listens on one address: start one for each (loopback, tailnet), never `0.0.0.0`.
- Two seats at once, 30 snapshots a second of up to 1,150-byte datagrams: none lost on loopback.
- The library's TypeScript types ask for `defaultDatagramsReadableMode` in the server's
  options; the server runs without it.
- The Ally's Tailscale runs in userspace mode and has no UDP path, so it cannot be the far
  end of a WebTransport test.

## Not verified

Real iPhone Safari, LAN or Wi-Fi loss and jitter (all numbers are loopback),
more than one seat (NAT traversal: see `lobby-transport`), browser-side MCP, and the @fails-components
library under sustained load. Its author calls the HTTP/3 binding a
"duct tape-style solution until ... native support" in Node.

Refresh when any pinned version changes, when Node ships native HTTP/3, or when
a probe contradicts a line above.
