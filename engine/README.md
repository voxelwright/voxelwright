# The engine (#140)

Village's own engine: a world of 10 cm cells, drawn with raw WebGPU by marching rays, with
its core in Rust built as wasm. Synthetic data, this machine or the tailnet only. What it is,
what it costs and what is not built: `.agents/skills/cell-engine/SKILL.md`.

- `core/`: Rust. Cells, sectors as trees, the generated city, blasts, what stands, the bodies that come loose (they fall, turn, strike, break, and are cells again where they lie), and fire.
  One build for the page and (later) a world process.
- `page/`: the city, flown through. `main.ts` (the page), `world.ts` (boxes of sectors round
  the camera), `worker.ts` (makes sectors), `march.ts` (the ray marcher), `sun.ts` (the sun's shadows kept in maps), `edits.ts`,
  `mover.ts` (the worker that moves what has come loose and burns what burns), `told.ts` (what it says), `pieces.ts` (a body on its way), `crumbs.ts`, `puffs.ts` (fire, smoke and dust),
  `flight.ts` (the flight that measures a device), `people.ts` (everyone's figure, drawn in one call), `residents.ts` (who is out on the pavements, by rule), `presence.ts` (the others in a shared world, their names and what they say).
- `probe/`: a bare page that reports what a device can draw.
- `serve.mjs`: serves the pages' TypeScript with Node's type stripper and keeps what pages
  report in `~/.village/engine/reports.jsonl`. With `--world file` it also keeps one shared world.
- `world.mjs`: the shared world's own process, a thread behind the server that runs the core: it does what it is
  asked in order and says what happened. `page/link.ts` is a page's line to it.

## Run it

```sh
rustup target add wasm32-unknown-unknown   # once
cd engine && npm ci
npm run core        # builds core/ as wasm into page/core.wasm (a fresh checkout needs this)
npm run serve       # http://127.0.0.1:5740/city to fly; / runs the measuring flight first; /probe is the probe
```

Fly with WASD, the mouse after a click, Space and C for up and down, Shift for fast, the
wheel for speed. A click uses the tool picked on what is ahead; keys 1 to 7 or the bar pick it: a hammer, a charge, a big charge, a cannon, a torch, a cutter (a level cut 9 m across), a brick. F sets what is ahead alight whatever is picked. On a phone the left
thumb moves, the right thumb looks, and the red button uses the tool picked. H shows how many steps each
pixel took, L and M turn shadows and mirrors off, K traces every shadow instead of using the sun's maps.

A shared world: `node serve.mjs --world ~/.village/engine/world/some.log`, then `/city?shared=1` in as many
windows as you like (`&name=Ada` to be called something; Enter opens a line to say something). Everyone there sees
what anyone breaks, builds or burns, and each other as a figure with their name over it; the file keeps what was
done to the world across restarts, not who was there or what was said. Anything that can send a request can act in it too: `curl http://127.0.0.1:5740/world/`
says how: a body of its own that walks, turns, speaks and is told what is around it (the seat an agent lives in the
world by), what a cell is, what a look along a line meets, a blast, a fire, a thrown ball, an edit. Nobody is asked
who they are: whoever can reach the server can change that world, and can use any name, another's included.

Address options: `?grid=16,8,16` `?levels=9` `?pool=256` `?scale=0.5` `?at=x,y,z`
`?look=yaw,pitch` `?shadows=0` `?mirrors=0` `?maps=0` `?flat=1` `?fire=0` `?hour=18.1` (the time of day; the `[` and `]` keys move it half an hour) `?rain=1` (rain; the R key turns it on and off) `?heat=1` `?fly=0` `?seconds=40` `?people=0` (a town with nobody in it) `?name=Ada` (in a shared world).

To a phone on the tailnet: `tailscale serve --bg --https=10140 http://127.0.0.1:5740`, with
`node live.mjs` run after each merge so that the link serves main and not a working tree.

## Checks and tools

```sh
cd engine
npm run check                 # every check, about eight minutes: the core's tests, the types, and the real page in Chrome
node test/all.mjs --only falls,blast
node test/bench.mjs           # how fast the march is against test/baseline.json; says when the GPU was too busy to tell
node test/versus.mjs --out dir --fetch   # the board: our shots beside frames of the reference films
node test/versus.mjs --out dir --blind   # the same, and sheets for a judge with the sides unnamed (test/judge.md)
node test/aims.mjs            # every shot of the board still faces its thing
node test/clip.mjs --row rubble --out dir   # a row of the board filmed as the page shows it, with the gaps between frames
node test/look.mjs --out file.png --at x,y,z --look yaw,pitch   # one look, with settings
node test/read.mjs            # what devices have reported
node live.mjs                 # after a merge: the owner's link serves main from a checkout of its own
node test/shared.mjs --suite  # before a change to the solver or to how a shared world is carried: blast, falls, tools and water run in a shared world
```

`npm run check` runs `cargo test`, `tsc`, and these, each also runnable by itself:
`test/city.mjs` (the city made, looked at from five places), `test/blast.mjs` (glass breaks
further than a wall), `test/tools.mjs` (each tool on the bar does what it says), `test/aims.mjs` (the board's shots face their things), `test/shadows.mjs` (the sun's maps against traced shadows), `test/falls.mjs`
(a cut tree goes over and lies as cells), `test/shared.mjs` (two pages, a plain request and two seats in one world: all see the same, after a reload and a restart too; a seat walks, is stopped by a wall, is heard, is knocked down and gets up), `test/people.mjs` (the residents' rule: the same people whenever asked, nobody standing in anything, what a blast does to them, what they cost a frame), `test/flight.mjs` (the measuring flight, then a tree
cut and a house front broken; `--phone` as a phone), `test/probe.mjs`. Each drives the real page
in the installed Chrome; none stubs anything. They share one server and one browser and run
three at a time, so the times they print are not for quoting: `test/bench.mjs` measures.

The board (`test/rows.mjs`) is the bar: one row for each thing a viewer sees in the two films of
the review the owner linked, a frame of theirs and a repeatable shot of ours, stamped with the
frames a second and the picture size the page held by itself. A row's state changes only when
both have been looked at side by side by someone who did not make ours. The films live in
`~/.village/engine/ref/`, never in the repo.
