# blocks

The WebGPU renderer that draws the Voxelmorphism kit's controls as real voxel blocks. The kit
(`../kit`) builds each control as a model of cubes and calls `draw(frame, canvas)` when it
changes. This folder turns that into a picture in the control's own canvas, and draws nothing
at rest. How it works, what it costs and who uses it: [Blocks and the Vox fonts](../../guide/blocks-and-fonts.md).

## Files

| File | What it is |
| --- | --- |
| `pass.ts` | The block pass: depth from the light, then the picture (page plane, ground shadow, cubes, halos). `Frame` is the format the kit hands over. |
| `stage.ts` | The page stage: one device, the block pass, sheets drawn once a turn and copied to each part's canvas. Recovers a lost device. |
| `renderer.ts` | `renderer()`: the kit's renderer on the page stage, or `null` without WebGPU. |
| `world.ts` | `stand(on, kit, where)`: a panel of kit parts drawn inside a 3D world. |
| `serve.mjs` | A local server for the kit's showcase on this renderer and for `proof/`. |
| `proof/check.html` | Parts made by hand, for the check below. |

The kit loads `renderer.ts` by its TypeScript name (`../kit/src/engine.js`). Every engine
server strips types as it serves a `.ts` file. `npm run player` writes the same modules as plain
JavaScript under `dist/`.

## Check

Run from `engine/`:

```sh
node test/blocks.mjs
```

It starts this folder's server on a free port, drives `proof/check.html` in the installed
Chrome with WebGPU, and prints `ok` or `FAIL` per line, then `PASSED`. It is the `blocks` entry
in `npm run check`.

## See the kit drawn by it

```sh
node blocks/serve.mjs                 # http://127.0.0.1:5990/kit/showcase/
node blocks/serve.mjs --port 5991
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--port` | `5990` | Port on 127.0.0.1. |
| `--reports` | `~/.village/engine/blocks/reports.jsonl` | Where a page's `POST /report` lines are appended. Real Safari can be opened but not driven, so a measuring page reports itself. |

The server only sends files under `blocks/`, `probe/`, `kit/`, `landing/`, `page/` and `core/`, strips types from `.ts`, and
answers only requests addressed to `127.0.0.1`, `localhost` or a `.ts.net` name. The root path is not mapped: open
`/kit/showcase/`, `/blocks/proof/` or `/blocks/proof/check.html`.

The kit's own server (`../kit/tools/serve.mjs`) also serves this renderer and is the one the
kit's tools expect. Use this one when you work on the renderer itself.

## Proof scripts

The pages and scripts in `proof/` (`index.html`, `proof.js`, `run.mjs`, `look.mjs`,
`showcase.mjs`, `cost.mjs`, `stand.mjs`) run against `node blocks/serve.mjs` (default port `5990`).
They were the measurements behind choosing one canvas per part. The findings are in the guide page and in the `raw-webgpu` skill
(`../../.agents/skills/raw-webgpu/SKILL.md`).
