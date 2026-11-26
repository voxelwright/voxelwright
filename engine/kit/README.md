# Voxelmorphism

A design language where every control is a small solid built from voxels. The rules are in
[SPEC.md](SPEC.md). Not published and not open source yet.

## Showcase

Start the showcase from the Voxelwright checkout.

```sh
cd engine/kit
PORT=5989 node tools/serve.mjs
```

Open [the showcase](http://127.0.0.1:5989/kit/showcase/). Signal Desk opens at the bare server address. Turn its dial, press a lamp key or change the enclosure. The build follows you through the parts catalog in the same tab. The original interactive rules are under Design notes.
Run `PORT=5989 node tools/links.mjs` to check every page. Run `PORT=5989 node tools/instrument.mjs` to exercise the build controls, lighting, phone navigation and renderer preference.

## Use

A page in the engine root can use the kit directly.

```html
<link rel="stylesheet" href="kit/voxelmorphism.css">

<button class="vx-button">Plant a seed</button>
<label class="vx-toggle"><input type="checkbox" role="switch"><span class="vx-switch"></span>Water daily</label>

<script type="module">
  import { adopt } from './kit/src/index.js';
  adopt();            // call again with a node after you add markup
</script>
```

The stylesheet alone is the plain version. Calling `adopt()` adds the voxels. Give the page `overflow-x: clip` (see Bleed in the spec).

The kit's `src/engine.js` imports the Voxelwright engine's WebGPU renderer from `../../blocks/renderer.ts`. The engine servers strip TypeScript types for the browser.
Run `npm pack` in this directory to package the same renderer as plain JavaScript.
Static generators can import `copyModules` from `voxelmorphism/browser` to write the kit,
renderer and desk modules into one public directory. Copy the exported stylesheet and its
adjacent fonts and notices into that directory’s `kit/` folder.

Its device takes a moment to arrive, so a page is plain first and `ready()` says when it is live:

```js
import { adopt, ready } from './kit/src/index.js';
adopt();                       // remembered until the renderer arrives; the page is plain meanwhile
const stage = await ready();   // the stage, or null if the page stays plain
```

Where there is no WebGPU the kit's own WebGL2 renderer stands in for now. To hand the kit another
backend, or none, call `use(renderer)` or `use(null)` before the first `adopt()`.

## What it exports

| Name | What it does |
|---|---|
| `fitInstrument({ shell, caps, profile, lamp, level, rail })` | Fit the enclosure, caps, profile and backlight to the lit kit. Signal Desk displays the case light as `steady` or `spectrum`. |
| `adopt(root?)` | Turn every part under `root` into voxels |
| `release(root?)` | Give them back to plain CSS |
| `live(el)` | The live model behind an element: `play('assemble' \| 'crumble')`, `spring()`, `rebuild()` |
| `define(def)` | Register a part of your own |
| `toast(text, { kind, duration })` | Show a toast; returns a function that dismisses it |
| `closeDialog(el, value)` | Close a dialog the way its own buttons do |
| `sound(on)`, `cue(name, { mass }?)` | Turn sound on from a user gesture; play a cue. A press or release is voiced for the cap the hand touched, or for `mass` square voxels |
| `plant(part, opts)`, `pot(part, …)`, `stageOf(g)` | The plant generator |
| `refresh(el)` | Redraw a part after changing what it is drawn from (values set from code are heard without it) |
| `use(renderer)`, `ready()` | Hand the kit another renderer, or `null` for none; know when the page is live |
| `defineMaterial(name, def)`, `MATERIALS`, `LIGHTS` | Materials and light |
| `Model`, `Part`, `Spring`, `assemble`, `crumble` | The pieces parts are made from |

## Fonts

Text is IBM Plex Sans and IBM Plex Mono, under the SIL Open Font License (`fonts/*/OFL.txt`).
Lettering is the kit's own glyph sets, Vox Block and Vox Sign, in `src/core/fonts/`, with flat
copies inlined in the stylesheet for the plain version. The words on keys are Vox Text
(`fonts/vox-text/`), the same glyphs as a font. Vox Zakon is a second face drawn after Zakon in
the same grid: a display set (`zakon.js`, its spacing in `zakon-spacing.js`), a key set and a
compact set of capitals (`zakon-text.js`), and its web fonts in `fonts/vox-zakon/`; a page picks
it by setting `--vx-key-font` to "Vox Zakon Text" (the SF realm does, `page/typeface.ts`). Latin and Ukrainian are drawn. The other folders in `fonts/` are the
candidates the type study compared (`showcase/type.html`); the kit does not load them.
