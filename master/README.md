# village-master

Voxelwright's master server. A player runs a dedicated server on their own machine; other
players' pages find it here and reach it straight over WebRTC data channels. The master
lists lobbies and passes one whole offer and one whole answer for each join. It never
carries game traffic, never sees a password or a key, and keeps nothing on disk: when
it stops, every lobby is gone and the hosts say hello again. Anyone may run one.

Why this shape (WebRTC, whole-offer signalling, no trickle) is in
`.agents/skills/lobby-transport/SKILL.md`; the crates and recipes are in
`.agents/skills/master-server/SKILL.md`.

## Run it

```sh
cd master
cargo build --release
./target/release/village-master --help
./target/release/village-master --listen 127.0.0.1:8790        # plain HTTP on loopback
```

It speaks plain HTTP and is meant to sit behind a proxy that ends TLS (recipes below).
Where it runs and whether it is reachable from the internet is the operator's decision;
nothing here exposes it. Each host holds a socket, so the open-file limit must be above
`--max-lobbies` plus `--max-connections` (about 9,200 with the defaults; `ulimit -n`).

Packages: `.github/workflows/master.yml` builds release binaries for Linux x64 and arm64
(static musl), macOS arm64 and x64, and Windows x64 on every push that touches `master/`,
and keeps them as workflow artifacts for 30 days. Nothing is released or published.
`docker build -t village-master master` makes an image holding only the static binary. On a Mac without Actions,
`node scripts/packages.mjs` (from the repo's root) builds it for macOS arm64 and, with rust-lld, static Linux x64, as
archives with the crates' licences beside it (`guide/hosting.md`).

## The protocol (v1)

All JSON. Names and words are text someone typed: the master removes control characters
and bidirectional overrides, trims, counts characters, and passes the rest on as text.

**A host** holds one WebSocket to `GET /host`.

| | message | |
| --- | --- | --- |
| host → | `{"hello": {"proto": 1, "name", "about"?, "pin", "most", "locked"?, "listed"?}}` | first, within 10 s. `about` defaults to `""`, `locked` to false, `listed` to true. `pin` is the world's release digest or `"town"` (letters, digits, `. _ : -`, at most 128). `most` 1 to 1000. |
| ← master | `{"welcome": {"id", "code"}}` | `id`: 12 characters, public. `code`: 20 characters, the private way in. |
| host → | `{"now": {"players"?, ...any hello field}}` | at least every 20 s. Any message counts as a sign of life; silent for 60 s, the lobby is gone. A bad field closes the socket and changes nothing. |
| ← master | `{"offer": {"n", "sdp"}}` | `n` counts joins for this lobby only. |
| host → | `{"answer": {"n", "sdp"}}` or `{"refuse": {"n", "why"}}` | within 10 s. An answer for an `n` this lobby was not sent is ignored. |

The master closes a host's socket with a code and a reason: **4400** a message it cannot
take (not JSON, not a proto 1 message, a field out of bounds, a second hello, anything
before the hello), **4403** taken off or refused by the operator, **4408** no hello in time
or silent too long. Before the upgrade, `GET /host` can answer **429** (over the
registrations a minute, or the lobbies an address may hold), **403** (address refused),
**503** (the master is full) or **400** (behind a proxy, no caller address).

**A page**

| request | answer |
| --- | --- |
| `GET /` | `{"name": "village-master", "version", "proto": 1, "about", "lobbies"}` (`lobbies`: how many are listed) |
| `GET /lobbies` | `{"lobbies": [{"id", "name", "about", "pin", "players", "most", "locked", "since"}], "next"}`: one page of listed lobbies only, in id order (ids are random, so sort as you like). `since` is Unix seconds. `next` is null on the last page; otherwise `?after=<next>` gives the page after it. `?limit=<n>` asks for fewer than the page size (200), `?pin=<pin>` only lobbies of that world. |
| `GET /lobbies/<id or code>` | that record, or 404. An id finds a listed lobby only; a code finds its own lobby, listed or not. Codes are read case-insensitively. |
| `POST /lobbies/<id or code>/join` `{"sdp"}` | `{"sdp"}`, the host's whole answer; **404** gone (or never there); **409** `{"why"}` the host refused (or answered with something that is not an SDP); **504** the host did not answer in 10 s; **503** the host already has 8 joins waiting; **413** an SDP over 16,384 bytes; **400** not that JSON, or not an SDP. |
| `GET /ice` | `{"iceServers": [...]}` for `RTCPeerConnection` on both ends. Empty unless the operator gave `--stun`. |

Every refusal is `{"why": "..."}`, including the ones the framework makes (405, a failed
upgrade). **429** (with `Retry-After: 60`, exposed to pages) means over a per-address limit,
**403** the address is refused for now, **408** a request that took over 15 s, **400** a body
that broke off. CORS is open to any origin, with no credentials. The master reads a join's body as JSON whatever its
`content-type`, so a page can send it as `text/plain` and skip the preflight.

An unlisted lobby's id answers exactly as an id nobody holds, on every route a page can call.

**Inside the channel** (page and host; the master is not part of it): see the v1 comment on
issue #526.

## Limits

Every limit has a flag (`--help` lists them with their defaults). Per address, a minute:
10 host sockets opened, 30 joins, 120 lookups (`GET /lobbies`, `GET /lobbies/<x>`, a wrong
operator token). At once: 4 lobbies an address, 5,000 in all, 8 joins waiting on one host,
8 TCP connections from one peer, 4,096 in all. A client has 10 s to send a request's headers,
and a connection whose writes make no progress for 10 s (a client that stopped reading) is
dropped. A host may send 50 messages a second. An IPv6 caller is counted by its /56, since a
home is usually given a /56 or a /48; a whole /48 may also hold no more than 16 lobbies and 64
connections at once.

**Guessing a code.** A code is 20 characters of 32 (100 bits) from the operating system's
randomness. A page guesses through lookups and joins, at most 150 a minute from one address.
With 5,000 lobbies live, one guess hits with odds 5,000 / 2^100 = 3.9 × 10^-27. One address
guessing for a year (7.9 × 10^7 guesses) hits with odds 3.1 × 10^-19; a million addresses
for a year, 3.1 × 10^-13. Ids (60 bits) find only listed lobbies, so guessing them gains
nothing.

**Behind a proxy.** Without `--behind-proxy`, the caller is the socket's peer and any
forwarding header is ignored, whatever a caller writes. Behind a proxy that means every
player is the proxy's address, so the per-address limits fill for everyone at once: always
pass the flag there. With `--behind-proxy <header>` the caller is the rightmost value of the
header's last instance (what the nearest proxy wrote); a request without it is refused with
400, and the per-peer connection limit is off. The master warns at start when the flag is set
on a non-loopback address, where anyone reaching the port directly could write the header.

## The operator

With `--admin-token-file <file>` (a token of at least 16 characters), a request carrying
`Authorization: Bearer <token>` may:

- `DELETE /lobbies/<id or code>`: take a lobby off (204). Its host's socket closes with 4403.
- `POST /bans {"lobby": "<id or code>", "minutes": 60}`: refuse the address behind that lobby
  for a time, without anyone seeing the address, and take off its lobbies. `{"addr": "<ip>",
  "minutes"}` names an address; `"minutes": 0` lifts a ban on it.

Without the flag these routes answer 404. There are no accounts.

## STUN

`GET /ice` hands out what `--stun stun:host:port` names (repeatable). There is no default:
with none given it answers an empty list and says so at start, and players then reach each
other only on one network. `--stun-port 3478` has the master answer STUN Binding requests
itself, so no third party sees a player's address; bind it with `--stun-ip` on an address
players can reach (UDP does not pass through the HTTP proxy), and list its public name with
`--stun`. It answers Binding requests only, 300 a minute for an address, 32 or 44 bytes back.
It counts addresses in a table of its own, so a flood of forged UDP sources can stop STUN
answering new addresses for a minute but never touches the HTTP side.

## TLS: two recipes (not set up, not run)

**Caddy** (gets and renews a certificate itself; proxies WebSockets as they are):

```
master.example.org {
	reverse_proxy 127.0.0.1:8790
}
```

Run the master with `--behind-proxy x-forwarded-for`. Caddy writes the client's address as
the rightmost `X-Forwarded-For` value.

**Cloudflare Tunnel** (no inbound port; `cloudflared` dials out to Cloudflare):

```yaml
# ~/.cloudflared/config.yml, after `cloudflared tunnel create village-master`
# and `cloudflared tunnel route dns village-master master.example.org`
tunnel: village-master
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: master.example.org
    service: http://127.0.0.1:8790
  - service: http_status:404
```

Run `cloudflared tunnel run village-master` and the master with
`--behind-proxy cf-connecting-ip` (Cloudflare sets that header to the client's address).
A tunnel carries HTTP and WebSockets only: `--stun-port` needs its own reachable UDP port.

## Checks

```sh
# From the repo root.
(cd master && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
# End to end with real WebRTC on one machine (master on 5990, page on 5991, host ICE on 5993-5999):
(cd probes/lobby-transport && npm ci && npx playwright install chromium)
node master/test/e2e.mjs 5                  # lists, joins 5 times, then once by a private code
E2E_STUN=1 node master/test/e2e.mjs 2       # the same, with the master's own STUN on udp 5992
node master/test/load.mjs 1000 100 30       # memory and relay time: 1,000 lobbies, 100 joins a second
```

Measured November 25, 2026 on one machine (Apple M1 Pro, macOS 27.2, the release binary):

| | |
| --- | --- |
| release binary (macOS arm64) | 1.7 MB |
| resident memory, idle | 3.3 MB |
| with 1,000 lobbies | 32 MB, and 33 MB at the peak of 100 joins a second for 30 s (3,000 of 3,000 answered) |
| a join's relay on loopback (POST to reply: offer over the host's socket, its answer, back) | p50 0.9 ms, p99 6.1 ms |
| click to channels open, Playwright Chromium 158 to a node-datachannel host, through the master | 199 to 268 ms over three runs of 5 joins: gathering 130-145 ms, the master's relay 2-26 ms, the channels opening 55-125 ms |

All of this ran on one machine. Nothing here has crossed a real network through this master.
