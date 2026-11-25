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
  The probe page found 128-bit SIMD in every browser it met. Nothing in the core uses SIMD
  by hand yet: what there is comes from the compiler.
- `npm run core` (in `engine/`) builds release wasm and copies it to `engine/page/core.wasm`,
  which is ignored by git. A fresh checkout needs it before the city page works.
- Release profile: `opt-level 3`, `lto`, one codegen unit, `panic = "abort"`. The wasm is 79 kB.

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
| Make one sector of the city (64 cells a side) and encode its tree | 0.4 to 1.6 ms |
| A sector's tree | 19 to 72 kB mean by coarseness, 204 kB at most |
| Which sectors of a column are worth making (`sector_span`) | 0.03 to 0.26 ms |

`node test/core-time.mjs` prints these.

## Not verified

- wasm threads and shared memory (the probe says the browsers have them; the core does not
  use them).
- Hand-written SIMD.
- Anything on a real iPhone.

Refresh this when the Rust toolchain or edition changes, when a dependency is added, or when
the core starts to use threads.

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"engine/core/.cargo/config.toml":"f9415371f23b3134702e235897c3b230","engine/core/Cargo.toml":"db826952f1bc68e63fecdbd3990fd738","engine/core/build.mjs":"3da36bcee495e94eaa59a898cbe3f42c"} -->
