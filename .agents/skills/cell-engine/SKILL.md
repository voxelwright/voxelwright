---
name: cell-engine
description: How Village's own engine (#140) holds, makes, draws and breaks a world of 10 cm cells, with measured costs, the lessons paid for, and what is not built. Load before changing engine/core's tree, city or blast, engine/page's world boxes, marcher or flight, or before claiming a frame rate.
---

# Village's engine of cells

Begun November 11, 2026 (#140) on the owner's direction: an engine of our own, no loyalty to
three.js or Jolt, 60 fps on an iPhone and the M1 Pro at the scale of a city. It lives in
`engine/`. Tools it stands on have their own skills: `rust-wasm-core`, `raw-webgpu`. What the
earlier street of cells learned is in `voxel-world`.

## How the world is held

- A cell is 10 cm and has a kind: two bytes, a material and a colour from one palette of 256
  (`core/src/kinds.rs`; the page's copy of the colours is `page/march.ts` `palette`).
- A sector is 64 cells a side, kept as a tree three nodes deep (`core/src/tree.rs`). A node
  is four words: a 64-bit mask of which of its 4 x 4 x 4 parts hold anything, where its
  children are, its kind, and the tight box round what it holds. A cube that is all one kind
  is one node. The same words are what the GPU marches and what will be collided with, kept
  and sent.
- The city is rules (`core/src/city.rs`): any sector at any coarseness comes out the same on
  every machine, so nothing is stored until somebody changes it. Copies up to 0.8 m cells are
  made from shapes (walls, windows, trees); coarser ones from heights and colours. A shape
  says how it meets cells coarser than its detail (`scratch.rs` `Meet`): a wall touches, trim
  goes by a cell's middle, hollowing stays within.
- An edit is a record: a ball, a blast, or rows of cells set or emptied (a piece taken from
  where it was, put where it landed). A sector as it stands is the rules, then the edits that
  reach it, in order. Edits travel as whole numbers (`page/edits.ts`, the core's `read_edits`),
  each with the box it can change.

## How it is drawn

- Round the camera lie boxes of sectors, each of cells twice as big covering twice as far
  (`page/world.ts`): 16 x 8 x 16 sectors and nine boxes on a desktop (13 km), 8 x 8 x 8 and
  eight on a phone. A sector's slot is its place wrapped round the box, so moving makes and
  drops sectors at the edges only. Every box is whole: it also holds what the finer boxes
  inside it hold, coarser.
- Workers make sectors a column at a time, nearest first, the far boxes a little sooner. The
  shader is told only the part of each box in which every sector is made, so the world comes
  in coarse and sharpens, with no holes.
- One shader sends a ray a pixel through the boxes and trees (`page/march.ts` `trace`), a
  second towards the sun, a third off glass and water. A ray never goes back to a finer box.
- The picture is marched at fewer pixels when the GPU is slow and stretched to the screen
  (`main.ts` `steer`), so frames hold.

## What made rays affordable (in the order found)

1. Keep the nodes the ray is inside from step to step; only reload what the next cell is
   outside of (the highest bit in which two cells differ says how much).
2. A roof for each box, each column of sectors and each 4 x 4 columns: a ray over the roofs
   crosses a column in a step, and one coming down skips to the roofs. This took a view from
   120 m from 80 ms to 7.
3. The tight box round each node's contents: a city is flat things, so a ray passing over a
   roof or along a wall skips the node. This took main rays at roof height from 39 ms to 9.
4. A ray towards the sun widens as it goes and takes boxes two at a time once out of its own.
5. The sun's shadows kept in maps (`page/sun.ts`): for each box, a 1024 x 1024 map looking
   along the sun whose texel is as wide as the box's cell and keeps its place in the world.
   A texel holds how far towards the sun the last solid thing on its line is; a point at
   least that far is lit. The line is followed outwards from where it enters the box, by a
   ray that goes through what it meets (`trace` with `through`), so it sees everything
   up-sun in the coarser boxes too. Eight tiles of 64 x 64 are drawn a frame, finest and
   nearest first; an edit spoils the tiles its sun lines cross once its sectors are made
   again; when a box moves its tiles are drawn again as there is room and used until then
   (a line was followed from where it came into the box as the box then stood); the oldest
   tile is redrawn when there is room. Where no tile is drawn the shader traces as before.
   This took shadows at street level from about 15 ms to 0.3 ms.

## Measured (M1 Pro, Chrome, 2560 x 1440, paced, standing still, sun maps drawn, GPU otherwise quiet)

| Place | Main rays | With shadows | With mirrors too | Every shadow traced |
|---|---|---|---|---|
| Eye 1.8 m over the road | 10.9 ms | 11.3 ms | 14.4 ms | 29.9 ms |
| House fronts | 11.0 ms | 11.5 ms | 14.4 ms | 31.6 ms |
| Among the roofs | 9.9 ms | 10.2 ms | 14.0 ms | 29.9 ms |
| 130 m up | 4.7 ms | 4.9 ms | 6.6 ms | 7.3 ms |
| 730 m up | 2.6 ms | 2.6 ms | 2.6 ms | 2.6 ms |

Showing frames to a screen is dearer than the paced figure on this shared GPU: by itself the
page held 60 fps at street level at half to three quarters of full size each way.

The town is made in 2.4 to 7 s (18,432 sectors, 173 MB of trees); on the phone's settings in
0.6 s (4,096 sectors, 42 MB). Safari 27.2 on the Mac agrees within a fifth.

## On a real iPhone (November 11, 2026)

iOS 27.0, Chrome (WebKit underneath), a screen 440 points wide held upright, the phone's own
settings: 8 x 8 x 8 sectors, eight boxes, 128 MB. Paced at 660 x 1133, sun maps drawn:

| Place | Main rays | With shadows | With mirrors too | Every shadow traced |
|---|---|---|---|---|
| Eye 1.8 m over the road | 2.5 ms | 2.5 ms | 2.8 ms | 4.5 ms |
| House fronts | 1.8 ms | 1.9 ms | 2.3 ms | 5.2 ms |
| Among the roofs | 1.9 ms | 2.0 ms | 2.4 ms | 4.0 ms |
| 130 m up | 0.9 ms | 0.9 ms | 1.1 ms | 1.1 ms |

That is 3.7 ms a megapixel at street level with everything on: about 11 ms at its full
1320 x 2265. Shown to the screen it held 60 frames a second for a 39 s flight at full size
(p95 gap 16.8 to 17.6 ms). The town was made in 1.2 s on two workers (0.35 ms a sector).
Its limits match Safari on the Mac but for 1 GB buffers; it has `timestamp-query`, shared
memory, wasm SIMD and threads, and WebTransport.

Two later runs the same evening, with falling in the build: the flight again at 60 frames a
second at full size, upright (1320 x 2265) and held sideways (2478 x 1080). At the end of the
sideways run the page cut a tree and put five charges across a house front: the tree's 7,805
cells were worked out in 349 ms (242 ms on the M1 Pro), a charge in about 90 ms, the town
whole again in under a second each time, and no gap between frames longer than 17.7 ms.

Not measured there: more than 39 s (heat), the desk's bigger world. Its GPU clock is not to be believed (0.01 to 10 ms for the same work), so the
picture's size follows late frames there, not the clock. A wake lock asked for before any
touch was refused.

## Breaking

- A blast empties each cell as far out as its material gives (`kinds.rs` `gives`): glass to
  2.75 radii, plaster and wood a little past one, concrete 0.7, steel a quarter. Edges are
  left in lumps where the material crumbles. Whole numbers, seeded from the blast.
- The page asks the marcher what is ahead (`march.pick`: one pixel, read back), records the
  blast, and `world.edit` marks every sector it reaches, in every box, to be made again; the
  old one is shown until then.

## What stands and what falls (`core/src/support.rs`)

- After a blast the core gathers a box round it (16 m across, 22 m tall, most of it above
  the blast) from the rules and every edit, and asks which cells the ground still reaches.
  Resting on a held cell costs nothing, a cell sideways costs one, a cell hung from above
  two; a cell further than its material spans is not held (`kinds.rs` `spans`: steel 150,
  concrete 90, wood 50, plaster and brick 30, glass 20, earth 6).
- Reach alone lets a wall hang by a thread, so each sideways or hanging join also carries
  only so many cells (`carries`), counted along the paths the search found; a join over its
  limit tears and all it carried is loose. Leaves join only to leaves, and rest on anything.
- Loose cells that touch are a piece. A piece that reaches the box's sides or top is left
  alone (nobody knows what holds it beyond). The rest fall straight down in whole cells, the
  lowest first, and are cells of the world again where they land. This is repeated, up to
  eight times, until nothing more falls (a heap took six). Cells are conserved.
- It is reach and a count of cells, not weight or stress: a one-cell post under a house
  still holds it, and a row of houses holds up a house whose ground floor is gone. A cut
  tree drops onto its stump and stands there. Nothing turns, tumbles or breaks on landing.
- On the page (`settler.ts`, `pieces.ts`, `main.ts`): a worker settles; each piece is taken
  out of the world when it starts to fall, drawn as faces merged along rows in the core
  (sent to the GPU once, moved by a uniform), and put back when it lands. Before the next
  blast everything still in the air lands at once, so the world is as the core said.
- Far copies in which houses are solid take a fallen piece as its filled outline, row by
  row, or its shell would leave the solid inside standing.
- Measured: a tree of 7,805 cells worked out in 0.24 s on the Mac; a house front in 0.3 s.
  The worker's memory reaches 100 MB.

## Lessons paid for

- A view "at street level" that was inside the ground timed fast and was reported as
  typical. Look at the picture a number came from.
- Step counts do not tell cost. A step that loads tree nodes costs about ten times a step
  through air; a count of steps looked fine while shadows took three quarters of the frame.
- Capping a ray's steps to find where its cost is (0, 2, 6, 12, 24) found the cliff in ten
  minutes after an hour of guessing.
- A ray that skims a height it is tested against can be sent back to it for ever by the last
  digit of a sum: skip to a plane once, then stop testing.
- Timing on this Mac doubles when another thread draws. See `raw-webgpu`.
- A "nothing was met" answer must not be a distance: a sun line starts level with the eye,
  so what it last left is often behind its start, and reading a negative distance as
  nothing lost every shadow cast from behind the eye.
- The generator must not make what the support rule will not hold. Crowns that ate into
  house fronts were held up by the walls they touched, then by resting on them; lamp heads
  hung past their span. The check that the untouched city is at rest found each. Tree crowns
  now fill only air and are cut back from house fronts.
- The first tree tested was 30 m off and fell; the nearest one did not. Pick the awkward
  case for a check, not the first that works.
- The page's parts are set up in order and the frame loop starts before the flight awaits:
  anything the loop reads must be declared before the first await after it.

## Checks, and the bar

`npm run check` in `engine/` runs everything in about three minutes: `cargo test`, `tsc`, and
the real page in the installed Chrome with WebGPU (`test/city.mjs`, `blast.mjs`, `shadows.mjs`,
`falls.mjs`, `flight.mjs`, `flight.mjs --phone`, `probe.mjs`), sharing one server and one
browser through `test/kit.mjs`. None stubs anything. `cargo test` holds the support rule to:
the untouched city at rest in every sort of block, a panel hung by one cell falling and one
joined along its edge standing, what reaches the box's top left alone, and a blasted house
front coming down, staying down and losing no cell.

- `test/bench.mjs` paces five places three ways against `test/baseline.json` and fails on a
  tenth slower. It also paces a fixed piece of work that is none of the engine's (1.4 ms on the
  M1 Pro when quiet); when that is a third slower the GPU is busy and it says nothing.
- `test/versus.mjs` draws the board: `test/rows.mjs` has one row for each thing a viewer sees
  in the reference's two films, a frame of theirs and a shot of ours, taken at the picture size
  the page holds 60 frames a second at and stamped with it. A milestone picture forced to full
  size says nothing about what the owner will see.
- `test/clip.mjs` films a row in real time (the canvas's own stream) and prints every gap
  between frames over 25 ms and when. Turning and tumbling cannot be judged from a still.
- A row's state moves to level or ahead only after a judge who did not make it has seen both
  sheets; log that dispatch.
- `node live.mjs` after each merge: the owner's link serves a checkout of main.

## Not built

- Mapped shadows have edges in steps a cell wide and differ from traced ones in about 1.4%
  of a street view's pixels. Crumbs and anything else that moves cast none. A map's texel
  holds a distance as a 32-bit float from the world's zero: fine across a city, too coarse
  a thousand kilometres out.
- Nothing turns, tumbles or breaks when it lands: falling is straight down in whole cells.
  No weight or stress. Nothing bends, burns or flows. No bodies that move about.
- Nothing is shared, kept or seen by agents: one page, its own edits, gone on reload.
- No walking, only flying. No real San Francisco: the city is made up.
- The look is plain: no occlusion in corners, no clouds, hard shadow edges, 10 cm treads on
  hills.
