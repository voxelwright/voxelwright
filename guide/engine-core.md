---
title: The core
description: The Rust core compiled to WebAssembly. It decides what every cell is, applies edits and moves what comes loose.
---

The core is the crate in `engine/core`. It decides what every cell of the world is, applies edits, and moves what comes loose. The page's workers, the mover and the shared world process all load the same build of it, `engine/page/core.wasm`. Read [the engine](/engine) first for where it sits.

## Build it

`npm run core` in `engine/` runs `engine/core/build.mjs`, which builds the crate for `wasm32-unknown-unknown` with SIMD and bulk memory (`engine/core/.cargo/config.toml`) and copies it to `engine/page/core.wasm`.

- **Same bytes everywhere.** The build writes source paths as `/rustc`, `/cargo` and `/core`, so the served file names no one's home folder and two machines build the same bytes.
- **Cached by source and compiler.** When `engine/core` is committed and clean, the build is kept in `~/.village/engine/core-cache` under the tree's hash and the `rustc` version, and a new worktree copies it instead of building. A `core/` with changes is always built and never kept. `--no-cache` builds anyway.

## Concepts

- **Kind** (`Kind` in `engine/core/src/tree.rs`). A `u16`. The low byte is the material and its flags. The high byte is a colour from one shared palette of 256. Kind 0 is air. `engine/core/src/kinds.rs` names the materials and flags.
- **Sector.** 64 cells a side (`SIDE`), `CELLS` cells in all. `tree::encode` writes a sector as a tree of words, described in [worlds as cells](/cells).
- **Scratch** (`engine/core/src/scratch.rs`). The dense 64³ array a sector is built in before it is encoded.
- **Edit** (`Edit` in `engine/core/src/lib.rs`). `Ball`, `Runs`, `Rows` or `Fine`. `fill_of` makes a sector by running the place's rules (`city::make`), then applying the edits that reach it in order.
- **Level** (`lod` in the code). The core makes a sector at any coarseness. At level `lod` a cell stands for 2^lod finest cells each way.
- **Bodies** (`engine/core/src/bodies.rs`). Boxes of cells that came loose. They fall, collide and turn back into world cells when they come to rest. Living things and people's bodies are bodies with a motor (`engine/core/src/bodies/living.rs`). Moving bodies can also be carved and sliced voxel-by-voxel in place (`engine/core/src/bodies/carve.rs`).
- **Hull** (`engine/core/src/bodies/hull.rs`). What one rolling vehicle is to another: the rectangle round its cells at each height, so the cabin and the boot are in it and the air over the bonnet is not. Other pairs of bodies meet cell by cell. A car is a hollow shell, so two cars meet as hulls and are pushed apart one way: the way their boxes overlap least, or, when one is more than 0.5 m inside the other (`INSIDE`), back the way it came in. Up and down only when they share under 40% of the lower one's height (`OVER`), so a car is not lifted onto the one it rear-ends.

## Modules

| Module | What it decides |
| --- | --- |
| `city.rs` | The generated town: hills, streets, street furniture (lamps, signs, hydrants, bins, mailboxes), houses, towers, parks. Synthetic data, made by rule, so none of it is stored. Streets carry no cars made of world cells: every car is a fine, drivable vehicle. |
| `land.rs` | The ground beyond the town: mountains, a plain, open country. |
| `bay.rs` | San Francisco from data. Rules over packs that the [city pipeline](/city-pipeline) bakes, including surveyed vector kerbs (`bay_kerbs`) carved at 1.25 cm sub-cell precision, slim fine-subcell aerial cables across L0–L2 (2.5 cm at L0/L1 and 5 cm at L2 so overhead wires continue down the street past the L0 boundary), perimeter cornice blending over lidar dropouts, and solid-probe column caching beneath overhead fixtures. Where no pack is loaded the world is level water. |
| `heroes.rs` | Landmarks written as programs, asked for any cell at any size. |
| `scratch.rs` | Building a sector's cells, edits, blasts, finer cells (including per-sector fine blocks at coarse LODs via `sector_fine_runs`). |
| `tree.rs` | Encoding a sector as a 64-tree with intra-sector SVDAG deduplication (sharing identical non-uniform leaf payloads, mono-kind runs, and mid leaf-node arrays via generation-stamped thread-local scratch tables, keeping the GPU binary format unchanged and `FINE` leaves dedicated). |
| `kinds.rs` | Materials, flags, palette, what a material weighs and how it breaks. |
| `support.rs` | What stands and what falls after an edit (reusing thread-local solver scratch and sparse resets). |
| `fine.rs` | Fine-voxel meshing (`faces`, `facesWithSmooth` with octahedral smooth normals and AO via `wasm32` SIMD 3D prefix sums), RLE/base64 codec, shell-preserving `coarser` + leak sealing, and procedural vehicle sculptors (`sculptCoupe`, `sculptKart`, `sculptOjai`). |
| `bodies.rs`, `bodies/living.rs` | Loose bodies, living things, people's bodies. |
| `bodies/carve.rs` | Mutable voxel carving and slicing of dynamic bodies (`carve_sphere`, `carve_capsule`, `carve_plane`), fast bit-packed 6-connected component splitting with tight cropping, world-space position and momentum conservation, face mesh rebuilds, and vehicle hull sync. |
| `bodies/hull.rs` | How two rolling vehicles meet and part, and where a vehicle put into another's place ends up. |
| `ballistics.rs` | Ranged combat and blast physics: sub-stepped 3D Amanatides-Woo DDA projectiles (`Caliber` presets), `kinds.rs`-driven penetration and grazing ricochet with exact momentum transfer, swept-sphere shaped-charge rockets with optional proportional-navigation guidance, and occluded delayed shockwaves (`ShockwaveQueue`, 64-ray Fibonacci occlusion at 340 m/s plus directional shrapnel). |
| `ragdoll.rs` | 13-bone articulated active ragdolls matching `people.ts`/`moves.ts` proportions: analytical capsule colliders, XPBD joint limits (hinge knees/elbows/ankles; swing-twist hips/shoulders/spine/neck), unconditionally stable implicit 3×3 PD muscle motors, 4-state blending (`Locomotion`, `HitReaction`, `FullRagdoll`, `GetUp`), Tier-A joint severing (`DetachedLimb`) + Tier-B `10×10×16` 2.5 cm `MidLimbSlice` plane cleaving, and 67-byte smallest-three wire packing (`pack_pose`/`unpack_pose`). |
| `fire.rs`, `water.rs` | Fire spreading from cell to cell. Water as depths over columns, not cells. |
| `hash.rs` | Whole-number hashes and smooth noise that give the same result on every machine. |

All lengths are in finest cells (10 cm). In San Francisco, x is east and z is south from a fixed UTM zone 10N origin, and y is up from the bay's water (`bay.rs`).

## The interface

The core has no generated bindings. Every call from outside is a `#[unsafe(no_mangle)] pub extern "C" fn` at the end of `engine/core/src/lib.rs`, over one instance's own memory. An instance does one thing at a time. Data passes through memory in two patterns:

- **Write in.** A `*_room(n)` call (`edits_room`, `bay_room`) returns an address. The caller writes `n` values at that address in `memory.buffer`, then makes the call that reads them. The edits in the room stay until `edits_room` is called again, and `make_sector`, `merge_rows` and `world_edit` all read them.
- **Read out.** A call returns a count, and a second call returns the address of the result: `make_sector` then `tree_words`, `merge_rows` then `merged_words`, `bodies_advance` then `bodies_words`.

Ask for the address after any call that may grow memory, because the buffer moves when memory grows. `engine/page/worker.ts` shows the whole pattern.

The exports fall into groups by prefix:

| Prefix | Use |
| --- | --- |
| `edits_room`, `merge_rows`, `merged_words` | Edits in, and edits merged into rows for a coarser copy. |
| `make_sector`, `make_finer`, `tree_words`, `sector_span`, `fine_cells`, `fine_refused` | Making sectors. `sector_span` says which sectors of a column hold anything. |
| `bay_*`, `hero_*` | Loading San Francisco packs, drawing landmark cells and identifying the mapped trees a landmark replaces. |
| `ground_at`, `feet_at`, `paving_at`, `top_at`, `world_kind`, `world_under` | Questions about the world. `world_kind(x, y, z)` returns the kind of one cell, edits included, as the solver's copy holds it (0 for air), probing unedited Bay columns directly without building a 64³ sector. `world_under(x, y, z, depth)` scans downward for the top of the first solid cell beneath `(x, y, z)`. `top_at(x, z)` answers from the land's rule alone, before any edit. |
| `world_edit`, `world_regrow`, `world_forget` | The solver's copy of the world, which loose bodies collide with. |
| `bodies_*` | Blasts, fire, thrown balls, moving what is loose. |
| `living_*` | Living things and people's bodies: spawn, drive, `living_drive_aux` (boost, rain wetness, surface grip), walk, place. `living_place` moves a rolling vehicle out of any vehicle that is coming into the place it is put, ahead of it, and moves on the vehicles standing where it lands. |
| `fine_*` | Fine-voxel buffer I/O, RLE/base64 decode and encode (`fine_unrun`, `fine_encode_runs`), greedy face meshing and smooth normals (`fine_faces`, `fine_faces_smooth`), shell-preserving coarsening and leak sealing (`fine_coarser`, `fine_seal_leaks`), and procedural vehicle sculpting (`fine_sculpt_coupe`, `fine_sculpt_kart`, `fine_sculpt_ojai`). Called from `engine/page/fine-core.ts`. |
| `material_weighs` | Sets a material's weight while the core runs. |

## The edit format

Edits travel as `Int32Array` words, one edit after another, and `read_edits` parses them:

| First word | Edit | Then |
| --- | --- | --- |
| `0` | `Ball` | `x, y, z, radius, kind`. Kind 0 is a blast. |
| `1` | `Runs` | `n`, then `n` rows of `x0, x1, y, z, kind` |
| `2` | `Rows` | as `1`, for rows that `merge_rows` produced |
| `3`, `4` | `Fine` | as `1`, in cells of a quarter (`3`) or an eighth (`4`) |

Any other first word is read as `1`. Input from outside is read without harm: a truncated edit ends parsing, and no kind read from outside carries the `FINE` flag. The page builds these words in `engine/page/edits.ts` (`ball`, `rows`, `fineRows`, `stream`).

## Invariants

- Same edits in the same order give the same cells on every machine. The town, the land, the Bay and fire are computed from rules and hashes. Bodies are not bit-exact across machines, which is why in a shared world the world process decides them for everyone.
- A sector made at a coarser level shows what the finest copy holds wherever a row has been (`fill_of`).
- The memory layout is private to each build. Plugins and pages call exported functions and never read the core's memory by offset, except for the documented results above.

## Check a change

```sh
(cd engine/core && cargo test --release)                       # the core's own tests
npm --prefix engine run core                                   # build core.wasm
npm --prefix engine run check                                  # the engine's checks
```

A core can be swapped into a running server without a restart: build it, then `POST /core/look`. Each world process starts the new module and replays the kept edits. Bodies in flight are lost.
