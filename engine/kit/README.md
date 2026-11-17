# Voxelmorphism

A design language where every control is a small solid built from voxels. The rules are in
[SPEC.md](SPEC.md). Not published and not open source yet.

## Use

```html
<link rel="stylesheet" href="voxelmorphism/voxelmorphism.css">

<button class="vx-button">Plant a seed</button>
<label class="vx-toggle"><input type="checkbox" role="switch"><span class="vx-switch"></span>Water daily</label>

<script type="module">
  import { adopt } from './voxelmorphism/src/index.js';
  adopt();            // call again with a node after you add markup
</script>
```

There is no build step and no dependency. The stylesheet alone is the plain version; `adopt()`
adds the voxels where WebGL2 exists. Give the page `overflow-x: clip` (see Bleed in the spec).

To draw with another backend, hand it over before the first `adopt()`:

```js
import { use, adopt, ready } from './voxelmorphism/src/index.js';
use(makeRenderer());   // a renderer with draw(frame, ctx2d), or a promise for one
adopt();               // remembered until the renderer arrives; the page is plain meanwhile
const stage = await ready();   // the stage, or null if the page stays plain
```

## What it exports

| Name | What it does |
|---|---|
| `adopt(root?)` | Turn every part under `root` into voxels |
| `release(root?)` | Give them back to plain CSS |
| `live(el)` | The live model behind an element: `play('assemble' \| 'crumble')`, `spring()`, `rebuild()` |
| `define(def)` | Register a part of your own |
| `toast(text, { kind, duration })` | Show a toast; returns a function that dismisses it |
| `closeDialog(el, value)` | Close a dialog the way its own buttons do |
| `sound(on)`, `cue(name)` | Turn sound on from a user gesture; play a cue |
| `plant(part, opts)`, `pot(part, …)`, `stageOf(g)` | The plant generator |
| `refresh(el)` | Redraw a part after changing what it is drawn from (values set from code are heard without it) |
| `use(renderer)`, `ready()` | Hand the kit another renderer; know when the page is live |
| `defineMaterial(name, def)`, `MATERIALS`, `LIGHTS` | Materials and light |
| `Model`, `Part`, `Spring`, `assemble`, `crumble` | The pieces parts are made from |

## Fonts

Text is IBM Plex Sans and IBM Plex Mono, under the SIL Open Font License (`fonts/*/OFL.txt`).
Lettering is the kit's own glyph sets, Vox Block and Vox Sign, in `src/core/fonts/`, with flat
copies inlined in the stylesheet for the plain version. The words on keys are Vox Text
(`fonts/vox-text/`), the same glyphs as a font. Latin and Ukrainian are drawn. The other folders in `fonts/` are the
candidates the type study compared (`showcase/type.html`); the kit does not load them.
