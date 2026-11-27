---
title: Host a server
description: Run a dedicated server, or the master that lists servers, from one archive each.
---

Voxelwright has two programs you can run yourself.

- **A dedicated server** is one world on your machine that other people join from the game's page. It keeps the world in a folder you choose. Players reach it directly over WebRTC once a master has introduced them.
- **The master** (`village-master`) keeps the list of servers. Pages read the list from it and ask it to introduce them to a server. It never carries the game and keeps nothing on disk. Idle, it uses about 3 MB of memory.

Each program is one archive. Unpack it and run it. Nothing needs installing: the server archive carries its own Node.js.

| Archive | macOS, Apple silicon | Linux x86-64, glibc 2.30 or newer |
| --- | --- | --- |
| `voxelwright-master-<version>-<platform>.tar.gz` | 0.9 MB, 2.6 MB unpacked | 1.0 MB, 2.9 MB unpacked |
| `voxelwright-server-<version>-<platform>.tar.gz` | 44 MB, 130 MB unpacked | 49 MB, 135 MB unpacked |

`<version>` is the commit the archive was built from, and `<platform>` is `darwin-arm64` or `linux-x64`. No other platforms are built yet: not Windows, Linux on ARM, Intel Macs or Linux with musl (Alpine).

The Linux server's WebRTC library (node-datachannel 0.33.6's prebuilt build) carries OpenSSL 1.1.1w inside it, a line that no longer gets public security fixes. The macOS build carries OpenSSL 3.6.3.

## Get the archives

Nothing is published yet. From a checkout of the repository, `node scripts/packages.mjs` writes all four archives to `dist-packages/`, with their SHA-256 sums in `dist-packages/SHA256SUMS`. Building needs Rust with the `aarch64-apple-darwin` and `x86_64-unknown-linux-musl` targets (`rustup target add x86_64-unknown-linux-musl`), npm and a network connection. `--only master` or `--only server` builds one kind, and `--platforms linux-x64` one platform.

Check an archive against its sum before you unpack it:

```sh
shasum -a 256 voxelwright-server-*.tar.gz      # Linux: sha256sum
```

**On a Mac**, a file downloaded with a browser is marked as coming from the internet. macOS then refuses to run the master and the server's WebRTC library, because they are not signed with an Apple developer ID: a program held this way waits silently or shows a dialog. After unpacking, clear the mark once on each folder:

```sh
xattr -dr com.apple.quarantine voxelwright-master-<version>-darwin-arm64 voxelwright-server-<version>-darwin-arm64
```

A file fetched with `curl` or copied with `scp` carries no mark.

## 1. Run a master

Skip this step if you use a master someone else runs.

```sh
tar xzf voxelwright-master-<version>-<platform>.tar.gz
cd voxelwright-master-<version>-<platform>
./village-master --listen 127.0.0.1:8790
```

It prints `village-master 0.1.0 on http://127.0.0.1:8790` and runs until you press Ctrl-C. `./village-master --help` lists every flag. A server that loses its master says hello again once the master is back.

On `127.0.0.1`, only this machine can reach the master. To serve it to other machines, put a proxy that ends TLS in front of it and pass `--behind-proxy <header>`. Loopback peers are trusted by default. If the proxy connects from another address, specify its IP or network with `--trusted-proxy`. The master guide has two recipes, the protocol and every limit: https://github.com/voxelwright/voxelwright/blob/main/guide/master.md

## 2. Run a dedicated server

Choose a folder for the world and put an admin password in a file there. Passwords are read from files, never from the command line:

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

Within a few seconds it prints lines like these:

```text
the ground is San Francisco, release 94869d520e5f (https://voxelwright.world/current.json, objects kept in /home/you/fern-hollow/world.releases once checked)
a dedicated server on San Francisco release 94869d520e5f
listed with the master as lobby h6wkz2xfky3e; its private code is 03570hdxpbevgdrhvws7
lobby h6wkz2xfky3e, code 03570hdxpbevgdrhvws7: a page joins with ?lobbies=1&master=http%3A%2F%2F127.0.0.1%3A8790&lobby=h6wkz2xfky3e
```

When someone joins it prints `Ada (v4034f0e55) joined`, and `left` when they go. Press Ctrl-C to stop it. Everything done to the world is kept, so starting it again with the same `--world` brings the world back.

**The release.** `--release` is the address of the game's `current.json`, or a folder holding a built release. The server reads the release named there once, at start, and pins it by its SHA-256 digest. It fetches each piece of the city the first time someone needs it, checks it against the release's manifest, and keeps it. A page joins only a server on its own release, so when the game moves to a new release, restart the server to follow it. Without `--release`, the world is the generated town, which the game's page does not join.

**What it keeps.** Everything lives beside the world's file and is named after it:

- the world itself (`world.log`), which stops taking changes at 256 MB;
- the door's secret, bans, password hash and the settings an admin changed (`world.log.door.json`, readable only by you);
- who has been here (`world.log.people.json`);
- any realms (`world.realms/`) and the finer looks of living things (`world.fine/`);
- reports from pages (`world.log.reports.jsonl`);
- the city's pieces (`world.releases/`), about 18 MB at first and more as people walk further.

`--release-cache` and `--reports` put the last two elsewhere. A flag given at start wins over a setting an admin changed. If `world.log.door.json` is there but can't be read, the server stops rather than write over its bans.

**Who can reach it.** The world's own HTTP server listens on `127.0.0.1:5747` (`--port`), for this machine only. Players come in through WebRTC over UDP. `--ice-ports 50000-50020` pins the UDP ports it uses. Each player, and each join still being answered, holds one, so give a few more than `--most`. Players on other networks also need a master that hands out a STUN server (`--stun` on the master). In the one test across a home network's NAT, players then connected directly with no port forwarded; other kinds of network were not tested. There is no relay, so a player whose network gives each destination a different port (common on mobile carriers) may not get in.

`--password-file` makes a password every player must give. `--private` keeps the server off the master's list, so people join it by its code.

### Every flag

| Flag | Default | What |
| --- | --- | --- |
| `--world <file>` | required | The world's file. Everything else the server keeps goes beside it. |
| `--release <address or folder>` | the generated town | The release the world stands on |
| `--master <address>` | none | The master to be listed with. Without one, nobody can find the server. |
| `--name`, `--about` | the kept ones, else `A Village server` and none | What the list shows. A name is cut to 48 characters, an about to 200. |
| `--most <n>` | 8 | The most players at once, 1 to 64 |
| `--private` | off | Not listed: joined by its code only |
| `--password-file <file>` | none | A password every player must give |
| `--admin-password-file <file>` | none | The password that makes someone an admin |
| `--port <n>` | 5747 | The world's own HTTP server, on `127.0.0.1` |
| `--ice-ports <a-b>` | any | The UDP ports WebRTC uses |
| `--asks <n>` | 30 | Requests a second from one player |
| `--up-mb <n>` | 24 | Megabytes one player may send a minute |
| `--columns <n>` | 65536 | Columns of the ground one player may ask about a second |
| `--backlog-mb <n>` | 32 | Megabytes of replies a player asked for and has not read, before they are let go |
| `--things-minute <n>` | 6 | Things one player who is not an admin may make a minute |
| `--changes-minute <n>` | 30 | Changes to things one such player may make a minute |
| `--things <n>` | 40 | Things one such player may have standing |
| `--cells <n>` | 4000000 | Cells one such player may have standing, all told |
| `--reach <n>` | 1200 | How far from where they stand (in 10 cm cells) one such player may make or put a thing |
| `--waiting-per-address <n>` | 2 | Joins from one address that may wait for their hello at once |
| `--release-cache <folder>` | `world.releases/` | Where the city's pieces are kept |
| `--reports <file>` | `world.log.reports.jsonl` | Where pages' reports are kept |
| `--arrive=x,y,z,yaw` | the city's meeting place | Where people arrive, in cells and radians. Give a value that starts with `-` with `=`. |
| `--tiles-most <n>` | 16 | Tiles the world holds beyond its players' own ground |
| `--ground-wait <ms>` | 3000 | How long a request waits for its ground before it is refused |

A flag the server does not know stops it.

## 3. See it listed and join

Ask the master what it lists:

```sh
curl http://127.0.0.1:8790/lobbies
```

```json
{"lobbies":[{"id":"h6wkz2xfky3e","name":"Fern Hollow","about":"bricks and talk","pin":"94869d520e5f…","players":0,"most":8,"locked":false,"since":1795726982}],"next":null}
```

A page joins at the game's address, `https://voxelwright.world/`, with `?lobbies=1&master=<the master's address>&lobby=<the id>`. It asks the visitor before it goes to a master that a link names. A private server is joined with its code in place of the id. With `?lobbies=1&master=<the master's address>` in the address, **Servers…** in the game's settings lists every server that master lists on the page's release.

The game's page is served over HTTPS, so for anyone else to join, the master must have an `https://` address: put it behind a proxy that ends TLS (step 1), and give that address to the server's `--master` and to the link. A master on plain `http://127.0.0.1` can be reached only from a browser on the same machine, and only where the browser lets an HTTPS page ask this machine: Chrome asks for permission first, and Safari refuses.

Once in, an admin opens the server's panel, chooses **I am an admin…** and gives the admin password. The panel then lists the players with Kick and Ban, the bans with Lift, and controls for the password, the most players, who may build, a message to everyone, and the server's name.

## What is inside

The master archive holds the `village-master` program (static on Linux), this page as `README.md`, the project's `LICENSE` and `NOTICE`, and `THIRD-PARTY.md`, which lists every Rust crate built into the program. The `licenses/` folder holds each crate's own licence files.

The server archive holds:

- `bin/voxelwright-server`, a short script that runs `engine/server.mjs` with the Node in this folder. A symbolic link to it from a folder on your `PATH` works.
- `node/`, Node.js 24.22.3 exactly as nodejs.org builds it, with its licence.
- `engine/`, the 86 files of the engine the server runs, the same as `engine/` in the repository at that commit: its code, its plugins, the compiled core (`page/core.wasm`) and San Francisco's arrival point. Nothing for tests, the city pipeline or drawing the world is included.
- `engine/node_modules/`, its three dependencies and what they need: node-datachannel (WebRTC, with the prebuilt library for this platform) and quickjs, which runs a world's rules in a box.
- `THIRD-PARTY.md` and `licenses/`, the licences of everything above, including the libraries inside node-datachannel's prebuilt library: libdatachannel, libjuice, usrsctp, libsrtp, plog and OpenSSL.

How strangers share a world, and what a server lets them do, is in the guide: https://github.com/voxelwright/voxelwright/blob/main/guide/multiplayer.md
