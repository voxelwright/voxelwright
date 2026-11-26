# The engine

The engine in `engine/` stores a world as cells and draws it in the browser. Its core is Rust compiled to WebAssembly. The page that draws is TypeScript on raw WebGPU, with no framework. A world can also run in a server process that many pages share. People and models change a running world through rules and plugins.

## Concepts

- **Cell.** The world's unit of space: 10 cm a side in the finest copy of the world. A cell holds one **kind**, a 16-bit number. Kind 0 is air. See [the core](engine-core.md).
- **Sector.** A cube of 64 × 64 × 64 cells, stored as a tree of 32-bit words. Sectors are what the core makes, what the page keeps on the GPU and what the ray marcher reads. See [worlds as cells](cells.md).
- **Level.** A copy of the world whose cells are 2^level times larger. Level 0 holds the finest cells. The page keeps one box of sectors per level around the eye.
- **Edit.** Something done to the world, written as whole numbers: a ball of one kind, a blast, or rows of cells. Every core applies the same edits in the same order and gets the same cells.
- **Pass.** A drawing step in the frame. A plugin can add its own; see [page plugin types](plugin-types.md).
- **Rule.** A script that a person or their model wrote, run in a sandbox beside a shared world. **Plugin.** Engine code from the checkout that gives rules something new to hear or do. See [plugins and rules](engine-plugins.md).

## Parts

```mermaid
flowchart LR
  Core["engine/core<br/>Rust, built to page/core.wasm"]
  subgraph Browser["The page (engine/page)"]
    Main["main.ts<br/>frame loop"]
    World["world.ts<br/>boxes of sectors, tree pool"]
    Worker["worker.ts<br/>makes sectors"]
    Mover["mover.ts<br/>moves loose bodies"]
    March["march.ts<br/>ray marcher in WGSL"]
  end
  subgraph Server["Shared world (engine/serve.mjs)"]
    Proc["world.mjs<br/>world process"]
    Rules["rules/<br/>one QuickJS thread per rule"]
    Plugins["plugins/&lt;name&gt;/world.mjs"]
  end
  Core --> Worker
  Core --> Mover
  Core --> Main
  Core --> Proc
  World -- "Ask / Answer" --> Worker
  World -- "trees and boxes buffers" --> March
  Main --> World
  Main --> March
  Proc -- "stream of frames" --> Main
  Proc --> Rules
  Plugins --> Proc
```

| Part | Path | What it owns |
| --- | --- | --- |
| Core | `engine/core/src` | Cells, sectors as trees, the generated town, edits, loose bodies, fire and water. One build serves every caller. |
| Page | `engine/page` | The frame loop, the boxes of sectors, the ray marcher and everything drawn over the world. |
| Sector makers | `engine/page/worker.ts` | A pool of workers. Each holds its own core instance and turns an ask for a column of sectors into trees. |
| Mover | `engine/page/mover.ts` | One worker with one core that moves what has come loose, when the page is not in a shared world. |
| World process | `engine/world.mjs` | A Node worker thread started by `engine/serve.mjs` with `--world`. It runs the core for everyone in a shared world and decides the order of every change. |
| Rules | `engine/rules` | Run each rule in a thread and a QuickJS interpreter of its own. |
| Plugins | `engine/plugins` | Folders of trusted engine code that a running world loads while it runs. |

The core in each place is the same `page/core.wasm`. The page instantiates it with no imports (`open` in `engine/page/bay.ts`), so every function the outside calls is a plain export.

## How a frame is made

`frame` in `engine/page/main.ts` runs once per animation frame:

1. Move the eye and step what the page simulates itself (people, the wand, street life).
2. `world.update` decides which sectors each box needs around the eye. It sends asks to the sector workers and uploads finished trees into the GPU pool.
3. One command encoder records the drawing, in this order: `march.draw` (the world's cells), the far model of distant tiles, sea fog, water, shade under things, road tracks, vehicle wheels, falling pieces, people, crumbs, smoke, then every plugin pass (`pluginDraws.draw`), then the wand's marker.
4. A final blit grades the picture onto the canvas, and `device.queue.submit` sends it.

Above a fixed height the planet view replaces the march. To measure what one step costs, leave it out from the browser console with `engine.off.add('people')`. The names are `water`, `under`, `wheels`, `pieces`, `people`, `crumbs`, `puffs`, `flames` and `spoil`.

## A shared world

`node serve.mjs --world FILE` (in `engine/`) keeps one world in a file and runs `world.mjs` behind the server. Pages open it with `/city?shared=1`. The page then uses `engine/page/link.ts` in place of the mover. The world process applies each ask, then sends the result down `GET /world/stream` as binary frames. Each frame has a 12-byte header (kind, number, length). The kinds are the constants in `engine/page/frames.ts`. A page applies only what the stream says, in the stream's order.

## Check a change

```sh
cd engine
npm ci
npm run core        # build the core to page/core.wasm
npm run check                 # cargo test, tsc, then page checks in Chrome
node test/all.mjs --changed   # only the checks that cover your branch's changes
```

`node test/bench.mjs` (in `engine/`) measures frame cost. Run it before and after a change to the march or the frame.

<!-- docs-verified 3351fa1b50cbe8f10801d860752f5fd32e583365 {"engine/page/main.ts":"08b27338e74ce5c370338986ba165220","engine/page/bay.ts":"1d6f3b4eef9ce809f9e1dee89c7da251","engine/page/frames.ts":"982add52463aa24c413035bc86d1cd99","engine/serve.mjs":"2d5671d556d6b81fdfcfc2b9f7efa827","engine/package.json":"8893b007c397bfd634d8b0b6589fa6b1"} -->
