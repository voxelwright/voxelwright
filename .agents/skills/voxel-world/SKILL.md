---
name: voxel-world
description: Measured facts, recipes and limits for Voxelwright's world of cells (voxels) in the engine and the street (#138). Load before changing home/src/engine/voxels.ts, cells.ts or the cells parts of world.ts, the street's --cells path, the page's cells renderer, or anything that edits, splits, packs or replicates cells.
---

# A world of cells

Adopted November 11, 2026 (#138), on the owner's direction that the world be a voxel engine. Nothing
was added as a dependency: the cells are Voxelwright's own code over the existing solver (`jolt-physics`
1.1.1, see the `jolt-physics` skill) and renderer (three r187 WebGPU, see `tsl-stylised-post`).
Verified in Node 25.1 and headless Chrome on an M1 Pro. Every number below was measured on that
Mac while it was busy (load 6 to 16), so a quiet machine does better.

## What a thing of cells is

- A block (`voxels.ts`): `size`, `cell` (edge in metres), `cells` (a `Uint8Array`, 0 is air,
  k is `kinds[k - 1]`), `kinds` (a material from `materials.ts` and perhaps a paint). A layer
  (one y) is contiguous: `x + nx * (z + nz * y)`. At most 255 kinds and 1024 cells a side.
- A cell stores a material, never a colour: weight, burning and the look follow from it.
- Each thing has its own block and its own pose. There is no one world grid. A still thing
  (a house, the ground) is held by its lowest `held` layers; a loose piece is a body that turns freely.
- `voxels.ts` imports nothing and uses whole numbers for every edit, so the world process and
  each page run the same edit and hold the same cells. Keep it that way: no three, no floats in
  an edit's result. `chance(x, y, z, seed)` is the one source of randomness an edit may use.

## Measured (10 cm cells unless said)

| What | Cost |
|---|---|
| A house, 74 x 115 x 100 cells, 209k solid: build colliders | 14 ms, 324 boxes in 48 chunk bodies |
| Carve a 0.6 m ball out of a wall, find loose pieces, rebuild colliders | 1.6 ms |
| Carve a 1.5 m ball | 3.2 ms |
| Median of random blows on one house | 0.4 ms |
| A whole storey cut loose (80k cells, 346 boxes) | 14 ms once; the step while it falls 2 ms at worst |
| Same house at 5 cm cells, a storey cut loose | 112 ms: too slow, so buildings are 10 cm |
| The whole block as cells: 24.1 million cells | built in 1.0 s, 63 kB packed, heap 56 to 84 MB |
| World tick, two walkers on the block of cells | p50 0.3 ms, max 7 ms |
| `pack` a house of 851k cells | 1.1 ms, 288 characters whole (more once broken) |
| Page: mesh the block | 500 ms on the main thread, 78k to 87k quads in 131 to 171 meshes |
| Page: GPU a frame at 1280 x 720, top tier | 5.5 to 7.4 ms |

The search for loose pieces was the one thing that did not fit a tick: labelling the whole house
cost 9 to 19 ms a blow. `loosened()` replaced it.

## Recipes

- **Finding what came loose (`loosened`)**: look only round the change. Label the solid cells in
  the changed box grown by one cell; each group then spreads outwards in turn, downwards first.
  A group that reaches a held layer stops; groups that meet join; one that runs out of cells is a
  loose piece. For a loose thing, when the cells round a hole are still one group, nothing came
  loose. For a standing thing that shortcut is wrong (cut a post at its base and the one group is
  the loose one): it must find its footing. Adding cells to a loose thing needs the whole-block
  search (`pieces`). `home/scripts/check-voxels.mjs` holds `loosened` to `pieces` on thousands of
  random breaks; run it after any change here.
- **Colliders**: a still thing is one static body per 32-cell chunk, each a compound of boxes from
  `boxesOf` (grow along x, then z, then y). A blow rebuilds only the chunks its box reaches. A
  moving thing is one compound body; rebuilding it keeps its pose and speeds. A moving part marked
  `smooth` collides as its own shape (a ball rolls, a crate is one box) until its first cut.
- **Crumbs**: a piece under 10 cells is not a body. It is emptied and listed in the cut's `gone`.
- **Replication**: a cut is told as data (`CutRecord`: the ball, its ragged edge's seed, the dust
  cells, the pieces taken with their own packed cells). The page applies it with `World.applyCut`;
  loose pieces follow as ordinary `add` lines. A page that arrives later gets each toy with its
  cells as they stand (`World.partNow`). `street/test/cells.ts` compares a sum of every block on
  two pages, a late page and the world.
- **Packing**: each row is "same as the row below", "same as the row before" or its own runs;
  equal answers are counted. Built things are mostly repeats.
- **Cells from shapes (`cellsFrom`)**: later shapes overwrite earlier ones; a shape thinner than
  a cell is fattened to one; the block is cropped to its solid cells, because "held by its lowest
  layer" is only true if that layer has cells.
- **Meshing (page)**: per chunk, per face direction, a mask of the cells that look at air, merged
  greedily into rectangles of one kind. Positions are in cells and the mesh is scaled by the
  cell's edge, so the shader finds the cell under a point with a `floor`. Chunks are drawn in
  groups of 4 x 4 x 4 as one mesh to keep draws down. Glass goes to a second, see-through mesh.

## Limits and traps

- Support is only "joined to the footing". A house over a crater stays up; a wall hanging by one
  cell stays up. Nothing weighs on anything.
- A still thing is not held by the thing under it: blocks do not support each other.
- What has been broken is not saved: a restart builds the street whole (made things are kept).
- `toy.ts` must stay loadable by plain Node: only type imports there. Runtime cells code lives in
  `cells.ts`, which is loaded through Vite like `world.ts`.
- A loose piece that falls out of the world is put back where it came loose (the engine's guard
  for lost things), not removed.
- The adapter calls `OptimizeBroadPhase` on the step after any body is added. Not yet measured
  with many chunk bodies changing every tick.
- The page meshes on its main thread: about half a second on arrival. Move it to a worker before
  the street grows.
- The page's walker is not stopped by cells: it follows the world's height one round trip late.
- Not built: fire and water per cell, damage from impacts, saving edits, cells in the home.

## The reference

Matt Shumer's review of Fable 5.2 (somethingbig.ai/fable-5-2-review, November 9, 2026) shows a
browser sandbox of about 10 cm cells with twelve tools and free-turning debris, and the same
engine fed open map data. Its film is "captured frame by frame, with scripted input", so it does
not show frame rate, and neither build is shared or server-owned.

The Earth film's last frame credits its data, read from the frame on November 11, 2026: Overture
Maps Foundation and OpenStreetMap (ODbL); Mapterhorn and Mapzen/AWS Terrain Tiles; aerial imagery
from Esri, Maxar and Earthstar Geographics; sea bed from NOAA NCEI (CUDEM, ETOPO 2022); climate
from NOAA PSL (GHCN_CAMS, PREC/L); street imagery and heights from Mapillary (CC BY-SA 4.0); roof
and tree heights from USGS 3DEP lidar (through Microsoft Planetary Computer) and AHN; canopy
height from Meta and the World Resources Institute (CC BY 4.0). None of these has been fetched or
tried here. A real San Francisco would start from building footprints with heights, a terrain
tile and lidar roofs; check each licence before any of it enters the repo.
