---
title: Worlds as cells
description: A world is a function plus a history of edits, stored as 10 cm cells in sectors. The formats behind it.
---

A world in [the engine](/engine) is a function plus a history. A function (the generated town in `engine/core/src/city.rs`, or San Francisco's packs in `engine/core/src/bay.rs`) says what every cell is before anyone touches it. The edits since then say what changed. Nothing else is stored: any sector, at any coarseness, is made again on demand from the function and the edits.

## Concepts

- **Cell.** 10 cm a side at level 0. It holds a **kind**: a 16-bit number, with the material in the low 4 bits, flags in bits 4 to 7 and the palette colour in the high byte (`engine/core/src/kinds.rs`).
- **Sector.** 64 cells a side. The unit that is made, stored on the GPU and marched.
- **Level.** A copy of the world at cells 2^level times larger. The page keeps 9 levels on a desktop and 8 on a phone (`levels` in `engine/page/main.ts`), so the coarsest box has cells of 25.6 m or 12.8 m.
- **History.** The ordered edits. A shared world appends them to its world file. The page holds them in `engine/page/world.ts`, and each ask to a sector worker carries the edits that reach that column.
- **Release.** A content-addressed set of San Francisco tiles and their manifest, named by the SHA-256 of the manifest. A world on San Francisco is pinned to one release ([the San Francisco release](/sf-release)).

## A kind

| Bits | Meaning | Names in `kinds.rs` |
| --- | --- | --- |
| 0 to 3 | Material, 0 to 15. 0 is air. | `EARTH` = 1 through `LAMP` = 15 |
| 4 | Rubble: loose, holds nothing up | `RUBBLE` = 16 |
| 5 | Charged: goes up in a blast when hit | `CHARGED` = 32 |
| 6 | Holds a block of finer cells. Only the core sets it; no edit from outside carries it. | `FINE` = 64 |
| 7 | Polished: mirrors and glints, a look only | `POLISHED` = 128 |
| 8 to 15 | Colour. 0 is the material's own; 1 to 15 are greys; then 24 hues in 10 tones (`colour(hue, tone)`). | `OWN`, `WHITE`, `grey`, `colour` |

## A sector as a tree

`encode` in `engine/core/src/tree.rs` writes a sector's 64³ cells as `u32` words. The answer is one of three shapes:

| Words | Meaning |
| --- | --- |
| 0 | All air. |
| 1 | All one kind; that word is the kind. |
| n | A tree of n words. |

The tree has three levels of nodes: a root that splits the sector into 4 × 4 × 4 parts of 16 cells, those split into 4 × 4 × 4 leaves of 4 cells, and each leaf holds 4 × 4 × 4 cells. Child `c` of a node is at `x + 4z + 16y` within it, and only children that hold something are stored, in that order. A node is four words:

| Word | Contents |
| --- | --- |
| 0, 1 | The 64-bit mask, low half then high half: which of the 64 children hold anything. |
| 2 | Where the children are, in words from the start of the sector (low 20 bits, `CHILD`). For a leaf, where its cells' kinds are, two kinds to a word. For a root or mid node, bits 20 to 31 hold the high corner of the box around its contents. |
| 3 | The kind seen from far off in the low 16 bits, and `UNIFORM` (bit 31) when the node is all that kind. Bits 16 to 27 hold the content box: for a leaf both corners, 2 bits a number; for a root or mid node the low corner, 4 bits a number. |

The content box lets a ray skip a whole node when it passes over a roof or a slab. The same words are what the ray marcher reads, what the solver collides with, and what is kept or sent. With finer cells on (`FINE`), a leaf adds one more word per cell pointing to a block of 4³ or 8³ smaller cells; `encode_fine` describes it.

## Edits and the world file

An edit is a run of `Int32` words: a ball, a blast, or rows of cells. The table is in [the core's edit format](/engine-core#the-edit-format). Every core that applies the same edits in the same order makes the same cells.

A shared world started with `node serve.mjs --world FILE` (in `engine/`) appends the frames it keeps to `FILE`. They use the stream's binary layout: a 12-byte little-endian header (kind, number, payload length as `u32`), then the payload. The kinds are in `engine/page/frames.ts`. Two kinds are kept: `LOG` (the core's words for what changed) and `ECHO` (each ask as JSON, at the moment the world did it). Reading the file again rebuilds the world. Realms are kept the same way, one `.log` file each, in a folder beside it.

## San Francisco from tiles

On San Francisco the function is in `bay.rs`, and its input is measured data. A **tile** holds what was measured of one square of the city: ground heights, what stands on the ground, building outlines, tree trunks and street fixtures. The core turns a tile into cells the same way on every machine that holds the same tiles: ordinary buildings propagate street-facing windows across faceted bay windows and porches, skip duplicate synthetic bay boxes when the footprint already traces bays, preserve pitched gables without protruding floating parapet cornices, draw living green roofs as `GRASS` and glass roofs as `GLASS`, and render elevated inland ponds and lagoons as rippling reflective `WATER`. Parametric landmarks (`engine/core/src/heroes.rs`, placed by `engine/sf/heroes.json`) override cells and optionally terrain surfaces (lagoons, koi ponds, floral parterres), with up to two overlapping landmarks evaluated per column (for example Fort Point beneath the Golden Gate Bridge's south arch). In `engine/page/march.ts`, `PLASTER` walls render as smooth painted stucco with subtle course tooling rather than heavy clapboard ribs. Where no tile is held, the world is level water.

Tiles come in three levels (250 m, 1 km and 4 km a side). A sector made of coarse cells is made from a coarse tile, so it comes out the same whichever finer tiles happen to be loaded (`pick` and `least_step` in `bay.rs`).

The frame is UTM zone 10N with its origin at 500,000 m east and 4,250,000 m north (`10n4250`). x runs east and z south, in cells. A world on San Francisco is pinned to one **release**: a pointer, a manifest named by its own SHA-256, and the tiles it lists. The binary layout of a tile (`BAY1`), the far model (`FAR1`) and the manifest are in [the San Francisco release](/sf-release). How the tiles are made is in [the city pipeline](/city-pipeline).

## What would break if a field changed

- A change to a release's manifest or tile format is listed in [the San Francisco release](/sf-release#what-breaks-if-a-format-changes).
- A change to `tree.rs` encoding must change the WGSL reader in `engine/page/march.ts` in the same commit, because the GPU reads the words directly.
