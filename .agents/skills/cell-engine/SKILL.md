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
  alone (nobody knows what holds it beyond), so a tower taller than the box does not come
  loose yet. Each other piece is taken out of the world and is a body.
- It is reach and counts of cells, not stress. A house whose front is blasted out stands on
  its side walls; its neighbours' walls do not hang it up, but its own may.
- `support::settle` (pieces dropped straight down in whole cells) is no longer what the page
  does; it stays as what the rule's own tests drive.

## What stands over its own foot (`support::topple`), and the yard

- Reach cannot say that a tank on two of its four legs falls: it is still reached. So each
  thing that stands free in the box (cells that touch, not the ground's, not reaching the
  box's sides or top) is asked, level by level from its foot up, where the weight of all at
  and above that level lies. If that is further outside the stretch the thing covers at that
  level than its material can lean (`kinds.rs` `leans`: steel 9 cells, wood 4, brick 1),
  everything from there up is loose and goes over as one body. A lamp holds its arm out; a
  chimney with half its foot gone does not stand.
- A first version measured the stretch of ground under the thing's lowest cells. Footings
  dug into the ground made that stretch whole whatever was blasted above it.
- A body is at rest only when slow and, if it is 1,500 cells or more, when its weight is
  over what it touches: a chimney starting to go over is slow, not still, and was being put
  back where it stood. Old and still moving is left to it for three times as long.
- The yard (`city.rs` `Block::Yard`, always the block at 1, 5 down the street from the start,
  and one block in seventeen): a water tower (wooden tank, steel legs, braces, a steel deck:
  a wooden deck tore under the tank by the rule's own counts), a brick chimney 18 m tall, an
  office of glass on a steel frame with concrete floors, a concrete canopy on six posts.
  Blasts take glass 2.75 radii out and steel a quarter, so the office is stripped to its
  frame by charges that leave the frame standing.
- The at-rest test now also fails on anything unheld that merely lies where it is and on
  anything out of balance, for the yard. In some houses a floor is, by the rule's counts,
  more than its joins carry; it lies there until something near is disturbed. Asking again
  after each tear so that loads find other paths (`AGAIN`) is written and off: some houses
  never settled in forty rounds.

## Tools (`page/main.ts`)

Keys 1 to 7 or the bar: hammer (a blast of 5 cells, no fire), charge (12), big charge (32),
cannon (a steel ball 80 cm across at 42 m/s, a body: what it strikes breaks by `crush`),
torch (lights what can burn within 4 cells), cutter (a level slot two cells thick and 9 m
across: what stood on it comes loose), brick (a ball of brick; with nothing under it, it
falls). The cutter and the brick are edits of the page's own, told to the solver with
`world_edit`, which is then asked what they left unheld. `test/tools.mjs` uses each.

## Bodies: what comes loose and moves (`core/src/bodies.rs`)

- A body is a small box of cells with a place, a turn, a speed and a spin. Lengths are cells,
  times seconds, a step 1/120 s, at most three steps a call: when the solver cannot keep up
  things move slower, they do not pile up work.
- It meets things at points: corners of its own cells, at most 160 and fewer for a small
  body (sharp corners kept first). A point in a solid cell is pushed the shortest way out
  through one face, to the nearest empty cell within three. Pushing towards all the empty
  neighbours at once made every stair tread a ramp and bodies crept down a street.
- Of the touches between a body and the world (or another body) only the furthest out each
  of fourteen ways and the deepest are kept; each stops what is closing and rubs against
  what slides, eight times over; overlap is eased apart without becoming speed.
- A body that has lain nearly still for 0.3 s is cells again, as it lies: one within about
  eight degrees of square is put down square, cell for cell; one askew is cut along the
  world's cells (about 2% fewer or more). The longer it has been about the less still it
  need be, and at eight seconds it is put down regardless. This is what keeps a ruin cheap:
  a heap is the world, and the next thing lands on it.
- A blast (`Bodies::blast`) makes the edit itself: the box round it is gathered before and
  after, and what it emptied comes out as lumps about five cells across with wandering
  edges, thrown from the middle (glass and the middle fifth are dust). Then what it left
  unheld is released. A body knocked harder than its material takes (`kinds.rs`
  `breaks_at`) is shared out among a few points in it and each share is a body.
- Bodies under 160 cells do not meet each other, only the world and big bodies. With all
  pairs tried, 700 lumps in one cloud took 111 ms a frame; without, 19 ms.
- The world as bodies meet it (`Ground`) is one bit a cell in sectors made on first touch.
  The solver's own edits (cells out, cells back) change those bits in place; anyone else's
  edit forgets the sectors it reaches. Every edit has one place in one order: a blast says
  how many of the solver's edits its maker had applied, and goes in after those.
- On the page: `mover.ts` is the worker (one instance of the core), `told.ts` reads its
  words, `pieces.ts` draws each body's faces with its turn, `main.ts` asks for a step each
  frame and never twice before an answer. Cells that bodies have become wait up to 180 ms
  to be put in the world together: applied one by one, a heap of 250 bodies had every
  sector near it made again 250 times and the town was not whole for 15 s.
- Measured on the M1 Pro (Chrome, picture at 0.55 of 2560 x 1440): five charges across a
  house front make 1,150 bodies of 29,000 cells, 627 at once; 60 frames a second with one
  gap of 33 ms in ten seconds; a blast worked out in 60 to 80 ms; the solver's longest
  frame 19 ms. Of a charge's lumps nine in ten lie still within 2.3 s, and 98% of their
  cells lie down. A cut tree goes over and lies in the street.
- A body of sixty cells or more that strikes something built hard enough (its weight times
  the speed it loses, over 8,000) breaks it (`crush`): the world there is emptied as by a
  blast of two to six cells, what was there comes out as lumps, and a box 6.4 m across is
  asked what that left unheld. One such place a step, eight a second at most. The ground
  itself (earth, rock, grass, sand, asphalt) is not broken by what lands on it.
- What rests on a cell must not be more than it can bear (`kinds.rs` `bears`: brick 6,000
  cells, glass 3,000, concrete 40,000, steel 400,000): a house does not stand on a post one
  cell thick. The untouched city still stands with this.
- A blast is asked about in a box sized to it: a hammer blow 6.4 m across, a charge 16 m.
- Measured natively, five charges of 4 m radius along a row of houses: 2,300 bodies in all,
  about 900 at once, a blast worked out in 220 to 290 ms, the longest step 62 ms. In the
  browser the same took the worker up to 196 ms for one answer, during which bodies stand
  still in the air; frames were not late (picture at 0.3 of full size, 261,000 cells down).
  `cargo test --release big_charges -- --ignored --nocapture` times it.
- Fire asks whether each neighbour can burn from a bit a cell kept beside the solid bit.
  Asking what each neighbour was made of, with twelve sectors kept whole, took 4.4 s for one
  answer once a fire had spread over more sectors than that.
- Not done: bodies cast no shadow; nothing bends; a body that leaves the sectors near the
  eye is still moved; a piece taller than the box round a blast is left standing, so a
  tower does not go over; the support rule and a big blast stall the solver for up to a
  fifth of a second.

## The look (`page/march.ts`: `LIGHT`, `SUNLIT`, `sky`, `openness`)

- One lighting model for the world and for bodies (`shade`, `tone`, exported as WGSL text):
  the sun where it reaches, the sky from above, what lit ground throws back from below, and
  a tone curve that keeps colour in bright things.
- Sky: a gradient, a sun, and clouds from four octaves of value noise on a level 1.5 km up,
  bright at their thin edges. The air between (`air`) is the sky without sun or cloud.
- Corners (`openness`): the four cells beside the one in front of a face are asked whether
  they are solid, and the face's four corners are weighed by where on it the point is. Asked
  only where a cell is over a pixel and a half wide. It costs 3 ms of a 20 ms frame at
  2560 x 1440 on the M1 Pro, and sharing the tree walk between the four did not make it
  cheaper: the cost is not in the reads.
- Shadows' edges: four texels of the sun's map weighed, at no measurable cost.
- A street on a hill is steps a cell high. A step's riser (a side face with air over its
  cell and ground under the cell before it) is lit as its tread, and asks about the sun from
  the middle of the cell's top; a one-cell step beside a tread does not darken it. So streets
  and pavements read as slopes. Before this every riser away from the sun was a black square.
- Bodies ask the same sun maps (`pieces.ts` binds the marcher's globals and maps), so they
  stand in the world's shadows; they cast none.
- Cost, paced at full size on the M1 Pro: street level with everything on went from 14.3 to
  20 ms (the page holds 60 frames a second there with the picture at about 0.65 of full
  size, from about 0.8). `?flat=1` turns the corners off.

## Fire, smoke and dust (`core/src/fire.rs`, `page/puffs.ts`)

- Wood, leaves, roofing and grass burn (`kinds.rs` `burns`: how long a cell lasts alight and
  how readily it catches). Ten times a second each burning cell may light each neighbour that
  can burn, the one above twice as readily; burnt out, leaves and roofing are gone, grass is
  bare earth, wood is gone or (two in five) char that still stands. Whole numbers and hashes.
- Fire lives in the solver's instance: it reads the same standing world and changes it by the
  same edits, and once a second asks the support rule what the fire left unheld, which falls.
  A blast lights about one burnable cell in twelve round it (`?fire=0` stops that, for checks). `engine.ignite()` (key F) lights
  what is ahead.
- The page is told how many cells burn and where some 260 of them are, and draws flames and
  smoke there. Puffs are lumps facing the eye, about two cells a lump so their edges are in
  steps; hot ones add their light and cool to smoke, which covers, swells and rises. They are
  sorted far to near each frame (3,072 at most) and are not lit by the sun's maps.
- A blast shows a flash, a ball of fire, the smoke it leaves; a body coming to rest throws up
  dust of its own colour.
- Measured on the M1 Pro: a street tree set alight burns away in about 8 s with no frame gap
  over 25 ms; asking what the fire left unheld took the worker 85 ms once.
- Not done: fire gives no light to what is near it; smoke casts no shadow and is not blown
  round things; a body that is alight goes out; water does not put fire out.

## What surfaces are made as (`page/march.ts` `PAINT`, shared with `pieces.ts`)

- Walls looked flat because they were too bright to show anything. The palette's pastels were
  0.94 to 0.97 bright, so a sunlit wall came out of `tone()` at the top of its curve, where a
  surface 15% darker shows 2% darker. Worked out by hand from `shade()` and `tone()` before any
  pattern was drawn. The palette is now no brighter than white paint (values times 0.84), plaster
  is darker, and the exposure in `tone()` is 0.43 (was 0.6).
- `paint(kind, cell, n, fine)` is one WGSL function for the world and for bodies: bricks two
  cells long in courses, each its own shade; boards two cells high across a painted wall, the
  lower cell in the lap's shade; planks; concrete slabs sixteen cells across with joints; rows of
  shingles; patches on road, earth and grass. Nothing is finer than a cell.
- It is keyed on the finest cell (`hit.cell * (1 << level)`) and drawn only at the finest level
  and on a face; a body's cells are keyed on where they were when it came loose, so a heap
  carries its wall's boards.
- Cost: the bench's places are within 3% of before.

## Fire and smoke are not cells (`page/puffs.ts`)

A puff was first drawn in lumps two cells across with a stepped edge, "as everything here is made
of cells". Beside the reference a blind judge called them low-resolution sprites, and they were.
A puff is now a soft ball whose edge is eaten by two sizes of billow that drift up it as it ages,
lit as a ball from the sun's side, with fire's heart brighter than its edge. Same count of puffs,
same cost. Things are made of cells; smoke is not a thing.

## The last pass (`page/glow.ts`)

The picture is stretched to the screen by `glow`, not the probe's `stretch`: what is brighter than
0.8 in it is taken at a quarter size, spread along x and along y, and added back at 0.85, and
the picture's corners are a little darker. Three quarter-size passes and the stretch; the bench
did not move. The picture is a new texture whenever its size changes, so what the glow keeps for
it is thrown away and made again then. Corners in the world are darker too (`open` squared), the
sky's fill is a fifth less, and a blast leaves a thicker, darker column of smoke.

## Coming down into heaps (#160, `bodies.rs`: `sitting`, `lumps`; `page/sun.ts`; `page/world.ts`)

Counted first (`cargo test --release where_the_stuff_goes -- --ignored --nocapture`, `SPARKS=1`
for fire too): where the cells go when the board's rubble and ruin rows are acted. What it found,
and what was done:

- A big piece the reach rule lets go (two storeys of a house, 60,000 cells) was one stiff body,
  stopped on the walls either side of the hole and was put back where it was. So a big body
  mostly of masonry that has stopped is taken as chunks 2.4 m across (`sitting`): a chunk with
  half its underside on the world, or on a chunk that stays, stays; the rest are bodies again
  and come down. Breaking the piece when it comes loose was tried first and is wrong: a chimney
  must go over whole.
- A charge of 40 emptied more than there could be bodies for; what had no body was nothing.
  Lumps grow with the blast (5 cells across for a charge of 16, 13 for one of 40) and are not
  tried against each other.
- Ruin row, sparks off: cells that end somewhere new 17,000 before, 139,000 after. 192,000 built
  cells are still lost (the blasts' middles, glass, what no body was made for).
- A landing's dent asks what it left unheld in a box 4.8 m a side and 9.6 m tall, not 6.4 by
  22.4: the asking was most of the solver's time while a house came down.
- The solver fills a sector only from the edits whose box reaches it, and rows by height.

What a burning street cost, each found by switching parts of a frame off (`engine.off`,
`engine.spent`, `engine.cpuMs`):

- `world.update` 20 to 40 ms a frame: every sector made again was told every edit. Edits are
  kept by column, and a column's edits of rows are merged (core `merge_rows`, a test holds every
  coarseness to the same cells). 3 ms after.
- The march 33 ms at half size: an edit threw away the sun's tiles on its lines, so the shader
  traced every shadow there, and eight tiles a frame were drawn again. A spoiled tile is now used
  until drawn again, two a frame. 12.6 ms after.
- A tenth of a second when a house's worth of bodies lay down together: the page sorted their
  rows. The core does it.

Still slow: a charge of 40 is worked out in 0.25 s native and 0.65 s in the page, and the solver
falls behind real time with 1,800 bodies (frames are held; things move late and slowly).

Filmed (`node test/clip.mjs --row ruin --seconds 16`, M1 Pro, November 12, five charges of 40 with
sparks): 960 frames in 16.0 s, no gap over 16.7 ms, 2,684 bodies in all, 1,883 at once, the
picture at 0.40 of full size. The board's ruin row has since used the big charge tool's 32.

## A skip must not go past where the ray leaves its box (`page/march.ts` `trace`)

Seen from 30 m up, the yard had a grid of earth-coloured pits. The generator and the trees were
right (`cargo test --release bare_earth -- --ignored --nocapture`), and so were the roofs. A ray
over the roofs of a column of sectors crosses the column in one step; with the finest box all
above the ground, the ray leaves that box through its floor before the column's far side, and
the step carried it on, so it began in the coarser copy already under the ground. The step is now
no longer than to where the ray leaves the box. `test/city.mjs` looks down on the yard from 30
and 40 m and fails on bare earth. The honest path costs: `roofs` and `high` in the bench are 11
to 14% slower, and the baseline is theirs now. Found by switching each skip off in turn for the
pick; reasoning about the shader alone had cleared it three times.

## Things on the street (`core/src/city.rs`; `support::adrift`)

- Parked cars at both kerbs of every street (a painted steel body, a hollow cabin of glass, four
  wheels that each reach down to the street under them, lamps), a hydrant, mailbox or bin now and
  then, a stop sign at two corners of each crossing, containers stacked in the yard. Houses at a
  block's ends and one in seven others keep a shop: a window, a striped awning, and a board that
  says what it sells in letters five cells by seven (`letter`, `SHOPS`), mirrored on fronts that
  are seen with x to the left.
- The balance rule called every car on a slope out of balance: its lowest level is one wheel.
  Where a thing stands on the ground higher up as well, that footing now counts in the stretch
  below it.
- The rule of reach knows no difference between standing on the ground and being part of it, so
  a blast moved nothing it did not break. `adrift`: a thing mostly of steel and glass, of 20,000
  cells or fewer, that touches nothing but the ground and is within two radii of a blast comes
  loose whole and is thrown. Trees and masonry are left: they are rooted.
- A sign board must stand out past a bay window over it, and no street tree stands before a
  shop, or the board cuts its crown and a clump of leaves is left hanging (the at-rest test).
- Steel mirrors nothing now. Parked cars each asking what was across from them cost 9 ms at the
  street. The street things still cost 16% more rays at street level and the shop and car glass
  3 ms of mirrors: the baseline is theirs.

## From 100 m up the town was not drawn (`trace`, the jump to a box's roofs)

A box with nothing in it has its roofs at the bottom of everything (-1e9). A ray coming down in
it was sent to those roofs, which put it past every box, and it met nothing: with the eye more
than about 100 m over the ground the finest box is empty, and the whole town was the colour of
the haze. The jump is now no further than to where the ray leaves the box. It had been so since
the roofs were first skipped; the bench's `far` place (2.8 ms) and half of `high` had been timing
an empty picture, and the board's `whole` row was that picture. `test/city.mjs` now fails when a
look down from its high places meets nothing. Seen whole, the town costs 37 to 43 ms at full size
from those places (60 frames a second at 0.4): that is the next thing to make cheaper.

Both this and the pits (above) are one rule: nothing that moves a ray along may take it past
`leaveAt`.

`test/skips.mjs` (in `npm run check`) holds the rule: 240 looks from 20 to 800 m up, level to
straight down, are asked with the skips and with `PLAIN` (flag 64: no roof skips and no step
over 4 x 4 x 4 empty sectors), and must meet the same thing at the same distance. With either
old fault put back it fails (193 and 29 looks). The step over 4 x 4 x 4 sectors is counted from
the box's own slots and could reach outside the box too; it is held to `leaveAt` as well.

What the empty picture had been telling us: the Mac flight's picture size read 1 in mid flight
and now reads 0.45 to 0.65; the phone-shaped flight (the Mac in a phone's settings) now drops to
53 to 58 frames a second over its high legs; and the iPhone's "60 frames a second for 39 s at
full size" (November 11) held only where the town was in view, near the ground. What a real
phone holds from high up is not known.

Filmed November 13 (`clip`, sparks on): ruin, six charges of 32, 960 frames in 16 s, no gap over
16.7 ms, 2,396 bodies, 1,230 at once; rubble, three charges of 32, 720 frames in 12 s, no gap
over 16.7 ms, 1,780 bodies, 923 at once.

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

`npm run check` in `engine/` runs twelve checks in four to six minutes (199 to 333 s on November 12 and 13): `cargo test`, `tsc`, and
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
- A row says what its shot must face (`near`: a material within so many metres) and what its
  act must have done by the time of the picture (`falls`, `inAir`, `burns`). `versus` and `clip`
  refuse a row that fails either, and `test/aims.mjs` (in `npm run check`) stands at every shot
  and asks what is ahead, breaking nothing. Why: the yard rule put a yard across the street
  from the start, and for a whole merge four shots charged a glass tower 90 m off, the topple
  shot was taken before the tower leaned, and `versus` still printed "ok". The flight's charges
  had moved with them, so it reports how far off each struck and checks that too.
- A picture of things in the air is taken on a measure, not a count of milliseconds:
  `engine.leaning` (degrees over of the furthest-gone big body), `engine.bodies`.
- Stand shots at named things (`YARD`, `FRONT` in `rows.mjs`), not at offsets whose meaning
  the town's rules can change.
- Their frame for a row is the film's best showing of that thing: tile a frame a second of each
  film and pick, and look at the pick. Three of the first picks were of the wrong moment.
- A row's state moves to level or ahead only after a judge who did not make it has seen both
  pictures with the sides unnamed: `versus --blind` draws the sheets, `test/judge.md` is what to
  ask, and the dispatch is logged. A row where either picture does not show the thing is void,
  not scored. The first pass (November 12) voided seven rows and so found all of the above.
- `node live.mjs` after each merge: the owner's link serves a checkout of main.

## Not built

- When the eye moves far between two frames (30 m, as when frames are slow and it is flown
  fast), mapped and traced shadows differ in 14.5% of pixels until the maps catch up, and
  the fall-back to a traced shadow does not cover it: tiles that have wrapped round are
  still marked drawn. `test/shadows.mjs` shows it whenever it runs beside another check.
- Mapped shadows have edges in steps a cell wide and differ from traced ones in about 1.4%
  of a street view's pixels. Crumbs and anything else that moves cast none. A map's texel
  holds a distance as a 32-bit float from the world's zero: fine across a city, too coarse
  a thousand kilometres out.
- What stands is reach and counts of cells, not stress. Nothing bends or flows. A tower
  does not go over.
- Nothing is shared, kept or seen by agents: one page, its own edits, gone on reload.
- No walking, only flying. No real San Francisco: the city is made up.
- The look has no texture on materials, no light from lamps or windows, no night, no smoke.
  Bodies and crumbs cast no shadow.
