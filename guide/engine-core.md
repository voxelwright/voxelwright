# The core

The core is the crate in `engine/core`. It decides what every cell of the world is, applies edits, and moves what comes loose. `npm run core` in `engine/` builds it once for `wasm32-unknown-unknown` with SIMD into `engine/page/core.wasm`. The build writes source paths as `/rustc`, `/cargo` and `/core`, so the served file names no one's home folder and two machines build the same bytes. The page's workers, the mover and the shared world process all load that same file. Read [the engine](engine.md) first for where it sits.

## Concepts

- **Kind** (`Kind` in `engine/core/src/tree.rs`). A `u16`. The low byte is the material and its flags. The high byte is a colour from one shared palette of 256. Kind 0 is air. `engine/core/src/kinds.rs` names the materials and flags.
- **Sector.** 64 cells a side (`SIDE`), `CELLS` cells in all. `tree::encode` writes a sector as a tree of words, described in [worlds as cells](cells.md).
- **Scratch** (`engine/core/src/scratch.rs`). The dense 64³ array a sector is built in before it is encoded.
- **Edit** (`Edit` in `engine/core/src/lib.rs`). `Ball`, `Runs`, `Rows` or `Fine`. `fill_of` makes a sector by running the place's rules (`city::make`), then applying the edits that reach it in order.
- **Level** (`lod` in the code). The core makes a sector at any coarseness. At level `lod` a cell stands for 2^lod finest cells each way.
- **Bodies** (`engine/core/src/bodies.rs`). Boxes of cells that came loose. They fall, collide and turn back into world cells when they come to rest. Living things and people's bodies are bodies with a motor (`engine/core/src/bodies/living.rs`).

## Modules

| Module | What it decides |
| --- | --- |
| `city.rs` | The generated town: hills, streets, houses, towers, parks. Synthetic data, made by rule, so none of it is stored. |
| `land.rs` | The ground beyond the town: mountains, a plain, open country. |
| `bay.rs` | San Francisco from data. Rules over packs that the [city pipeline](city-pipeline.md) bakes. Where no pack is loaded the world is level water. |
| `heroes.rs` | Landmarks written as programs, asked for any cell at any size. |
| `scratch.rs` | Building a sector's cells, edits, blasts, finer cells. |
| `tree.rs` | Encoding a sector as a tree. |
| `kinds.rs` | Materials, flags, palette, what a material weighs and how it breaks. |
| `support.rs` | What stands and what falls after an edit. |
| `bodies.rs`, `bodies/living.rs` | Loose bodies, living things, people's bodies. |
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
| `bay_*`, `hero_*` | Loading San Francisco packs and landmarks. |
| `ground_at`, `feet_at`, `paving_at`, `top_at`, `world_kind` | Questions about the world. `world_kind(x, y, z)` returns the kind of one cell, edits included, as the solver's copy holds it (0 for air). `top_at(x, z)` answers from the land's rule alone, before any edit. |
| `world_edit`, `world_regrow`, `world_forget` | The solver's copy of the world, which loose bodies collide with. |
| `bodies_*` | Blasts, fire, thrown balls, moving what is loose. |
| `living_*` | Living things and people's bodies: spawn, drive, `living_drive_aux` (boost, rain wetness, surface grip), walk, place. |
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

- Same edits in the same order give the same cells on every machine. The town, the land, the Bay and fire are computed from rules and hashes. Bodies are not bit-exact across machines, which is why a shared world's process decides them for everyone.
- A sector made at a coarser level shows what the finest copy holds wherever a row has been (`fill_of`).
- The memory layout is private to each build. Plugins and pages call exported functions and never read the core's memory by offset, except for the documented results above.

## Check a change

```sh
cd engine/core && cargo test --release     # the core's own tests
cd engine && npm run core && npm run check
```

A core can be swapped into a running server without a restart: build it, then `POST /core/look`. Each world process starts the new module and replays the kept edits. Bodies in flight are lost.

<!-- docs-verified 3351fa1b50cbe8f10801d860752f5fd32e583365 {"engine/core/src/lib.rs":"f1f8590b59a7e5e80f57c07d2bd8e255","engine/core/src/tree.rs":"2b36ff2da4a2d3e1c196eca9b069764a","engine/core/src/kinds.rs":"c30ebd4301c6126c7b5c00a10dcd272b","engine/core/build.mjs":"f2e002ecf190fe86bf660486e1e58d40","engine/core/.cargo/config.toml":"f9415371f23b3134702e235897c3b230","engine/page/edits.ts":"41ecf2c88d16227f32797a4371ee5a48"} -->
