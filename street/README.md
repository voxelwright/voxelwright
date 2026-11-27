# The street

> **Paused prototype.** Active work is in the [engine](../engine/README.md). This folder still builds and its checks run.

The street is one block of a San Francisco hill street shared by everyone on it. A world process owns one simulation, the home's physics `World` (`home/src/engine/world.ts`), steps it 60 times a second and gives each WebTransport session a walker. A page draws it. People make things by typing a sentence, agents can live there as residents through an MCP door, and one house's door leads into [the home](../home/README.md). There is no sign-in and the residents are synthetic. The [Village guide page](../guide/village.md) shows how it fits with the rest.

## Run

```sh
cd ../home && npm ci   # the solver is the home's
cd ../street && npm ci
npm run world          # WebTransport on 127.0.0.1:4433, /where, /stats and /mcp on 4434
npm run page           # http://localhost:5318
```

World options (from the header of `src/server.ts`), passed after `npm run world --`:

| Option | Effect |
| --- | --- |
| `--maker stub\|haiku\|sonnet\|opus` | Turns making on. A model spends the signed-in Claude Code's usage and needs `--allow-claude`, because anyone who reaches the street can use it; `stub` makes a crate of anything, for checks. |
| `--world <dir>` | Where made things are kept (default `~/.village/street`; `none` keeps nothing). |
| `--problems`, `--rest <seconds>` | Puts the block's three residents who want something on it; how long one stays solved (180). |
| `--cells` | Everything on the block is made of 10 cm cells that `hammer` and `boom` can break. |
| `--home <address>` | House No. 102's door leads to the home at that address. |
| `--host <address>`, `--name <host name>` | Listen on a tailnet address as well. The server refuses every interface (`0.0.0.0`, `::`). |
| `--port`, `--http` | The WebTransport and HTTP ports (4433, 4434). |

Over the tailnet: `npm run world -- --host 127.0.0.1 --host <tailnet address> --name <tailnet name>`, start the page with `STREET_ALLOWED_HOST=<tailnet name> npm run page` (it answers only local names otherwise), then `tailscale serve --bg --https=10118 http://localhost:5318`. WebTransport is QUIC, which `tailscale serve` does not carry, so the page comes through `serve` and the session goes straight to the tailnet address, accepted by the certificate's hash.

## Play

Walk with WASD (or the left side of a phone's screen), jump with Space, turn with Q and E or by dragging. Press Enter and type what you want ("a plank bridge across the trench"); it appears in front of you, for everyone. The dark button cycles the verbs: `make`, `change` (a sentence about the made thing you face), `say`, and with `--cells`, `hammer` and `boom`. `undo` takes back your last thing; `top` takes you back to where you arrived. `?name=<name>` sets your name.

Page parameters: `?predict=0` draws your walker from the world's answer instead of ahead of it, `?delay=50` holds everything 50 ms each way, `?stop=1` stops your walker at things as drawn, `?q=low` asks for the cheapest of the home's quality tiers, `?post=0`, `?sky=0` and `?land=0` leave those layers out.

## How it works

- **The block is data.** The street, lamps, trees, crates, balls, bins and sixteen houses are toys (`src/scene.ts`, `src/houses.ts`). A resident is a toy with one upright part and a `walker` gadget whose knobs are the seat's input. `src/block.ts` builds them into `World`, so the world process, every page and every agent hold the same street.
- **The wire** (`src/wire.ts`). Poses and inputs go as datagrams; what must arrive goes as JSON lines. A blow on cells travels as the cut, and a late page is sent each thing's cells as they stand.
- **Your walker runs ahead.** The page applies the same walking rule (`src/walk.ts`) before the world answers, so your own walker moves in one frame at any delay. Other things are drawn from snapshots. Pushing a crate is still seen one round trip late, because the page does not simulate other things.
- **The page runs `World` too,** over a core that is posed, not stepped (`src/puppet.ts`), so it draws the same toys the world built. `client/look/` paints its own sky, ground, houses, trees and cars over the world's plain collision shapes, on the home's stage and quality tiers. `client/place.ts` draws the land round the block; `client/figure.ts` draws residents as the home's felt villagers.
- **Making** (`src/make.ts`). A model writes the thing as toy data, the engine's checker holds it to `STREET_LIMITS` (sizes up to 4 m, mass up to 4,000 kg, 8 parts, 40 pieces a part, one gadget kind), a scratch world lets it settle, and one failed answer goes back once with the reason. Nothing the model writes runs. Made things are kept as files under `<world>/made/`.
- **Problems** (`src/problems.ts`). A problem is data: who has it, what they say, and a test the world runs on real bodies (past a line, feet above a height, a made thing between someone and the sun). No model decides that one is solved. Solved problems go to `<world>/solved.jsonl`.
- **Agents as residents** (`src/agents.ts`). A resident presses `+agent`; the page shows only them a `claude mcp add` command with a key valid 12 hours for one agent. The agent sits down through a streamable-HTTP MCP server at `/mcp` and gets a body and the tools `arrive`, `look`, `walk_to`, `face`, `say`, `make`, `change`, `guide`, `build`, `undo`, `top` and `observe`. What it is told is data; the world walks its body for it.

## Folder map

| Path | What it holds |
| --- | --- |
| `run.mjs` | Starts `src/server.ts` through Vite's in-process loader, because `World` is written for a bundler. |
| `src/server.ts` | The world process: ticks, seats, the HTTP side, making and the door. |
| `src/scene.ts`, `src/houses.ts`, `src/house-cells.ts`, `src/ground.ts`, `src/sun.ts` | The block, its houses, the ground and the sun. |
| `src/block.ts`, `src/puppet.ts`, `src/walk.ts`, `src/wire.ts` | `World` for the street, the posed core, walking, the wire format. |
| `src/make.ts`, `src/problems.ts`, `src/agents.ts` | Making, problems, the agents' door. |
| `client/` | The page: `main.ts`, `place.ts`, `figure.ts` and the drawn look in `look/`. |
| `test/` | Checks, benches and recording tools. |

## Checks

```sh
cd .. && npm run check -- --only street-block street-two street-make
```

Names from `scripts/checks.mjs`: `street-typecheck`, `street-block`, `street-clear`, `street-problems`, `street-two`, `street-make`, `street-agent`, `street-door`, `street-problem`, `street-touch`, `street-cells`, `street-look`. The `voxels` check (in `home/`) covers breaking cells. CI does not install `street/` yet, so these run on a developer machine.

Benches in `package.json`: `npm run tick` (the block on `World`, every body awake), `npm run two` (two browsers at several delays), `npm run push` (walking into a crate). With a real model, by hand: `node test/make-lab.mjs out.json sonnet "a ladder"` and `node test/resident.ts clip/ sonnet sonnet`.

## Ideas to carry forward into the engine

1. **Problems as data, judged by the world.** A goal is a test on real bodies, never a model's verdict: `src/problems.ts`.
2. **An MCP door for agents.** A key a resident asked for, a body like anyone's, the world as data, intent-level verbs (`walk_to`, not keys): `src/agents.ts`.
3. **Change as the second verb.** A sentence about the thing you face goes back to the maker with the thing as it is: `src/make.ts`.
4. **Your own walker runs ahead** with the same rule the world applies: `src/walk.ts`.
5. **One world, a posed copy on the page.** The page builds the same toys over a core that does not step: `src/puppet.ts`.
6. **Never listen on every interface without sign-in:** the server refuses `0.0.0.0` (`src/server.ts`).
