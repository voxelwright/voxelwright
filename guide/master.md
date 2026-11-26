---
title: The master server
description: village-master lists lobbies and passes one WebRTC offer and one answer for each join. Its protocol, limits, flags and how to run it behind TLS.
---

The master server ([master/](https://github.com/voxelwright/voxelwright/tree/main/master), binary `village-master`) is a small Rust server that introduces pages to dedicated servers. A server holds a WebSocket to it and is listed as a lobby. A page reads the list and sends one offer to join; the master passes it to the server and brings back the server's answer. After that the page and the server talk directly ([Playing together](/multiplayer)). The master carries no game traffic, sees no password or key, and keeps nothing on disk. When it stops, every lobby is gone, and servers say hello again when it is back.

| It holds | For |
| --- | --- |
| Each lobby's record, id, private code and the address that opened it | The list, joins and bans |
| Joins waiting for an answer | At most 10 s each |
| Counts by address, per minute | Rate limits |
| Bans | Until they run out |

## The protocol

Protocol version 1. Everything is JSON. Names, abouts and refusals are text someone typed: the master removes control characters and bidirectional overrides, trims the rest, counts characters, and passes it on as text.

### A server's socket

A dedicated server opens a WebSocket at `GET /host` ([master/src/host.rs](https://github.com/voxelwright/voxelwright/blob/main/master/src/host.rs)).

| Direction | Message | Rules |
| --- | --- | --- |
| server to master | `{"hello": {"proto": 1, "name", "about"?, "pin", "most", "locked"?, "listed"?}}` | First, within 10 s. `about` defaults to `""`, `locked` to false, `listed` to true. `pin` is the world's release digest or `town`: letters, digits and `. _ : -`, at most 128. `name` 1 to 48 characters, `about` at most 200, `most` 1 to 1000. |
| master to server | `{"welcome": {"id", "code"}}` | `id` is 12 characters and public. `code` is 20 characters and private. |
| server to master | `{"now": {"players"?, ...any hello field}}` | Updates the record. Every field is checked before any is changed. |
| master to server | `{"offer": {"n", "sdp"}}` | `n` counts this lobby's joins, from 1. |
| server to master | `{"answer": {"n", "sdp"}}` or `{"refuse": {"n", "why"}}` | Within 10 s. An `n` with no join waiting is ignored. An answer that is not an SDP reaches the page as a refusal. |

Any message keeps a lobby alive. One silent for 60 s is gone. The engine's door sends `now` every 15 s. A server may send at most 50 messages a second.

The master closes a server's socket with a code and a short reason:

| Code | Why |
| --- | --- |
| 4400 | A message it can't take: not JSON text, not protocol 1, a field out of bounds, anything before the hello, a second hello, or too many messages |
| 4403 | Taken off by the operator, or the address is banned |
| 4408 | No hello in time, or silent too long |

Before the upgrade, `GET /host` can answer **429** (over the sockets opened a minute, or the lobbies an address or IPv6 /48 may hold), **403** (the address is banned), **503** (the master is full) or **400** (behind a proxy, no caller address).

### A page's requests

[master/src/api.rs](https://github.com/voxelwright/voxelwright/blob/main/master/src/api.rs):

| Request | Answer |
| --- | --- |
| `GET /` | `{"name": "village-master", "version", "proto": 1, "about", "lobbies"}`, where `lobbies` counts the listed ones |
| `GET /lobbies` | `{"lobbies": [{"id", "name", "about", "pin", "players", "most", "locked", "since"}], "next"}`: one page of listed lobbies in id order. `since` is Unix seconds. `next` is null on the last page, otherwise pass it as `?after=`. `?limit=` asks for 1 to 200 rows, `?pin=` only one release's lobbies. |
| `GET /lobbies/<id or code>` | That lobby's record, or 404. An id finds a listed lobby only. A code finds its own lobby, listed or not. Both are read case-insensitively. |
| `POST /lobbies/<id or code>/join` with `{"sdp"}` | `{"sdp"}`, the server's whole answer. **404** no such lobby. **409** `{"why"}` the server refused. **504** no answer in 10 s. **503** 8 joins already waiting on that server. **413** an SDP over 16,384 bytes. **400** not that JSON, or not an SDP. |
| `GET /ice` | `{"iceServers": [{"urls": [...]}]}` for `RTCPeerConnection` on both ends, or an empty list when no `--stun` was given |

An unlisted lobby's id answers exactly as an id nobody holds, on every route a page can call. The master reads a join's body as JSON whatever its `Content-Type`, so a page can send `text/plain` and skip the CORS preflight. CORS is open to any origin, without credentials, and exposes `Retry-After`.

Every refusal is `{"why": "..."}`, including the framework's own (405, a failed upgrade). **429** comes with `Retry-After: 60` and means over a per-address limit. **403** means the address is banned for now. **408** means the request took over 15 s. **400** also covers a body that broke off.

### The operator

With `--admin-token-file` (a file holding a token of at least 16 characters), a request with `Authorization: Bearer <token>` may:

| Request | Does |
| --- | --- |
| `DELETE /lobbies/<id or code>` | Takes the lobby off: 204, and its server's socket closes with 4403 |
| `POST /bans` with `{"lobby": "<id or code>", "minutes": 60}` | Bans the address behind that lobby without showing it, and takes off its lobbies. Answers `{"until", "lobbies_taken_off"}`. |
| `POST /bans` with `{"addr": "<ip>", "minutes": 60}` | Bans an address. `"minutes": 0` lifts the ban and answers `{"until": null}`. A ban lasts at most a year. |

Without the flag, these routes answer 404. A wrong token answers 401 and counts as a lookup, so guessing it is as slow as guessing a code. The operator is held to no limit or ban. There are no accounts.

## Limits

Each limit has a flag (below). These are the defaults.

| Per address | Limit |
| --- | --- |
| Server sockets opened | 10 a minute |
| Joins | 30 a minute |
| Lookups (`GET /lobbies`, `GET /lobbies/<x>`, a wrong operator token) | 120 a minute |
| Lobbies at once | 4 |
| TCP connections at once | 8 |

| In all | Limit |
| --- | --- |
| Lobbies | 5,000 |
| Joins waiting on one server | 8 |
| TCP connections | 4,096 |
| Addresses tracked for limits | 100,000 |
| Bans | 10,000 |

Minutes are fixed windows. A client has 10 s to send a request's headers, a request has 15 s in all, and a connection whose writes make no progress for 10 s (a client that stopped reading) is dropped. A connection over a connection limit is closed at once.

**How addresses are counted** ([master/src/text.rs](https://github.com/voxelwright/voxelwright/blob/main/master/src/text.rs) `addr_key`): an IPv4 address is itself, an IPv4-mapped IPv6 address is its IPv4, and any other IPv6 address is its **/56**, since a home is usually given a /56 or a /48. A whole **/48** may also hold at most 16 lobbies and 64 connections at once. The dedicated server's door counts addresses the same way.

**Guessing a code.** A code is 20 characters of a 32-letter alphabet (100 bits) from the operating system's randomness. One address gets at most 150 guesses a minute (lookups and joins together). With 5,000 lobbies live, one guess hits with odds of 5,000 in 2^100, about 3.9 × 10^-27. Ids (60 bits) find only listed lobbies, so guessing them gains nothing.

**Behind a proxy.** Without `--behind-proxy`, the caller is the socket's peer and any forwarding header is ignored. Behind a proxy that makes every player the proxy's address, so the per-address limits fill for everyone at once: always pass the flag there. With `--behind-proxy <header>`, the caller is the rightmost value of that header's last instance (what the nearest proxy wrote), a request without it gets 400, and the per-peer connection limits are off. The master warns at start when the flag is set on a non-loopback address, where anyone who reaches the port directly could write the header.

## STUN

`GET /ice` hands out the URLs given with `--stun stun:host:port` (repeatable). There is no default. With none, the list is empty, the master says so at start, and players reach each other only on one network.

`--stun-port 3478` makes the master answer STUN Binding requests itself ([master/src/stun.rs](https://github.com/voxelwright/voxelwright/blob/main/master/src/stun.rs), RFC 8489), so no third party sees a player's address. It answers Binding requests only, with 32 bytes (IPv4) or 44 (IPv6), at most 300 a minute for an address. It drops everything else and doesn't answer banned addresses. STUN is UDP and doesn't pass through an HTTP proxy: bind it with `--stun-ip` on an address players can reach, and list its public name with `--stun`. It counts addresses in a table of its own, so a flood of forged UDP sources can stop STUN answering new addresses for a minute but never touches HTTP.

There is no TURN relay. A player whose network maps each destination to a new port (common on mobile carriers) may not reach a server at all.

## Configuration

Every flag, from [master/src/config.rs](https://github.com/voxelwright/voxelwright/blob/main/master/src/config.rs). `village-master --help` prints the same list. Times are seconds and may be fractions.

| Flag | Default | What |
| --- | --- | --- |
| `--listen` | `127.0.0.1:8790` | Address and port for plain HTTP |
| `--behind-proxy` | none | Header that names the caller, such as `x-forwarded-for` or `cf-connecting-ip` |
| `--stun` | none | A STUN URL for `GET /ice`. Repeatable. |
| `--stun-port` | none | Answer STUN Binding requests on this UDP port |
| `--stun-ip` | `--listen`'s address | Address the STUN port is bound on |
| `--stun-per-minute` | 300 | STUN requests answered a minute for one address |
| `--admin-token-file` | none | The operator's token. Turns on `DELETE /lobbies/<x>` and `POST /bans`. |
| `--max-lobbies` | 5000 | Lobbies at once, in all (sockets waiting for their hello count) |
| `--max-lobbies-per-addr` | 4 | Lobbies at once from one address |
| `--max-lobbies-per-48` | 16 | Lobbies at once from one IPv6 /48 |
| `--registrations-per-minute` | 10 | Server sockets opened a minute by one address |
| `--joins-per-minute` | 30 | Joins a minute by one address |
| `--lookups-per-minute` | 120 | Lookups a minute by one address |
| `--host-messages-per-second` | 50 | Messages a second a server may send before its socket is closed |
| `--max-pending-joins` | 8 | Joins waiting on one server at once |
| `--max-connections` | 4096 | Open TCP connections in all |
| `--max-connections-per-addr` | 8 | Open TCP connections from one address (off with `--behind-proxy`) |
| `--max-connections-per-48` | 64 | Open TCP connections from one IPv6 /48 (off with `--behind-proxy`) |
| `--max-tracked-addrs` | 100000 | Addresses tracked at once. A new one past this is refused. |
| `--max-bans` | 10000 | Bans held at once |
| `--page-size` | 200 | Lobbies in one page of `GET /lobbies`, and the most `?limit=` may ask |
| `--max-sdp` | 16384 | Bytes in one SDP |
| `--max-name` | 48 | Characters in a lobby's name, after cleaning |
| `--max-about` | 200 | Characters in a lobby's about, after cleaning |
| `--max-most` | 1000 | Most players a lobby may say it takes |
| `--join-wait` | 10 | Seconds a join waits for the server's answer |
| `--silence` | 60 | Seconds a lobby may stay silent |
| `--hello-wait` | 10 | Seconds a new server socket has to say hello |
| `--host-write` | 5 | Seconds a write to a server may take before its socket is dropped |
| `--header-read` | 10 | Seconds a client has to send a request's headers |
| `--write-stall` | 10 | Seconds a write to any client may make no progress |
| `--request` | 15 | Seconds a request may take in all, a join's wait included |

Each server socket holds a file descriptor apart from the TCP connection count, so the open-file limit (`ulimit -n`) must be above `--max-lobbies` plus `--max-connections`: 9,096 with the defaults.

## Running it

```sh
cd master
cargo build --release
./target/release/village-master --listen 127.0.0.1:8790
```

It prints `village-master 0.1.0 on http://127.0.0.1:8790`, then a line for each lobby that comes and goes. Its logs never name an address. `docker build -t village-master master` makes an image holding only the static binary, which listens on `0.0.0.0:8790`; pass more flags after the image name. [Host a server](/hosting) covers the prebuilt archive.

The master speaks plain HTTP. Pages are served over HTTPS, so for anyone on another machine to use it, it needs an `https://` address from a proxy that ends TLS. Whether a master is reachable from the internet is its operator's decision.

Neither recipe below has been set up or run. Both come from the master's README and match what the code expects of a proxy.

**Caddy** gets and renews a certificate itself and proxies WebSockets as they are:

```text
master.example.org {
	reverse_proxy 127.0.0.1:8790
}
```

Run the master with `--behind-proxy x-forwarded-for`. Caddy writes the client's address as the rightmost `X-Forwarded-For` value.

**Cloudflare Tunnel** needs no inbound port, since `cloudflared` dials out:

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

Run `cloudflared tunnel run village-master` and the master with `--behind-proxy cf-connecting-ip`. A tunnel carries HTTP and WebSockets only, so `--stun-port` needs its own reachable UDP port.

The master's tests and end-to-end checks are in [master/README.md](https://github.com/voxelwright/voxelwright/blob/main/master/README.md). The crates and what was verified about them are in [the master-server skill](https://github.com/voxelwright/voxelwright/blob/main/.agents/skills/master-server/SKILL.md).
