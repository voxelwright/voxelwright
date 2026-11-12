# The engine (#140)

Village's own engine: a world of 10 cm cells, drawn with raw WebGPU by marching rays, with
its core in Rust built as wasm. Synthetic data, this machine or the tailnet only. What it is,
what it costs and what is not built: `.agents/skills/cell-engine/SKILL.md`.

- `core/`: Rust. Cells, sectors as trees, the generated city, blasts, what stands and what falls.
  One build for the page and (later) a world process.
- `page/`: the city, flown through. `main.ts` (the page), `world.ts` (boxes of sectors round
  the camera), `worker.ts` (makes sectors), `march.ts` (the ray marcher), `sun.ts` (the sun's shadows kept in maps), `edits.ts`,
  `settler.ts` (the worker that says what falls), `pieces.ts` (a piece on its way down), `crumbs.ts`,
  `flight.ts` (the flight that measures a device).
- `probe/`: a bare page that reports what a device can draw.
- `serve.mjs`: serves the pages' TypeScript with Node's type stripper and keeps what pages
  report in `~/.village/engine/reports.jsonl`.

## Run it

```sh
rustup target add wasm32-unknown-unknown   # once
cd engine && npm ci
npm run core        # builds core/ as wasm into page/core.wasm (a fresh checkout needs this)
npm run serve       # http://127.0.0.1:5740/city to fly; / runs the measuring flight first; /probe is the probe
```

Fly with WASD, the mouse after a click, Space and C for up and down, Shift for fast, the
wheel for speed. A click breaks what is ahead; 1, 2 and 3 pick how hard. On a phone the left
thumb moves, the right thumb looks, and the red button breaks. H shows how many steps each
pixel took, L and M turn shadows and mirrors off, K traces every shadow instead of using the sun's maps.

Address options: `?grid=16,8,16` `?levels=9` `?pool=256` `?scale=0.5` `?at=x,y,z`
`?look=yaw,pitch` `?shadows=0` `?mirrors=0` `?maps=0` `?heat=1` `?fly=0` `?seconds=40`.

To a phone on the tailnet: `tailscale serve --bg --https=10140 http://127.0.0.1:5740`.

## Checks

```sh
cd engine/core && cargo test --release
cd engine && npm run typecheck
node test/probe.mjs     # the probe page in Chrome with WebGPU, its report read back
node test/city.mjs      # the city made, looked at from five places
node test/flight.mjs    # the measuring flight, then a tree cut and a house front broken, each part's report read back (--phone: as a phone)
node test/blast.mjs     # glass breaks further than a wall
node test/shadows.mjs   # the sun's maps against traced shadows: still, after moving, after a blast
node test/falls.mjs     # a tree with its trunk cut comes down and lies as cells
node test/read.mjs      # what devices have reported
node test/demo.mjs --out dir   # not a check: pictures of a house front being broken
```

Each drives the real page in the installed Chrome; none stubs anything. Times are this
machine's while it is busy: compare settings in turn (`node test/look.mjs --ab ...`).
