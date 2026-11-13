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

Filmed November 12 (`clip`, sparks on): ruin, six charges of 32, 960 frames in 16 s, no gap over
16.7 ms, 2,396 bodies, 1,230 at once; rubble, three charges of 32, 720 frames in 12 s, no gap
over 16.7 ms, 1,780 bodies, 923 at once.

## What the far view costs (`fs`, mirrors)

Measured from the bench's `high` and `far` places and across the lake, at half size: how wide a
thing must be to be drawn as itself (`detail` 1 to 3) changes nothing; the steps a ray takes are
few (`?heat=1`); rays cost a quarter more a pixel than at the street. What cost was mirrors, a
third of the picture: from high up every window in the town is a mirror a pixel wide, each
asking the world what is across from it. Now glass asks only where a pane is two pixels or more
and water within 600 m; further off they show the sky, a fifth darker. All on: `far` 42.8 to
36.7 ms, `high` 37.5 to 34.7, the street 32.3 to 30.2; the board's far view holds 0.55 of full
size, not 0.40.

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
- A page by itself is still its own world, gone on reload. A shared one is kept (see the shared world, below).
- No walking, only flying. No real San Francisco: the city and the land round it are made up.
- Bodies and crumbs cast no shadow. Fire lights nothing round it.
- The hour is set, it does not pass. At night a window is lit by a rule of where it is, and a
  lamp's pool of light by where the town's rule stands lamps: a house brought down leaves no
  lit windows, but a lamp knocked down still lights the crossing.

## The hour (November 12)

- `?hour=`, the `[` and `]` keys or `engine.hour` set the time of day (`main.ts` `setHour`): the
  sun's place, `day` (1 by day, 0 at night) and `low` (1 with the sun at the horizon). The
  sun's maps are spoiled and drawn again for the new sun (`sun.ts` `turn`); `test/hours.mjs`
  checks they match traced shadows afterwards, that night is dark with windows lit, and that
  the day comes back unchanged.
- Cost lesson: the first version mixed day, dusk and night colours in the shader from two
  uniforms, and the day got 2 ms dearer a frame at full size (10 to 16%), though the picture
  by day was the same. A uniform is not a constant: every pixel did the mixing. The colours
  are now worked out once when the hour is set (`march.ts` `colours`) and handed over at the
  end of `Globals`; what only the night or a low sun needs sits behind a branch on `g.day` or
  `g.low`. Day costs what it did; night costs no more than day.
- The same bench run found `sky()` asked for every pixel and thrown away where something was
  hit: it is now asked only where nothing is.
- `test/kit.mjs` `city()` fails at once when the page fails as it starts (a shader that does not
  compile). Before, it waited 90 s, and a scratch script piped through `grep` hung for ever
  because the page server it had started kept the pipe open: send output to a file.

## Water seen from the shore (November 12)

- The still sea is a level plane at the world's zero, not cells (`city.rs` `SEA`, `march.ts`
  `trace`). This is the one exception to "everything is cells"; `WATER` stays a material for
  water that moves. As cells the sea had two faults. A coarse cell of it stood 2^k cells high,
  a step up at each box's edge, seen from the shore as dark lines across the water. And a look
  through it took small steps: from under water a picture cost three times one through air,
  and a shadow ray as much as the look. Now the floor is in the sun's maps, what falls in
  sinks, and a look under water crosses open space.
- The sea is decided once after the march, not in it: a ray that came down from over the top
  and met nothing before it (or went out of the last box under it) met the sea. Two cheaper-
  looking ways were measured and thrown out: the same test at every pass inside the march,
  and one more number kept there with one more `min` a box. Each made every look 10 to 17%
  dearer, sea in it or not: the march's loop does not bear another live value. The cost of
  asking afterwards is that a ray over deep water walks on down to the floor: the `far`
  bench row is 8% dearer (38.7 against 35.8 ms).
- A coarse column under the sea keeps its ground a cell under the top, however shallow the
  water, so far shallows stay water.
- `test/sea.mjs`: looks down over the lake meet the top at the eye's height over it, also on
  the last three cells of water before the shore, with skips and without; from under it no
  look meets it.
- A wave tilted towards the eye sends the mirrored look down into the water it came off: dark
  specks all over the middle distance. The look is kept at or above level for water.
- Ripples are smooth noise and fade out by 60 m; further off there are many waves to a pixel.
  The sun's path (and the moon's) is added as thrown-back light, not through the mirror's
  mix, so it reaches from the far shore to the near one.
- `engine.ground(x, z)` is the sea's floor where there is sea: a stand worked out from it over
  water is under water. Stand on land.
- Lamp pools are worked out from the block rule and fell on the sea too; water takes none.

## Under the sea (November 12)

- `main.ts` tells the marcher each frame whether the eye is under the sea (`march.under`: under
  zero, where the ground by itself lies under zero too, so not in a pit dug on land). The
  shader then draws `deep()`: what is met is lit as usual (the floor and the weed are in the
  sun's maps), times a moving net of light, less its red with depth and distance, fading to
  the water's own colour by about 80 m; looking up, the sky through a round window; ten
  samples along the look for shafts of light. Nothing over the top is seen from under it, and a
  pick from under it stops there too.
- `city.rs` `stamp_sea_floor`: the floor is cut into patches 3.2 m square; ribbon weed grows in
  groves and eelgrass in meadows (two slow noises), with bare sand and a few boulders between.
  All of it stands in the sand: `what_grows_on_the_sea_floor_is_at_rest` (support.rs). Boulders
  are whole balls; a ragged one left single cells hanging.
- Cost at the under row's stand, 0.92 megapixels: 11 to 13 ms with everything on (the street
  is about 8 ms for as many pixels). A grove is as dear to look through as tree crowns.
- Weed is `LEAVES`, so it would burn. Nothing sways.
- A board row may say where in the picture its thing is (`aim`), when the middle is not it.

## Rain, lit signs and street lamps (November 12)

- `?rain=1`, the R key or `engine.rain` (0 to 1): the sun goes behind cloud, sky and fill go
  grey, lights come on (`weather.z`), road and paving mirror (a film everywhere, puddles by a
  slow noise), and streaks fall. The streaks are a pass of their own in `glow.ts`, added over
  the finished picture only while it rains.
- A shop's letters are `LAMP` in a pale tint. Lamp in any colour but a street lamp's own
  (palette 46) is a sign: white by day, and lit in its colour made strong when the lights are
  on. A shop's window (glass of palette 146) is always lit then.
- Lamps stand down both streets of a block now, not only at the crossing (`city.rs`), and
  the page lights the ground under each from the same nine places (`march.ts`, in `lit`).
  The two lists must agree: there is no check that they do.
- The dry day must not pay for the weather, and the bench says when it does. What cost 8 to
  10% on every row, each found by putting 0.0 in place of the uniform and benching again:
  the streaks behind `if (rain > 0)` in the marcher's shader, and any read of `g.weather` in
  `sky()` (the clouds' cover, the stars' brightness), even in a branch the day never takes.
  Reads of it in `lit()` and in the mirror branch cost nothing. So in rain the clouds are not
  thicker and the stars still show: both are wrong, and both want a way that is free by day.

## The land round the town (November 12)

- `core/src/land.rs` owns `ground()` and where things are. Within 3 km of the start (`HOME`)
  the land is the town's own and no cell of it may move: `city.rs`
  `the_town_is_cell_for_cell_what_it_was` sums sectors there at every coarseness. If the town
  is meant to change, take the board's pictures and the bench's baseline again and set the
  sum to what the failure prints. By 4 km the town has given way to open country (`open`):
  mountains to the north (`peaks`, towards -z, ridged noise to 3.6 km high), a dry plain to
  the east (`dry`) with the road out of town along the start's own street, grass between.
- `city.rs`: a block past the edge is `Block::Open` (no streets). `country()` says what
  covers a column: road, snow from about 650 m on all but the steepest faces, rock where it
  is steep, sand on the plain, darker grass under the woods. `stamp_country` puts one thing
  in each 4.8 m patch: pines in the woods, bushes and stones on the plain, a tree now and
  then in the grass; poles stand along the road.
- Things in open country must stand by the support rule (`open_country_is_at_rest`). The
  first pines did not: tiers 5 m across on a 2 x 2 trunk are more than leaves hold, and a
  blast in the woods would have dropped the forest. Tiers are eight-sided and at most 2.7 m
  across now, on a 3 x 3 trunk. The check looks only at level places: its box is cut level,
  and on a slope that cuts trees from the ground they stand in.
- The air thins with height (`march.ts` `air`): a third as thick 1.3 km up. Without it the
  mountains were a pale wall from 4 km. It costs 1 to 3% on every row.
- A box has a roof for each quarter round the eye's own sector (`Level.roofs`, `world.ts`
  `roofs`): a look from the eye stays in one quarter and is not held up by mountains
  behind it. It took the view from 130 m up from 19.4 steps a pixel to 15.8. A skyline in
  sixteen directions for each box was tried too and changed nothing: the extra steps were
  not looks at the sky.
- `engine.steps(flags)` counts the steps a picture's rays take (mean and most). Time on the
  GPU is steps times what a step costs: it says which of the two a change moved, and it does
  not care whether another thread is drawing.
- What the land costs the town's own views, by the bench with the GPU quiet, against main
  on the same day (fronts row, rays only: main 15.3 ms): the land with main's shader 16.7;
  no land with today's shader 16.7; both 16.9. So the far boxes with mountains in them cost a
  town view about 9%, the quarter roofs take most of that back, and their own code costs
  about as much again. Taking the height haze out, the quarter-roof line out, or the four
  numbers out of `Level` each changed nothing by itself. The view over the roofs is 36 to
  48% dearer because it looks north, at hills and mountains where there was a lake and flat
  town; from 130 m up 12 to 20%; from 730 m up 8% cheaper. The baseline is re-taken.
- The steps a picture takes must be counted at the size the page draws at: what is drawn as
  one block goes by how big a pixel is. Counted small they were the same with the land and
  without; that proved nothing.
- The lamps' light is worked out from the block rule, and it fell on the open plain, the
  mountains and the lake's floor too: a grid of lit patches at night, found only by taking a
  night picture of the land. It is kept to town blocks above the sea now, and `test/hours.mjs`
  looks at the plain at night. After a change to what the land is, look at it at night.
- `test/skips.mjs` asks rising looks too, and the reference (PLAIN) no longer uses the rising
  clamp at a box's roof, so a wrong roof shows: with one quarter's roof set low 109 of 504
  looks fail.

## Light and colour after the third judge (November 12)

- The judge's first finding was that our light is flat and our colour weak. What was changed,
  all of it constants or work outside the marcher, so the bench did not move (within 2%):
  the sun is stronger against the sky's fill (3.6 against 3.1, fill at four fifths); the last
  pass (`glow.ts` `last`) adds a quarter more colour and an S-curve after the tone curve; the
  glow spreads nearly twice as far; a lamp glows at 3.2 times its colour, not 6, so it stays
  warm and does not clip to white; at dusk the sky towards the sun and the clouds on that
  side are stronger and the clouds away from it darker; the sun's path on water is brighter;
  shafts under water show whichever way the eye looks.
- Snow is `SAND` in white (it lies even; `ROCK` in white was speckled), and steepness is taken
  over 4.8 m to either side, so snow and rock lie in sheets and faces, not cell by cell. Rock
  is banded by a slow noise, not by 3.2 m squares.
- Wet road has a small slow ripple in what it mirrors. A fine strong one scrambled a shop
  sign's mirror image into a blob.

## Three things settled after the third judge (November 12)

- The board's speed stamp read the page's own running figures at the wrong moment: taking a
  picture stalls the page, so rows whose picture is taken mid-act were stamped 22 to 29
  frames a second, and the march time was left over from another picture size. Films of
  those rows (`clip.mjs`) hold 60 with no gap over 16.7 ms. `versus.mjs` now counts frames
  over a second and gives the worst gap. Claim a frame rate only from a count or a film.
- Out in the land things break and burn as in the town: a charge among the pines made 547
  bodies and set them alight, frames held. That is the board's `there` row. Weed under the
  lake caught fire too, being leaves; nothing burns under the sea's top in a sea column now
  (`fire.rs` `light`, test `weed_under_the_lake_does_not_catch`).
- A threshold set against a measured pair goes stale when either side of the pair moves. The
  lit-window line in `hours` was set at 0.85% when lamps alone left 0.6% and windows 1.1%;
  after lamps down every street and the grade the pair was 0.2% and 0.9%, and the line was
  passing by 0.05%. Re-measure the mutant when what it measures against changes.

## What the lake at sunset cost, and where it went (November 12)

- Counted at the sunset row's stand at full size (`engine.steps`, `engine.paced`): rays 25.3
  steps a pixel and 38.2 ms; with mirrors 41.7 steps and 89.5 ms.
- Half the ray time was the walk under the sea: a ray that met nothing before the sea's top
  was marched on down to the floor, through the weed, before `trace` said it had met the sea.
  Each box is now left at the sea's top at the latest (`march`, in the once-a-box part):
  rays 18.0 ms there, and the bench's far row 10% cheaper. This is the same idea that made
  every row a tenth dearer when it was tried with a number kept across the loop; written in
  place, in the once-a-box part, it costs nothing. So: no new value that lives across the
  march's loop; work it out where it is used.
- What water mirrors is asked for three times as coarsely as what glass mirrors, and every
  other box: it is seen through ripples. With mirrors 48.6 ms. The row holds 0.40 of full size
  where it held 0.30.
- Tried and no use here: asking for the mirror image only within 250 m (from 4 m over the
  water nearly all of it is within 250 m), and the quarter roofs for mirrored looks (the
  quarter a sunset look is in holds the mountains). A ray may say it keeps to one quarter
  (`eyed`); looks from the eye and what the sea mirrors of them do.

## Dust that hangs, and a darkening not taken (November 12)

- The judge named dust and fine debris in two rows and in its summary. There was dust where a
  body came to rest, but it was gone in 1 to 3 s, and the board's rest pictures are taken
  after that. It now goes out along the ground and hangs 4 to 9 s (`puffs.ts` `dust`), and
  small bits of the stuff are scattered round what landed and lie for most of a minute
  (`crumbs.ts` `burst` with `lasts` and `fast`). Both are for the eye only: the bits are not
  cells, and they lie on the land's own ground, not on a heap.
- Corner darkening wider than one cell was tried as eight more lookups (two and four cells
  off on each side). It cost 20 to 25% on every row with shadows on and showed little in a
  street picture. Not taken. A wider darkening needs another way than more lookups a pixel.

## The town changed on purpose (November 12)

- Across the street from the yard's water tower the first five houses of the row are shops,
  a sign over every door (`city.rs` `shop`). No further along: the houses across from the
  start keep their doors and street trees, which the fire test, the falls check and the
  flight stand at. Making the whole row shops took the trees with it and those failed.
- The yard's office is six storeys: steel columns five cells thick, a concrete floor at each
  storey with a steel beam round it, braces across two bays of each long side. With its glass
  blown out it stands as a frame.
- The town's sum was set again for these, and the shops' row added to its places (it had
  passed with the shops in, because no summed sector held them). The baseline was re-taken.
- Rows restaged: `town` from in the yard (the tower close, the shops across the street),
  `signs` along the five shops on a wet night, `frame` at the six-storey office with ten
  charges, `ruin` with ten big charges along as much of the row as the picture holds.

## Material finer than a cell, and what the light ceiling showed (November 12, after the fourth judge)

Both judges said the same thing in kind: theirs has material and weight, ours is a toy with flat light and debris
of cubes. Constants and staging had been tried. Before building anything, a grid of pictures, cost ignored:

- **Light ceiling.** Each stand shot under 24 suns from a 1.5 degree disc and 64 lights from all over the sky, every
  still with exact traced shadows, read out before the tone curve and averaged (scratch branch
  `scratch/140-ceiling`, never merged: `march.probe`, flags 256 and 512, `rawOut`). Near things gained depth (a
  tree's crown, doorways, under cars). The far view did not change at all. The street still read as a toy. Light
  is not the first gap. If it is built later it belongs off the pixel (per sector, a map, or over frames).
- **Their cell size.** About 10 cm, as ours: a timber is two cells, a lamp post two. What differs is that they draw
  finer than a cell (plank seams and mortar a pixel wide), smooth the picture, and paint things the colours real
  things are.
- **Material finer than a cell.** `paint()` now takes where on the cell a pixel is and how many pixels wide the cell
  is. Mortar, lap shadows, plank seams, slab joints and grain cost nothing the bench can see (all fifteen rows
  within 3%): it is asked once a pixel, after the march, not in it.
- **Wall paints.** Tones 0, 1, 2 and 7 are what walls are painted. They hold less colour in green, blue and pink
  than in cream and brick (`HOLDS` in `palette()`), and are a little darker. The cells did not change: the town's
  sum is as it was.
- **A sloping road.** The risers of a street's steps were lit as the tread but still asked about corners, so every
  step had a dark foot and a road looked cobbled. They are no longer asked (`slope` in `lit`).

Two things the experiment cost: a light pointing exactly along an axis (a zero in its direction) hangs the GPU in
the march and loses the device, and other pages on the machine with it; 320-step traces of every pixel at full
size did the same. Keep probe lights off the axes and the picture small.

The rubble row was shot three ways after the judge called its debris "frozen in mid-air": as it was, with crumbs
off, with fire off. Crumbs were not it. With fire on the houses are still coming down forty seconds later (83
bodies moving, 7,586 cells burning) and the still is of a collapse. With fire off all is at rest, and what lies
there is tilted slabs in house colours, not a heap. The row is now shot without fire; the heap is the next lever.

## Rubble lies as heaps (`bodies.rs`: `pour`, `heap`; November 12)

A body that stopped askew used to be cut along the world's cells: a slab of stairs with holes in it, in house
colours. And most of what a charge emptied was nothing: its middle, lumps under three cells, and everything once
there were 700 bodies.

- **`heap(loose)`** takes loose cells, the lowest first, each where it was. A cell comes down its column onto what
  is under it, then down any side that is two cells lower (one in four also down a side one lower, so a heap's
  foot spreads), at most 24 times. What lies there has nothing empty under it and no side steeper than one in one.
  Seven cells in ten become the grey of dust, by patches two cells across; cell by cell it read as confetti.
- **`pour(body)`**: masonry and glass that stop askew go to `heap`. Steel and wood keep their shape and are cut
  along the cells as before. A body lying square is still put down cell for cell.
- **A blast** throws the outer part of what it empties as lumps and gives the inner part (within 0.67 of its
  radius), and whatever there can be no body for, to `heap`. Nothing a blast empties is lost now but glass.
- **Cost**: a wall of 10,800 cells is put down in about 10 ms (the core's test holds it under 40). A charge of 40
  takes 20 to 35 ms more than its 260 to 340 ms. The solver's calls are no slower.
- **Not done**: houses still stand as shells whatever is charged out of them (the support rule lets floors hold
  the walls over them), so a district "brought down" is a row of gutted fronts with rubble at their feet. The
  heap appears at once, under the ball of fire; nothing is seen to fall into it.

## Rubble is a mark on the kind (`kinds.rs` `RUBBLE`, bit 4)

A heap kept each cell's material, so the support rule let it hold a wall stub that touched it sideways with nothing
under it (the core's test `a_heap_holds_up_nothing_beside_it` failed: four of four cells stayed in the air). Bits 4
to 7 of a kind were unused: the material is the low four bits, the colour the high byte. Bit 4 now says rubble.

- `material(kind)` masks to four bits. Everything that asks what a cell is made of goes through it.
- `support::loose`: rubble is reached only by resting on what is under it, and nothing is reached through it
  sideways or hung from it.
- `paint()` draws rubble as its stuff broken small: no courses, laps or joints.
- The shaders already took the material as `kind & 15`, so nothing else on the page changed.

The rubble row is shot with fire again, as the page shows itself: at forty seconds heaps lie in the foreground
while the houses burn (25 bodies still moving in one run).

## Air where things break (`page/puffs.ts`, November 12)

The judges' words were "no smoke or air between the camera and the destruction" and fire that "casts no light".

- A blast has a white-hot heart that cools slowest, a wide dull glow added over what is round it for 0.7 s, and
  leaves two wide thin puffs of pale dust that hang for 70 to 110 s. They are heavy in the air (drag 6): at the
  smoke's drag the wind had carried them 30 m off before a picture was taken.
- A burning cell now and then sends up a big dark billow that lives 10 to 18 s, so a burning house stands under a
  column, and a dull glow round it. The glow is rare (a tenth of a second's chance) and faint: at 1.5 a second and
  heat 0.16 the glows of a burning tree added up to a white blob.
- **Puffs that last have places of their own** (`KEPT`, life over `LASTS` seconds). All puffs shared one ring of
  3,072, and a street on fire makes hundreds of flames a second: the smoke and dust over it were overwritten within
  five seconds, which is why none ever showed in a still.
- Cost: the ruin row holds 60 frames a second at 0.35 to 0.40 of full size with the smoke over it (0.40 before).

Judged after it (four rows): blast 5 v 6, fire 6 v 3, rubble 6 v 5, ruin 5 v 6. Ruin is level.

## Water that flows (`core/src/water.rs`, `page/water.ts`, November 12)

- **Not cells.** A tank of 40,000 cells emptying as cells would be on the order of a hundred thousand cell edits a
  second, where a burning house is a few hundred, and each edit is a sector made again and a sun tile spoiled. It
  is a depth over each column of a window (384 columns of two cells: 77 m), moved from column to column by pipes
  that keep their flow and gain by the height between their ends. Still water stays the plane.
- **What it flows over is the world.** A column's floor is looked for where the water arrives (down from just over
  its top, or up out of whatever is there) and looked for again where an edit's box says the world changed
  (`Ground.latest`). So a wall keeps it in, a hole lets it out, and rubble that lands in it raises the floor.
- **Its source is the town's own**: the tank of a yard's water tower (`city::tank_near`) holds 40.7 cubic metres by
  rule. No cell of the town changed, so the town's sum did not. A hole in the tank's wall or floor lets it out,
  faster the deeper under the water left (`holes`, looked for when the world changes near it).
- **Stepped from `advance`**, as fire is, and told as a FLOW record twenty times a second while it moves: one word a
  column of the box round the wet ones. The page asks the mover for time while `bodies_flowing` says so, and once
  after anything is broken.
- **Drawn as a surface** over the marched picture, tested against its depth and written to it: one square a wet
  column, corners at the mean of the wet columns that share them, foam where it runs fast, falls or thins. Nothing
  is in `march`.
- **Numbers** (core test `a_tank_with_a_hole_in_it_empties_over_the_yard`): a call 0.08 ms on average and 2.2 ms at
  worst; 4,600 columns wet at most; at rest after 75 s; 315 kB told a second; every cell accounted for (left in
  the tank, lying, soaked away, gone out of the window). On the page 360 frames in 6 s while it ran, none late.
- **Rough**: the water that leaves a hole is not seen falling (it appears on the deck and comes off its edge as a
  curtain); a tower that goes over spills where it stood, not where it lands; the pool's edge is toothed at the
  width of a column; it soaks away in about a minute and does not reach the lake; one window, so one tower's water
  at a time; it wets nothing and puts no fire out.
- WGSL: `patch` is a reserved word.

## The grade follows the hour (`page/glow.ts`, `main.ts` `grade`)

After the third judge said "colour weak", the last pass was given more colour (1.25) and more contrast (an S-curve
at 0.35). The sunset gained by it. Every judge after called the day pictures bright and toy-coloured. Three day
pictures from the board, regraded in Python with the grade undone and beside the films' frames, sat far closer to
them. The grade is now two numbers the page hands the last pass: the evening's (1.25, 0.35) with the sun low and at
night, and (0.9, 0.1) at full day. Under the sea it stays the full one: with the day's the water lost its colour and the sea check failed. No judge has seen the day pictures since.

Water's look after the judge called its fall "an opaque white pillar": on a steep part the surface is streaks of
white water running down (noise over the height, which the plan alone cannot give: over plan every streak stood
still), with what is behind seen between them; the pool lets the ground show; mist rises where a fall lands
(`water.landings`, `puffs.spray`). Mist at four a second from forty places cost a quarter of the picture's size;
at one a second from two dozen it costs nothing the board's stamp shows.

## The world from space (`page/space.ts`, November 12)

- **A pass of its own.** The boxes of cells reach 13 km. Over 25 km up (`SPACE` in `main.ts`) the marcher is not
  run at all and one full-screen pass draws the planet: a ball of the Earth's size, land and sea by noise of the
  core's own kind (the same hash, asked in km from where the page starts), cloud, air that is a bright band at the
  edge, the sun's patch on the sea, the dark and stars. Nothing in it costs a street anything. It draws at the
  full 2560 x 1440 at 60 frames a second on the M1 Pro.
- **How the flat world lies on the ball.** From under the eye: a place at an angle from straight down, on a
  bearing, is that far along the ground on that bearing. Straight down is exact, so coming down ends where it
  began. Far to the side it is not, and the lands shift a little as the eye moves a long way sideways.
- **Near the start it is drawn as land.rs has it**: the town grey, mountains north, the dry plain east. West of the
  town, from 60 km out, the planet has open sea.
- **Not yet true**: far from the town the cells do not follow the planet. `ground()` is still mountains to the
  north and plain to the east for ever, so a landing 500 km off does not find what space showed. The planet's rule
  has to become land.rs's rule far out (same noise, same seeds), with the town's sum untouched.
- **A fault found on the way**: the picture's size follows the GPU's clock, and the clock was only read round the
  marcher's pass. In space it kept the last street's time, called every frame late and shrank the picture to 0.3.
  The planet's pass is timed the same way now.
- Value noise shows its squares when it is cut at a level (cloud as a maze). `wisps()` turns each fold of it from
  the last and offsets it: no squares.
- The eye goes faster the higher it is (`walk`): at 12 m/s space was hours away.
- A core test's time bound (`masonry_that_stops_askew_lies_as_a_heap`, 40 ms) failed at 44.8 ms beside the page
  checks. It is 250 now: a bound for a rule gone wrong, not for a busy machine.

## The way down from space had a gap (November 12)

The first space change drew the planet from 25 km and checked only 300 km, 20,000 km and 1 km. Shot at 3, 6, 10, 15,
20 and 24 km, the band from 8 to 25 km was a blue square in haze: the widest box of cells is 13 km tall with the
eye at its middle, so the ground is out of it 6.5 km up.

- The planet is drawn from 6 km (`SPACE`), where the cells still hold the ground. `test/space.mjs` asks for the
  ground from 5.8 km, straight down and aslant, and for the planet from 6.5 km.
- So the handover is not a pop, the planet near the start is the town as the cells have it (`town()` in space.ts):
  lakes where the town's ground noise is under the sea's level (the core's noise asked in whole cells, exact),
  blocks 128 m by 80 m with their streets, each block what `city::block` says. Under it the same pale air.
- Still a pop: looking aslant at the mountains, crisp peaks of cells become a soft mass.
- At night the page's light is the moon's: the planet took it for the sun and was lit as by day. It is dark at
  night now, but for the town's lights. No rain streaks are drawn up there.
- The eye's speed goes by its height over the ground, not over the sea: on a peak it flew nine times too fast.
- `water.rs` `changed()` looked every tank over on every edit anywhere and woke the water each time. A tank is
  looked over only when an edit's box reaches it, and water wakes only where the world changed under it.
- WGSL in a template string: no backticks in comments (again).

## A shared world (November 12)

One world process runs the core and orders everything; pages are views of what it says. It is `engine/world.mjs`, a
worker thread behind `serve.mjs --world file`. A page with `?shared=1` talks to it through `page/link.ts`, which
stands where the page's own mover worker stood: the same messages in, the same words out.

- **Nobody else decides anything.** A page in a shared world does not apply its own blast: it asks, and applies the
  echo when the world sends it, in the world's order. Two pages that break things at once agree (twenty looks of
  twenty in `test/shared.mjs`).
- **The stream** (`GET /world/stream?from=n`) is frames with a 12-byte head (kind, number, bytes): 1 what must not be
  missed (cells out and back, bodies born and gone, dust), 2 where things are now (bodies, fire, water: dropped for
  a reader a megabyte behind), 3 an ask as it is done (JSON), 4 "you are now up to date", 5 where someone is.
- **What is kept** is the file of frames 1 and 3. On a restart it is cut down to the edits alone and those go back
  into the core (`world_edit(-1)`): bodies in the air when it stopped are lost, where they came from stays as it was.
- **Anything that can send a request is in it** (`GET /world/` says how): `at` (one cell), `look` (the first thing
  along a line, within 800 cells), `ask` (blast, ignite, ball, edit), `here` (where you are; others draw you as
  three cubes for five seconds). Caps: radius 40, an edit of 4,096 numbers with its box worked out by the server, 60
  asks a second, 256 KB. A request with an `Origin` that is not the server's own is refused, so a page of another
  site cannot act through the browser of someone who can reach it. There is no asking who anyone is.
- **A real model was put in it** (Sonnet, as "wren", through curl alone, 31 requests): it found a house front by
  asking cell after cell, blew a doorway and threw a ball through. What it found wrong with the guide is fixed:
  the street's height (154 at the start, and `ground` says it anywhere), the `rubble` field, that an answer waits
  behind a big blast (710 ms measured), and nothing to see with. `look` came of that.
- **Faults met**: reading `core.memory.buffer` before a call that may grow the memory leaves a detached buffer
  (ask for room first, then read). A check that the blast's middle is air afterwards is wrong: rubble lands there.
- **Run before changing the solver or the carrying**: `node test/shared.mjs --suite` (blast, falls, tools and water
  with `ENGINE_SHARED=1`, each page a view of a world of its own behind a server of its own).
- **Not there**: no agent lives in it (one came, acted and left). A person is three cubes, with no name shown.
  Nothing is said or heard. Sixty-four people in one street has not been tried: two pages and a script have.
  The world's clock is one thread: a big blast holds everything else for most of a second.
