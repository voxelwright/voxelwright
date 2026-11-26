# Host a server

Voxelwright has two programs you can run yourself.

- **The master** keeps the list of servers. Pages read the list from it and ask it to introduce them to a server. It never carries the game. A master uses about 3 MB of memory.
- **A dedicated server** is one world on your machine that other people join from the game's page. It keeps the world in a folder you choose. Players reach it directly over WebRTC once the master has introduced them.

Each program is one archive. Unpack it and run it. Nothing needs to be installed: the server archive carries its own Node.js.

| Archive | macOS, Apple silicon | Linux x86-64 (glibc 2.30 or newer) |
| --- | --- | --- |
| `voxelwright-master-<version>-<platform>.tar.gz` | 0.8 MB, 2.6 MB unpacked | 1.0 MB |
| `voxelwright-server-<version>-<platform>.tar.gz` | 44 MB, 130 MB unpacked | 49 MB |

The Linux server's network library, node-datachannel 0.33.6's prebuilt build, carries OpenSSL 1.1.1w inside it. That OpenSSL line no longer gets public security fixes. The macOS build carries OpenSSL 3.6.3.

No other platforms are built yet: not Windows, Linux on ARM, Intel Macs or Linux with musl (Alpine).

## Get the archives

Nothing is published yet. From a checkout of the repository, `node scripts/packages.mjs` writes all four archives to `dist-packages/`, with their SHA-256 sums in `dist-packages/SHA256SUMS`. Building needs Rust with the `aarch64-apple-darwin` and `x86_64-unknown-linux-musl` targets (`rustup target add x86_64-unknown-linux-musl`), npm and a network connection.

Check an archive against its sum before you unpack it:

```sh
shasum -a 256 voxelwright-server-*.tar.gz      # Linux: sha256sum
```

**On a Mac**, a file downloaded with a browser is marked as coming from the internet, and macOS refuses to run the master and the server's network library because they are not yet signed by an Apple developer ID. A program held this way waits silently or shows a dialog. After unpacking, clear the mark once on each folder:

```sh
xattr -dr com.apple.quarantine voxelwright-master-<version>-darwin-arm64 voxelwright-server-<version>-darwin-arm64
```

A file fetched with `curl` or copied with `scp` carries no mark and needs no `xattr`.

## 1. Run a master

```sh
tar xzf voxelwright-master-<version>-<platform>.tar.gz
cd voxelwright-master-<version>-<platform>
./village-master --listen 127.0.0.1:8790
```

It prints `village-master 0.1.0 on http://127.0.0.1:8790` and keeps running until you press Ctrl-C. `./village-master --help` lists every limit. The master keeps nothing on disk. A server that loses its master says hello again once the master is back.

On `127.0.0.1` only this machine can reach the master. Serving it to the internet means putting a proxy that ends TLS in front of it and passing `--behind-proxy <header>`. The repository's `master/README.md` has two recipes, the protocol and every limit.

## 2. Run a dedicated server

Choose a folder for the world and put an admin password in a file there. Passwords are read from files, never typed on the command line:

```sh
tar xzf voxelwright-server-<version>-<platform>.tar.gz
mkdir -p ~/fern-hollow
(umask 077; printf '%s\n' 'a long admin password' > ~/fern-hollow/admin.txt)
./voxelwright-server-<version>-<platform>/bin/voxelwright-server \
  --world ~/fern-hollow/world.log \
  --release https://voxelwright.world/current.json \
  --master http://127.0.0.1:8790 \
  --name "Fern Hollow" --about "bricks and talk" --most 8 \
  --admin-password-file ~/fern-hollow/admin.txt
```

Within a few seconds it prints:

```
the ground is San Francisco, release 89d8b029f0d2 (https://voxelwright.world/current.json, objects kept in /home/you/fern-hollow/world.releases once checked)
a dedicated server on San Francisco release 89d8b029f0d2
listed with the master as lobby n502edtshm60; its private code is 0k2xjp011q0my49n9aqz
lobby n502edtshm60, code 0k2xjp011q0my49n9aqz: a page joins with ?lobbies=1&master=http%3A%2F%2F127.0.0.1%3A8790&lobby=n502edtshm60
```

When someone joins, it prints `Ada (v4034f0e55) joined`, and `left` when they go. Press Ctrl-C to stop it. Everything done to the world is kept, so starting it again with the same `--world` brings the world back.

**The release.** `--release` is the address of the game's `current.json`. The server reads the release named there once at start and pins it by its SHA-256 hash. It then fetches each piece of the city when someone first needs it, checks the piece against the release's manifest and keeps it. A page joins only a server on its own release. When the game moves to a new release, restart the server to follow it.

**What it keeps.** Everything lives beside the world's file, named after it:

- the world itself (`world.log`);
- the door's keys and bans (`world.log.door.json`, readable only by you);
- who has been here (`world.log.people.json`);
- any realms (`world.realms/`) and the finer looks of living things (`world.fine/`);
- reports from pages (`world.log.reports.jsonl`);
- the city's pieces (`world.releases/`), about 13 MB at first and more as people walk further.

`--release-cache <folder>` and `--reports <file>` put the last two elsewhere. With an address as `--release`, the server reads and writes nothing else. On Linux it also reads its own program file, to tell glibc from musl.

**Who can reach it.** The world's own HTTP server listens on `127.0.0.1:5747` (`--port`), for this machine only. Players come in through WebRTC on UDP. `--ice-ports 50000-50020` pins the ports it uses: each player, and each join still being answered, holds one, so give a few more than `--most`. Players on other networks also need those UDP ports forwarded to this machine and a master that hands out a STUN server (`--stun` on the master).

`--password-file <file>` makes a password every player must give. `--private` keeps the server off the master's list, so people join it by its code. The repository's `engine/README.md` explains every other flag, under "A server of your own".

## 3. See it listed and join

Ask the master what it lists:

```sh
curl http://127.0.0.1:8790/lobbies
```

```json
{"lobbies":[{"id":"n502edtshm60","name":"Fern Hollow","about":"bricks and talk","pin":"89d8b029f0d2…","players":0,"most":8,"locked":false,"since":1795649891}],"next":null}
```

A page joins at the game's address, `https://voxelwright.world/`, with `?lobbies=1&master=<the master's address>&lobby=<the id>`. It asks the visitor before it goes to a master that a link names. A private server is joined with its code in place of the id.

The game's page is served over https, so for anyone else to join, the master must have an `https://` address: put it behind a proxy that ends TLS (step 1) and give that address to the server's `--master` and to the link. A master on plain `http://127.0.0.1` can be reached only from a browser on the same machine, and only where the browser lets an https page ask this machine: Chrome asks for permission first, and Safari refuses.

## What is inside

The master archive holds the `village-master` program (static on Linux), this page, the project's `LICENSE` and `NOTICE`, and `THIRD-PARTY.md`, which lists every Rust crate built into the program. The `licenses/` folder holds each crate's own licence files.

The server archive holds:

- `bin/voxelwright-server`, a short script that runs `engine/server.mjs` with the Node in this folder.
- `node/`, Node.js 24 exactly as nodejs.org builds it, with its licence.
- `engine/`, the server's own files, the same as `engine/` in the repository at that commit: about 80 files of the engine's code that the server imports, its plugins, the compiled core (`page/core.wasm`) and San Francisco's arrival point. Nothing for tests, the city pipeline or the page that draws the world is included.
- `engine/node_modules/`, its three dependencies and what they need: node-datachannel (WebRTC, with the prebuilt library for this platform), and quickjs for running a world's rules in a box.
- `THIRD-PARTY.md` and `licenses/`, the licences of everything above, including the libraries inside node-datachannel's prebuilt library: libdatachannel, libjuice, usrsctp, libsrtp, plog and OpenSSL.

<!-- docs-verified -->

<!-- docs-verified 29eeb815ae09da45d25dcaf9dc1064957b6a7e43 {"engine/server.mjs":"a9868d90394bb1e66f8e0be61e8621fb","scripts/packages.mjs":"0f61fdc3d696b7cbe474731cb0c1dc03","engine/ground.mjs":"306384f7780c554468343e8c9339d2e2","master/src/config.rs":"17fb726a77712b7205a15a882e4ee581"} -->
