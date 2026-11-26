---
name: quickjs-sandbox
description: Versions, verified recipes, measurements and limits for running model-written JavaScript in QuickJS (quickjs-emscripten, wasm) inside a worker in a sealed frame, the sandbox for invented mechanics (#106). Load before changing home/src/invent, the mechanic frame's policy, the limits, or before giving generated code a new capability.
---

# QuickJS sandbox (quickjs-emscripten)

Adopted in #106: `quickjs-emscripten-core` 0.32.0 with the variant
`@jitl/quickjs-wasmfile-release-sync` 0.32.0 (MIT), which carries bellard/quickjs
2025-09-13 (vendored February 15, 2026) as a 503 KB `.wasm`. Verified November 10, 2026 in
headless Chrome (channel `chrome`, WebGPU) on an M-series Mac.

Primary sources: <https://github.com/justjake/quickjs-emscripten> (README, `doc/`), the
installed `node_modules/quickjs-emscripten-core/dist/index.d.ts` (the source of truth for
names), and <https://bellard.org/quickjs/quickjs.html>.

The home's code: `home/src/invent/` (`sandbox.ts` page side, `relay.ts` the frame's document
and policy, `box/worker.ts` the interpreter's host, `prelude.ts` and `contract.ts` what the
guest sees, `limits.ts`), and `home/src/engine/invent.ts`, which checks everything that comes
back. The proof is `home/scripts/check-invent.mjs`.

## Why this shape (the experiment, November 10, 2026)

Two arms inside a sealed frame (`sandbox="allow-scripts"`, opaque origin, `default-src 'none'`)
and a blob worker, the #42 prop-box pattern:

| | native V8 worker | QuickJS in the worker |
| --- | --- | --- |
| round trip, 16 to 64 things (p50 / p95) | 0.10 / 0.30 ms | 0.20 to 0.40 / 0.60 to 0.80 ms |
| start | 8 to 15 ms | 22 ms (wasm bytes handed in) |
| `while (true) {}` | runs until the page terminates it | stopped by the interrupt handler in 2.5 to 4.4 ms |
| `s += s` for ever | **the whole tab crashed** | "string too long" in 1.7 ms |
| array bomb | no reply; page must terminate | "out of memory" at the limit |

The native arm is ruled out: a worker in a sandboxed frame shares the page's process, so its
memory is the page's, and nothing in the platform caps it. QuickJS has a hard memory limit, a
stack limit and an interrupt hook, and the guest has no ambient globals (no `postMessage`,
timers, `fetch`), so the allowlist is whatever the host binds: here, nothing.

In-page QuickJS (synchronous hooks) was not chosen: the interpreter would run in the session's
origin, so one interpreter bug would hand generated code the page and its session (#106 asks
for generated code to run away from that origin). The frame is a second wall. The cost of the
frame and worker is that hooks answer one step late.

## Verified recipes

- Load without network. The sealed frame cannot fetch. The page fetches the `.wasm`
  (`import url from '@jitl/quickjs-wasmfile-release-sync/wasm?url'`) and transfers the bytes;
  the worker calls `newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmBinary }))`.
- Bundle the worker as one iife string (Vite `build` with `lib.formats: ['iife']`, as the
  prop box does). The variant's Emscripten glue reads `import.meta.url`, which an iife has
  none of: without `define: { 'import.meta.url': '"http://mechanic-box.invalid/"' }` it throws
  `Failed to construct 'URL': Invalid base URL`.
- Frame policy. `sandbox allow-scripts; default-src 'none'; script-src 'nonce-…' blob:
  'wasm-unsafe-eval'; worker-src blob:`. The blob worker inherits it. The home's own policy is
  untouched. The `sandbox` directive in the header matters: the frame's `sandbox` attribute
  makes the origin opaque only when the home frames the document, and without the header a
  site that opens the address in its own tab runs a worker with the home's origin (Sentinel's
  probe, #106: IndexedDB opened there; with the header it is denied).
- Limits. `runtime.setMemoryLimit(bytes)`, `runtime.setMaxStackSize(bytes)`,
  `runtime.setInterruptHandler(() => ++asks > budget)`. The handler is asked about every
  10,000 jumps and calls, not per time: 50 asks of a tight loop took 2.5 to 4.4 ms. Reset the
  counter before each call. A stopped call's error message is `interrupted`.
- One string in, one string out. Bind no host functions. Pass a JSON string to one guest
  function and take a JSON string back (`vm.newString`, `vm.callFunction`, `vm.getString`);
  dispose every handle. A 6 KB view with 64 things costs 0.3 ms in the guest (parse, a loop,
  stringify) and about 0.1 ms on the page.
- Errors. `vm.callFunction` returns `{ error }` for a guest exception, a limit or an
  interrupt; the interpreter is usable afterwards. A JavaScript exception thrown *through* the
  wasm (the worker's own stack overflowing) is not recoverable: treat the worker as broken.
- Stack. With `setMaxStackSize(256 KB)` deep recursion overflowed the worker's own stack
  first (`Maximum call stack size exceeded` from V8). 96 KB gives QuickJS's own
  `stack overflow` error.

## Limits and unknowns

- The guest's answers are data. The prelude shares the interpreter with the guest, which can
  replace it, so no check lives there.
- Promises never run (nothing calls `executePendingJobs`); `Date.now` and `Math.random` exist.
- One runtime per mechanic, one worker per runtime: about 25 ms to start, 80 to 130 ms to a
  loaded mechanic in the home. Memory per worker was not measured.
- Not verified: Safari and iOS (wasm in a blob worker of a sandboxed frame), a real phone, and
  behaviour when the tab is hidden for long (timers throttle; the page's late-answer watchdog
  gives the answer one extra turn).
- An array bomb took 2.8 s to reach "out of memory" at a 16 MB limit (native `fill` loops are
  not interrupted). The shipped limit is 8 MB (`LIMITS.memory`) and was not timed. It is off the main thread, and the page's watchdog closes a box that takes
  longer than `LIMITS.late`.

## In Node, for the engine's rules (#264, November 13, 2026)

The engine's rules run in the same package (`engine/rules/box.mjs`), each in a `Worker` of its own started by the
world's process (`rules/run.mjs`), with no frame. Node 25.1, M1 Pro:

- **`runtime.setMemoryLimit` did not hold** (quickjs-emscripten 0.32.0): with 16 MB set, a guest that pushed
  `new Array(1000).fill(1)` for ever inside `try/catch` grew the wasm memory to its built-in maximum, 2 GB, in
  three seconds, and only then was told "out of memory". Do not rely on it. What holds: give the module a memory of
  its own with a maximum, `newVariant(variant, { wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 512 }) })`
  (pages of 64 KB; `initial` must be the 256 the module is built with). The platform refuses to grow it: "out of
  memory" after 29 ms at 31 MB, and the interpreter is usable afterwards. A module made this way takes 5 ms.
- **One module to each guest.** Modules share nothing; runtimes of one module share its memory, so one guest's
  growth or corruption reached the next (`newContext` threw "null function or function signature mismatch").
- **The interrupt handler counts jumps and calls, not time.** `for (;;) {}` is stopped in 3 to 10 ms at 200 asks,
  and a backtracking regex is interrupted (117 ms), but collecting garbage near the limit, `sort`, `split` and
  `join` on big values run uncounted. Behind the count there has to be a clock kept by someone else: here the
  world ends the guest's thread (`worker.terminate()`) when a call takes over a second.
- `s += s` for ever ends at once with `string too long`.
- A call with a view of 16 people is 0.13 ms, of 100 people comparing every pair 1.9 ms, of 400 people 26 ms.
- A thread with its module and a small rule is 18 MB; sixteen start in 0.2 s.
- The wall is thinner than the home's: an interpreter bug here is in a thread of the world's own process, which
  holds the world's file and can reach the network. No second wall (a child process with no rights) has been
  built. What stands in its place: nothing is bound in, and what comes out is checked as data.

## Refresh when

The package version changes, the frame's policy changes, a browser other than Chrome is
targeted, or generated code is to get a capability that needs a host function bound into the
interpreter (each bound function is attack surface: prefer more data in the view).
