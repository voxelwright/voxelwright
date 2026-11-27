# village-master

Voxelwright's master server, in Rust. Dedicated servers hold a WebSocket to it and are listed as lobbies. Pages read the list and join through it with one WebRTC offer and one answer. It never carries game traffic, never sees a password or a key, and keeps nothing on disk.

The protocol, every limit and flag, STUN and the TLS recipes are in [the master server guide](../guide/master.md). How it fits with the dedicated server and the page is in [Playing together](../guide/multiplayer.md). Running a prebuilt archive is in [Host a server](../guide/hosting.md).

## Run it

```sh
cd master
cargo build --release
./target/release/village-master --help
./target/release/village-master --listen 127.0.0.1:8790        # plain HTTP on this machine only
```

Forwarded addresses are accepted only from a trusted TCP peer. With `--behind-proxy`, the default trusted networks are `127.0.0.0/8` and `::1/128`. Repeat `--trusted-proxy IP-OR-CIDR` to replace those defaults. Other peers use their socket address and the normal connection limits. A trusted peer must supply the configured header or the request gets 400.

Use `cf-connecting-ip` with a trusted Cloudflare Tunnel connector that supplies Cloudflare's client address. For `x-forwarded-for`, the master reads the rightmost value of the last header. In a multi-hop chain that value can identify another proxy. Configure the final trusted proxy to verify its upstream and rewrite the header with the client address.

It speaks plain HTTP and belongs behind a proxy that ends TLS. Where it runs, and whether it is reachable from the internet, is the operator's decision: nothing here exposes it.

## Where things are

| File | What |
| --- | --- |
| `src/main.rs` | Reads the flags and the operator's token, binds the ports, prints what it is doing |
| `src/config.rs` | Every flag and its default |
| `src/lib.rs` | The routes and the accept loop, with a header-read deadline and connection limits |
| `src/host.rs` | A dedicated server's WebSocket: hello, welcome, now, offer, answer, refuse, close codes |
| `src/api.rs` | A page's requests and the operator's, and the `{"why"}` shape of every refusal |
| `src/state.rs` | Everything held, in memory under one mutex: lobbies, joins waiting, counts by address, bans |
| `src/text.rs` | Cleaning typed text, checking pins and SDPs, ids and codes, and how an address is counted |
| `src/stun.rs` | The STUN Binding responder behind `--stun-port` |
| `src/stall.rs` | Drops a connection whose writes make no progress |
| `tests/protocol.rs` | The protocol and every limit, against a real listener |
| `test/e2e.mjs`, `test/load.mjs` | Real WebRTC through the master, and memory and relay time under load |

## Check it

```sh
cd master
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

End to end with real WebRTC, from the repository root. These borrow node-datachannel, Playwright and the WebRTC code from the [lobby-transport probe](../probes/lobby-transport/README.md), so install it first:

```sh
(cd probes/lobby-transport && npm ci && npx playwright install chromium)
node master/test/e2e.mjs 5                  # list, join 5 times, then once by a private code
E2E_STUN=1 node master/test/e2e.mjs 2       # the same with the master's own STUN on udp 5992
node master/test/load.mjs 1000 100 30       # 1,000 lobbies, 100 joins a second for 30 s
```

`e2e.mjs` uses ports 5990 (the master), 5991 (the page), 5992 (STUN) and 5993 to 5999 (the host's ICE). `load.mjs` prints resident memory and relay times. On an Apple M1 Pro the release binary held about 3 MB idle and 33 MB with 1,000 lobbies taking 100 joins a second. None of this has crossed a real network through this master.

## Builds

- **CI**: [`.github/workflows/master.yml`](../.github/workflows/master.yml) runs fmt, clippy and the tests on every push that touches `master/`. Run by hand (Actions, master, Run workflow), it also builds release binaries for Linux x64 and arm64 (static musl), macOS arm64 and x64, and Windows x64, and the Docker image. Binaries are kept as workflow artifacts for 30 days. Nothing is released or pushed to a registry.
- **Docker**: `docker build -t village-master master` makes a `FROM scratch` image holding only the static binary, listening on `0.0.0.0:8790`.
- **Archives**: `node scripts/packages.mjs` (from the repository root) builds it for macOS on Apple silicon and static Linux x64, with each crate's licence beside it.

Each server socket holds a file descriptor apart from the TCP connections, so `ulimit -n` must be above `--max-lobbies` plus `--max-connections` (9,096 with the defaults).
