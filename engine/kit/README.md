# Voxelmorphism

The UI kit every Voxelwright interface is built from: a design language where every control is a
small solid object built from voxels. Plain HTML and CSS carry the interface; where a renderer is
available, the kit draws each control as cubes behind its content. This README is for someone
working in this folder. The concepts, the parts list and the API are in the guide:
[The kit](../../guide/kit.md). The renderer and the Vox fonts: [Blocks and the Vox fonts](../../guide/blocks-and-fonts.md).

The code is Apache-2.0 (`LICENSE`). The fonts are under the SIL Open Font License and the keyboard
recordings under MIT; `NOTICE` lists all three.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/index.js` | The public API and `components`, the list of registered parts |
| `src/components/` | One script per part, each opening with a comment that describes it |
| `src/core/` | The stage, model, materials, light, looks, motion, sound, glyph sets, and the WebGL2 stand-in (`gl.js`) |
| `src/looks/` | The lit look (`lit.js`), the instrument and its fittings |
| `src/engine.js` | Re-exports the engine's WebGPU renderer from `../blocks/renderer.ts` |
| `css/` | `_kit.css` (tokens and the first parts) and one sheet per part |
| `voxelmorphism.css` | Generated from `css/` by `tools/css.mjs`. Never edit it by hand |
| `fonts/` | IBM Plex, the Vox faces, and the faces the type study compared |
| `showcase/` | Signal Desk, the parts catalogue (`showcase/parts/`) and design studies |
| `tools/` | The local server and the checks |
| `browser.mjs` | `copyModules(out)`, for static hosts and `npm pack` |
| [SPEC.md](SPEC.md) | The rule book: grid, projection, materials, light, depth, motion, sound, accessibility |
| [BUILDING.md](BUILDING.md) | How to build a part, and which tool each part uses |
| [HILL.md](HILL.md) | The gates every change passes, and how a change to the look is judged |

## Run the showcase

```sh
cd engine/kit
PORT=5989 node tools/serve.mjs
```

Open [the showcase](http://127.0.0.1:5989/kit/showcase/). The bare server address opens Signal
Desk: turn its dial, press a lamp key or change the enclosure. Without `PORT` the server uses 5985.
These docs use 5989; give every tool the same `PORT` as the server.

The server sends the `kit/`, `blocks/` and `probe/` folders of `engine/`, with TypeScript types
stripped, so the kit's pages run on the engine's renderer straight from the checkout.

## Use it on a page

```html
<link rel="stylesheet" href="kit/voxelmorphism.css">
<button class="vx-button">Plant a seed</button>
<label class="vx-toggle"><input type="checkbox" role="switch"><span class="vx-switch"></span>Water daily</label>
<script type="module">
  import { adopt } from './kit/src/index.js';
  adopt();            // call again with a node after you add markup
</script>
```

The stylesheet alone is the plain version, and `adopt()` adds the voxels. Give the page
`overflow-x: clip`, because a part's canvas is larger than its box. A static site can import
`copyModules` from `voxelmorphism/browser` to write the kit and its renderer into one public
folder, then copy the stylesheet, `fonts/` and `NOTICE` beside it.

## Check a change

Run from `engine/kit` with the showcase server up:

```sh
node tools/css.mjs --check              # voxelmorphism.css is what css/ makes
PORT=5989 node tools/links.mjs          # every showcase page loads
PORT=5989 node tools/instrument.mjs     # Signal Desk's controls, lighting, phone layout, renderer choice
PORT=5989 node tools/parts.mjs          # every part page and every part's own check
```

The full set of gates is in [HILL.md](HILL.md). Visual changes follow the `ui-craft` skill
(`../../.agents/skills/ui-craft/SKILL.md`). The site's tailored build of the kit is checked by
`npm test` in `site/`.
