---
name: rust-wasm-core
description: Verified facts and recipes for building Voxelwright's engine core in Rust as wasm (#140): the toolchain, how the page and Node load it with no generated glue, memory views, one instance a worker, what keeps answers the same on every machine. Load before changing engine/core, its build, or how a page or worker calls it.
---

# The engine's core: Rust built as wasm

Adopted November 11, 2026 (#140). The core (`engine/core`) is plain Rust with no dependencies,
built as a `cdylib` for `wasm32-unknown-unknown` and as an `rlib` for its own native checks.
Verified with rustc and cargo 1.96.1 (edition 2024), Node 25.1, Chrome 158 and Safari 27.2 on an
M1 Pro. Primary sources: the Rust reference's `extern "C"` and `no_mangle` rules, the
WebAssembly JS API, and the probes below.

## Toolchain

- `rustup target add wasm32-unknown-unknown` is the only thing added to the machine. No
  wasm-bindgen, wasm-pack, wasm-opt or emscripten: nothing generates glue.
- `engine/core/.cargo/config.toml` turns on `+simd128,+bulk-memory` for the wasm target.
  The probe page found 128-bit SIMD in every browser it met. `fine.rs` uses `core::arch::wasm32`
  SIMD (`i32x4_add`) for 3D prefix sums in `facesWithSmooth`; the rest comes from the compiler.
- `npm run core` (in `engine/`) builds release wasm and copies it to `engine/page/core.wasm`,
  which is ignored by git. A fresh checkout needs it before the city page works.
- The build passes `--remap-path-prefix` through `cargo --config`, which adds to the target's flags in
  `.cargo/config.toml`. Do not move it to `RUSTFLAGS`: an environment variable replaces those flags and SIMD goes with them.
- Release profile: `opt-level 3`, `lto`, one codegen unit, `panic = "abort"`. With SF packs, heroes,
  living vehicles, and `fine.rs` meshing/sculpting, `engine/page/core.wasm` is ~983 kB raw.

## How it is called

- Exports are plain functions: `#[unsafe(no_mangle)] pub extern "C" fn name(...)` taking and
  returning whole numbers. Edition 2024 needs the `unsafe(...)` form of the attribute.
- State lives in one `thread_local!` `RefCell<Instance>` (edition 2024 refuses references
  to `static mut`). An instance does one thing at a time.
- Data crosses as addresses into the instance's own memory: the page asks for an address
  (`edits_room`, `tree_words`, `sector_span`), then makes a typed-array view on
  `memory.buffer` at it.
- **The memory moves when it grows.** `memory.buffer` is a new object after any call that
  allocates, and views on the old one throw "detached ArrayBuffer". Call the export first,
  then read `memory.buffer`. Never write `new Int32Array(core.memory.buffer, core.f(), n)`:
  the buffer is read before `f` runs. This cost one failed run.
- One instance in each worker (`engine/page/worker.ts`) and one on the main thread for small
  questions (`ground_at`). No shared memory, no wasm threads: answers go back as transferred
  typed arrays.
- Loading: `WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {})` in a page (the
  server sends `application/wasm`), `WebAssembly.instantiate(bytes, {})` in Node.

## What belongs in Rust first (and what does not)

Lessons paid for in `#139` (moving fine meshing, RLE codecs, coarsening, and vehicle sculptors
from TypeScript to `engine/core/src/fine.rs` gave 3.6× to 7.5× speedups with bit-exact parity):

**Always write in Rust (`engine/core`) from day one:**

- **Dense 3D voxel/grid kernels (≥ ~50K cells)**: procedural sculptors (`sculptCoupe`,
  `sculptKart`, `sculptOjai`), 3D flood fills and BFS (`outside_air`, `support.rs`),
  morphological sealing/coarsening, greedy face meshing, and 3D prefix sums / smooth-normal
  baking. Flat linear memory, zero GC pauses, and `wasm32` `simd128` beat V8 by 4×–7.5×.
- **Packed binary codecs and multi-stage pipelines**: RLE/LEB128/base64 decode and encode plus
  chained steps (`unrun` → `facesWithSmooth`, `sculptOjai` → `coarser` → `encodeRuns`). Keeping
  intermediate grids inside Wasm linear memory eliminates repeated JS typed-array allocations
  and JS↔Wasm marshaling copies.
- **Deterministic world, tree, and simulation rules** shared across browser Web Workers and
  Node (`city.rs`, `bay.rs`, `tree.rs`, `support.rs`, `bodies.rs`).

**Keep in TypeScript (or WGSL) instead of reflexively porting:**

- **AudioWorklet synthesis (`engine/page/sound/dsp.ts`)**: `AudioWorklet.addModule` (especially
  iOS Safari) favors a single zero-import ES module; precomputing sample-rate coefficients and
  avoiding per-sample allocations already achieves 3.1× speedup (~10% of the 2.67 ms quantum).
- **Short off-thread JS search & WebGPU/DOM orchestration** (`engine/page/sound/music/rules.ts`,
  `engine/page/world.ts`, `engine/page/main.ts`, `engine/page/map-gpu.ts`): zero-alloc typed-array
  TS gets 2.6×–3.2× with no Wasm binary size or call-boundary overhead.
- **Per-pixel GPU work (`engine/page/march.ts`)**: optimize in WGSL (pipeline-overridable
  `override` constants), not Rust.

## Wasm performance rules (paid for in #139)

- **Never call `powf`/`exp`/`sin`/`hypot` per voxel in `wasm32`.** Rust on
  `wasm32-unknown-unknown` links software `libm`, which is slower than V8's native C++ libm
  inside 3D loops (naive Rust `sculptOjai` took 981 ms vs TS 616 ms). Precompute 1D/2D
  analytical profile tables along X, XY, or XZ outside the inner loop: `sculptOjai` dropped
  from 981 ms to 99.8 ms (**10×** faster than naive Rust, **6.2×** faster than TS).
- **Reuse `thread_local!` scratch buffers (`RefCell<Scratch>`)** for every repeated per-sector
  or per-blast call (`tree.rs`, `support.rs`, `fine.rs`), and reset large arrays sparsely
  instead of zeroing megabytes on every call (`core-time` sped up 1.8×–3.1×; `big_charges`
  `release asked` ~1.5×).
- **Eliminate integer division/modulo in 3D loops**: use nested `(y, z, x)` loops or bit-packed
  queues (`x | (z << 10) | (y << 20)`), and skip empty 4-cell/`u64` chunks in one check.
- **Keep browser bridges free of static Node imports**: `engine/page/fine-core.ts` resolves
  `engine/page/core.wasm` relative to `import.meta.url` (so `engine/sf/build.mjs` rewrites it
  to the content-hashed asset) and uses `process.getBuiltinModule('node:fs')` in Node.
- **Preserve summation order on symmetric float seams**: when porting JS `Map` code (such as
  octahedral normal folding where `+0.0` vs `-1e-17` flips a sign), preserve insertion order
  instead of sorting keys with `BTreeMap`.

## The same answer everywhere

- Whole-number hashes (`hash.rs`) and smooth noise built from adds and multiplies only. No
  sine or other library maths in anything that decides what the world is: its last digit
  differs between machines.
- wasm's own float arithmetic is the same on every machine, so the page and a world process
  running this one binary agree. Native test builds are a check of logic, not of bits.
- Anything an edit does is in whole numbers (`scratch.rs` `blast`), seeded from the edit itself.

## Measured (wasm in Node, M1 Pro while busy)

| What | Cost |
|---|---|
| Make one sector of the city (64 cells a side) and encode its tree | 0.78 to 1.61 ms (lod 0..8) |
| A sector's tree | 19 to 72 kB mean by coarseness, 204 kB at most |
| Which sectors of a column are worth making (`sector_span`) | 0.03 to 0.26 ms |
| Fine meshing (`facesWithSmooth`, coupe / Ojai) & sculptors (`fine.rs`) | 32–48 ms smooth, 46–100 ms sculpt |

`node test/core-time.mjs` prints the sector figures.

## Not verified

- wasm threads and shared memory (the probe says the browsers have them; the core does not
  use them).
- Anything on a real iPhone.

Refresh this when the Rust toolchain or edition changes, when a dependency is added, or when
the core starts to use threads.
