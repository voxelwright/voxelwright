# Voxelmorphism

Skeuomorphism painted controls to look like real materials. Voxelmorphism builds them: every
control is a small solid made of voxels, lit by one light. It continues the rooftop billboards of
the zahynailo.dev landing world, which are voxels that break and mend, and commits to the idea for
a whole interface.

This file is the rule book. `voxelmorphism.css` and `src/` implement it; `showcase/` shows it.

## 1. Principles

1. **The voxel is the unit.** Every size is a whole number of voxels. Nothing is a fraction of a block.
2. **The front face sits on the pixel grid.** The view is a fixed projection, not a camera, so text
   stays sharp and a control is where its box says it is.
3. **Height says what you can do.** Proud means press me. A well means type here. Low means off.
4. **Material says what it is for.** Colour is a material, and a material has one job.
5. **One light, real shadows.** Light comes from the top left. Shadows are cast, never painted.
6. **Things are built, and they break.** Making and unmaking are shown. Nothing else is animated
   for show.
7. **The HTML is the interface.** Voxels are drawn over real controls. Take the voxels away and
   everything still works.

## 2. Grid and scale

- One voxel is `--vx`, 4 px by default. Set `--vx` on any element to scale everything inside it.
  Useful values: 2 px (dense tools), 3 px, 4 px (default), 6 px and 8 px (display, touch-first).
- Keep `--vx` times the device pixel ratio a whole number where you can, so faces are crisp.
- Sizes in voxels:

| Thing | Voxels | At 4 px |
|---|---|---|
| Smallest hit target (button, tab, list row, field) | 11 tall | 44 px |
| Switch | 16 by 8 | 64 by 32 px |
| Slider | 11 tall (the thumb is 9), thumb 5 wide | 44 px |
| Gap between tiles in a tray | 1 | 4 px |
| Button side padding | 5 | 20 px |
| Card padding | 5 by 6 | 20 by 24 px |
| Corner step | 1 (controls), 2 (slabs that hold content) | |

- An element whose size is not a whole number of voxels (a button sized by its text) gets a model
  of the whole voxels that fit, centred. The leftover is under one voxel.
- Corners are stepped, never rounded. `border-radius` is always 0.

## 3. Projection

- Axes: x right, y down, z toward the viewer. `z = 0` is the page. The page is solid: anything
  pushed below `z = 0` is hidden by it. The one exception is a **well**, a hole cut in the page
  for a text field: its floor is two voxels down, and you see it, and the inner faces of its far
  walls, only through the hole. A well casts no shadow on the page, because nothing stands on it.
- Cabinet projection: a point at height `z` is drawn `z / 2` voxels to the right and `z / 2` down.
  The viewer stands up and to the left, so you see the top and the left side of everything.
- The face that carries a label lands exactly on the element's box when the control is at rest.
  When that face moves (a press), its label moves with it by the same shift.
- Where labels must share a baseline (tabs), move the block under the label, not the label.

## 4. Materials

A material is a front-face colour for day and one for night, a grain (how much one voxel differs
from the next), and whether it glows at night.

| Material | Day | Night | Job |
|---|---|---|---|
| Enamel | `#0e22ff` | `#2b3dff` | Things you act on: the main button, a picked menu item, a slider thumb, a focused rim |
| Signal | `#fff600` | `#fff600`, glows | Where you are and what is on: the chosen tab, a lit track, the current row |
| Chalk | `#fbfcff` | `#3a4692` | Surfaces that carry content: cards, dialogs, menus, the floor of a field |
| Slate | `#c3c9de` | `#222963` | Trays, tracks and rims |
| Steel | `#aab1c9` | `#33375a` | Housings, and anything switched off |
| Ivory | `#fbfcff` | `#ccd1f2` | The knob of a switch, and icons on enamel: it stays light at night so it can be found |
| Walnut | `#7c4a29` | `#5a3520` | Structure that carries other things: shelves, frames |
| Leaf | `#23a84b` | `#2ec25c` | Growth, progress, "it went well" |
| Brick | `#e0331f` | `#ff5340` | Destructive actions, failure, pots |
| Ink | `#0a0f3d` | `#eceefb` | Lettering and icons in voxels |
| Soil, stem, petal, lamp | | | The garden and light sources |

- Text on enamel and brick is white. Text on signal is ink `#0a0f3d` in both themes. Text on chalk
  is `--vx-ink`. Body text contrast is 7:1 or better; quiet text is 4.5:1 or better.
- One enamel thing per group: enamel marks the main action. Secondary buttons are chalk.
- Signal is state, never an action and never decoration: no yellow buttons. If nothing is on or
  current, nothing is yellow.
- At night, order by lightness is ground, slate, steel, chalk: a disabled control (steel) is
  always duller than a live one beside it.
- Add a material with `defineMaterial(name, { day, night, jitter, glow })`. Give it one job.

## 5. Light

- One light, from the top left and a little toward the viewer: direction `(-0.5, -0.7, 0.6)`.
- Tones on a material: the top face is lightest (about 18% toward white), the front is the true
  colour, the left side is darkest (about 78%), faces in shadow lean cool.
- Each voxel edge carries a seam one device pixel wide, 5% darker (8% at night), so the grid can
  be counted. Each voxel varies in lightness by the material's grain. Keep both quiet: the surface
  pattern must never be louder than the shape. Shape is what says "block".
- Corners where voxels meet are darkened (ambient occlusion, three steps), so wells and joints read.
- Shadows come from a depth map drawn from the light, with a penumbra of about a fifth of a voxel:
  hard enough to read as cast by a block, never a soft glow. A shadow travels 0.83 voxels right and 1.17 down per voxel
  of height. Page shadow colour: deep blue at 30% by day, near black at 55% by night.
- **Night.** Dark mode is night, not an inversion. Materials keep their identity, the light drops,
  and signal and lamp voxels glow: they keep half their shading, so their sides still read, and
  throw a faint halo of about 2.4 voxels. Chalk, slate and steel stay well clear of the ground
  colour at night; a control that cannot be seen is not dark mode, it is broken.

## 6. Depth and press

| State | Height of the face | Meaning |
|---|---|---|
| Rest | 4 voxels | Can be pressed |
| Hover (mouse only) | 4.5 | You are on it |
| Pressed | 1 | Is being pressed |
| Disabled | 1, in steel | Cannot be pressed |
| Card, list tile | 2 | Holds content, is not pressed |
| Menu, toast | 4 | Floats over the page for a moment |
| Dialog | 6 | In front of everything, over a scrim of ink at 50% |
| Well (field) | floor 2 below the page | Takes input |

- A button is a keycap: a body, and a top one voxel smaller all round. The step is what makes it
  read as a block at arm's length. Shadow length follows height, so the scale above is visible.
- A trigger stays down while what it opened is open, and carries a chevron in voxels.
- Press responds on pointer down, in the same frame. The press spring settles in about 110 ms
  (`k = 1500, c = 76`); release takes about 190 ms with one soft overshoot (`k = 620, c = 34`).
- Sliders: while the pointer is down the thumb follows the value exactly. No easing, no spring.
- Switches and tabs slide on a spring with a little carry (`k = 420, c = 30`, about 220 ms).
- Hover lift is half a voxel and only for a mouse. Touch never hovers.

## 7. Motion: building and breaking

Decide by how often it happens (from the site-craft rules):

| How often | Example | Motion |
|---|---|---|
| Many times a minute | Keyboard focus, arrow keys in tabs or a menu, typing | None. States swap. |
| Many times a visit | Press, hover, moving through a menu | Press spring; the menu tile jumps |
| Occasionally | Opening a menu or a dialog, a toast | Built: 200 to 460 ms |
| Rarely | The sign, a bloom | Delight lives here |

- **Assembly** marks the moment a thing is made: a dialog opens, a toast arrives, a note is added.
  The thing rises out of the page in **bricks**: voxels are grouped into bricks of 2 to 7 voxels,
  laid in a running bond, and each brick moves as one piece. A brick grows up through the page's
  surface, overshoots by about 8% and settles; the page hides whatever is still below it, so
  nothing is ever suddenly there and no frame is noise. One brick takes 170 ms; the whole build
  takes 200 ms (menu), 300 ms (toast), 460 ms (dialog). The first brick moves on the frame of the
  input. Words appear once there is a slab to carry them (340 ms into a dialog).
- **Order.** By default courses are laid from the bottom-left corner upward. A menu is built out
  of the corner nearest its trigger, a dialog from its centre, a toast from its stripe.
- **Crumble** marks removal: the thing breaks into the same bricks, which fall down the page
  turning as they go and shrink away at the end. 270 to 340 ms, always shorter than the build.
  Content fades out in 80 ms first, so text is never seen breaking.
- Never build or break in single voxels. A cloud of single voxels reads as static, not as blocks.
- **Never** assemble something because it scrolled into view, and never on page load except one
  orchestrated moment the page chooses. Nothing moves while someone reads.
- **Break and mend** (the sign): a poke knocks the lettering under the pointer loose. It breaks
  into single voxels, the one place single voxels fly. They fly for 0.5 to 1.15 s, then are pulled
  home by a critically damped spring. It can be poked again
  at any time; nothing is a keyframe.
- **Growth.** A plant's voxels each have a birth between 0 and 1. Showing the plant at `g` shows
  every voxel born by then; each takes 140 ms to appear once its moment has come, however fast the
  value moves. The value itself follows a calm spring (`k = 170, c = 26`).
- Everything a hand can touch is a spring or a per-frame effect, so it can be interrupted and
  retargeted. Input is never blocked while something plays.

## 8. Sound

- Off by default. Nothing sounds, and no audio context exists, until the page calls `sound(true)`
  from a click or a key press.
- Every sound is synthesised: wooden tocks, because voxels are blocks. Each has a small random
  pitch (plus or minus 6%), is shorter than 250 ms, and is quieter than speech.
- Cues: `press`, `release`, `slide`, `tick` (a slider step), `build`, `break`, `poke`, `done`,
  `failed`. The picture changes first; the sound follows in the same frame.
- A hidden tab is silent.

## 9. Light and dark

- `--vx-theme` is `day` or `night`. It follows `prefers-color-scheme`, and `data-theme="light"` or
  `"dark"` on the root overrides it. The script reads the variable, so CSS decides the theme.
- Both are designed. Day: overcast ground `#e4e8f4`, ink `#0a0f3d`. Night: ground `#080b28`, ink
  `#eceefb`. No pure black, no pure white for text.
- A world with a time of day (the landing page) can set `data-theme` from its clock.

## 10. Accessibility

- Every part is a real control: `button`, `input type="checkbox" role="switch"`, `input
  type="range"`, `input`, `textarea`, `dialog`, a popover with `role="menu"`, `role="tablist"`,
  `progress`. Names, roles, states and keyboard behaviour come from the HTML.
- The canvas is `aria-hidden`, takes no pointer events and is never focusable.
- Focus is a 2 px outline with an offset, in enamel by day and signal by night, on every focusable
  part, using `:focus-visible`. A focused field also changes its walls to enamel.
- Keyboard-driven changes do not animate: arrow keys in tabs and menus move at once.
- Hit targets are at least 11 voxels (44 px) tall.
- Lettering in voxels (the sign, and headings set with `data-vx-board="none"`) keeps its text in
  the DOM for readers, wraps to fit its column and balances its lines.
- A dialog may be modal (`showModal()`) or not (`show()`, when the page behind must stay usable
  while a setting changes). Both build and crumble the same way; only a modal one has a backdrop.
- A value set from code (`input.value = 3`, `input.checked = true`) is drawn at once, with no
  sound and no slide: the hand did not move it. `vx-change` fires only when a person chooses.
- Toasts are `role="status"`, or `role="alert"` for a failure. Their clock stops on hover and
  while the tab is hidden.
- **Less motion** (`prefers-reduced-motion: reduce`): the voxels stay; travel goes. Builds and
  breaks become a 160 ms change of scale in place, the sign does not break, springs still give
  press feedback because that explains a state.

## 11. The plain version

- `voxelmorphism.css` alone is a complete interface: flat faces, two borders for the top and the
  side of a button, hard offset shadows. It is what shows with no script, with no WebGL2, or with
  `data-vx-plain` on the root.
- A part becomes voxels when the script gives it `data-vx-live`; its painted faces then step aside.
  `release()` gives it back.
- The plain version uses the same tokens, sizes and focus rules, so switching changes the surface
  and nothing else.

- If the renderer loses its device and can get no other, it says so (`onfail`) and every part
  goes back to plain CSS at once, with its behaviour. Nothing is ever left live without a face.
- **Behaviour without voxels.** Tabs, a dialog's `data-vx-close` buttons and a menu need script
  to behave. `adopt()` wires that behaviour when the page is plain too (it draws nothing), so a
  plain page needs no handlers of its own. With no script at all, tabs are buttons that do
  nothing: put the first panel's content where it can be read.
- A trigger whose panel is open (`aria-expanded="true"`) stays pressed, plain or live.

## 12. How it is drawn

- Each part has its own small canvas, which sits behind the part's content. So parts layer
  correctly inside dialogs and popovers and scroll with the page for free.
- **Two renderers draw into those canvases, and they draw the same picture.** The Village
  engine's (WebGPU, `src/engine.js`) draws straight into each part's canvas. The kit's own
  (WebGL2, `src/core/gl.js`) draws into one hidden canvas and copies. The engine's is the one the
  kit is going to: `use(renderer())` hands it over, and `gl.js` goes once the engine's has been
  seen on an iPhone. `src/engine/` is a copy of the engine's built modules, made by
  `node tools/sync-engine.mjs <Village engine folder>`; `ENGINE.json` there says which commit.
  `PORT=5986 node tools/serve.mjs --engine` serves every page on it, and every tool runs
  against that port unchanged.
- At rest nothing runs: no frame loop, no timers. A part is redrawn only when its state changes.
  Parts off screen are not drawn until they come near.
- Voxels are instanced cubes with per-voxel colour, corner occlusion and a seam; one extra pass
  draws depth from the light. A button is about 500 voxels; a dialog about 6,000.
- **Bleed.** A part's canvas is larger than its box by 5 to 16 voxels a side, for its shadow and
  for pieces in flight. Give the page `overflow-x: clip` so bleed never widens it, and do not put a
  part inside `overflow: hidden` unless you mean to cut its shadow.
- The renderer is behind one call, `draw(frame, target)`. The target is the part's 2D context,
  or the part's canvas itself for a renderer that says `ownsCanvas: true` and draws into each
  canvas with its own context (measured in real Safari with 59 parts redrawn every frame: 29 ms
  a frame that way, against 159 copying from one WebGPU canvas and 378 for the WebGL2 stand-in). `use(renderer)` hands the kit another
  backend (the Village engine, WebGPU) without touching a part. It takes a renderer or a promise
  for one, because a WebGPU device takes a moment to arrive: until it does the page is plain,
  `adopt()` and `release()` are remembered in order, and `ready()` resolves to the stage, or to
  null if no renderer came. A part is never marked live before something can draw it.

## 13. Writing a part

A part is a selector and a function that fills a model with boxes.

```js
import { define, adopt } from 'voxelmorphism';

define({
  name: 'plinth',
  selector: '.my-plinth',
  build(live, model) {
    const { W, H } = live;                          // the element's size, in voxels
    model.part('base').slab(0, 0, 0, W, H, 2, 'walnut', 1);
    const cap = model.part('cap');
    cap.grounded = false;                           // it rests on the base, not the page
    cap.slab(1, 1, 2, W - 2, H - 2, 2, 'chalk', 1);
    live.faceZ = 4;                                 // the face that lands on the element's box
  },
  pose(live) { live.model.byName.cap.tz = live.spring('press').x; },
  bind(live) { /* add listeners; return a function that removes them */ },
});
adopt();
```

- `part.box`, `part.slab` (stepped corners), `part.carve`, `part.text(str, x, y, z, depth, material, scale, font)` (lettering),
  `part.plot(x, y, z, material, birth)`.
- `live.spring(name)` gives a spring; `live.play('assemble' | 'crumble', parts, opts)` returns a
  promise; `live.label(node, () => z)` keeps a DOM node on a moving face.
- A part must look finished in the plain version first. Write its CSS, then its voxels.

## 14. Rehearse

Looking at one screenshot misses motion. Before a motion is done, film it and read every frame.

```sh
node tools/film.mjs                 # every scene
node tools/film.mjs dialog-open --dark
```

- Time is stepped by hand (`stage.manual = true`, `stage.advance(1 / 60)`), so the film is the same
  on any machine. Each scene becomes a contact sheet in `shots/film/` with the time on every frame.
- The report reads the voxels themselves and prints, per scene: how long it took to settle against
  the range this spec gives, and any `no response` (nothing changed on the frame of the input),
  `pop` (voxels that appear at over a third of their size in one frame), `snap` (a voxel that moves
  far more in one frame than in the frames around it) or `empty frame`.
- `rehearsal passed` is necessary, not sufficient. Then read the sheet: does the first frame answer
  the input, does anything arrive before the thing that carries it, is any frame just noise?
- Do not clear a line by hiding what it points at. The one exception is marked in code: voxels that
  appear inside another solid (`part.covered`), such as a lit track under its knob.

The idea of filming your own work and gating on it comes from Benji Taylor's Stageshow skill
(MIT). Its own scripts film a React stage; this tool is ours because it has to read a canvas.

## 15. Type

There are two kinds of type, and they do not mix: lettering built from voxels, and text set in a
text face on top of them.

- **Lettering** is for the sign and for headings. The glyph set is **Vox Block**: capitals eleven
  cells tall (the height of a button) with a two-cell stroke, drawn so every counter stays open at
  one voxel per cell. It is never enlarged to make it fit: a heading is one voxel per cell, a
  board may go to two. Where a column is too narrow for it (a board on a phone) the part falls
  back to **Vox Sign**, five cells by seven. Lettering is capitals only.
- Spacing, kerning and line gaps are in whole cells and belong to the glyph set. Depth follows
  scale: one voxel deep at one voxel per cell. At two or more voxels per cell diagonals are
  redrawn as stairs of single voxels, not enlarged.
- **The plain version of lettering is the same glyphs as a flat font** (inlined, about 2 KB a
  set), sized ten voxels to the em and trimmed to the cap line and baseline. A heading therefore
  has the same box with and without voxels, and nothing moves when they arrive. A board cannot
  ask the script which glyph set fits, so a page that knows its own word sets the steps with a
  container query (see the showcase). `node tools/shift.mjs <page>` measures what moves.
- **Text** is IBM Plex Sans, with IBM Plex Mono for code: sturdy at 14 to 20 px, level in its
  box, with a 1 that has a foot. Weights 400 to 700 only; nothing is faux bold. Everything you
  read or type is text.
- **Legends**, the words on keys (buttons, tabs, menu items), are set in **Vox Text**: the voxel
  glyphs laid flat as a font, so what is written on a key is cut from the same cells as the key.
  Five voxels to the em (`--vx-key-size`), so one cell is half a voxel and every edge lands on a
  pixel. Two weights, 400 and 700. A page that wants one voice instead sets
  `--vx-key-font: var(--vx-font)`.
- Gaps and line heights are whole voxels wherever the page can manage it. That, more than the
  face, is what keeps both kinds of type sharp on a 1x display.
- **Ukrainian** is drawn in all three glyph sets (33 letters; shapes shared with Latin are
  aliases, not copies) and in Vox Text. Plex's Cyrillic is a separate file behind
  `unicode-range`, fetched only by a page that has Cyrillic in it.
- Lowercase in lettering exists as a set (Vox Sentence) and is not used: headings are capitals.
- Chosen by the owner after a study with five review rounds on real parts
  (`showcase/type.html`, and `?lang=uk` for Ukrainian).

## 16. The kit

Button (with icons: chevron, plus, check, cross, drop, seed), toggle, slider, text field, note
card, list, menu, dialog, tabs, meter (plain and growth), toast. Also the sign (voxel lettering
that breaks and mends, on a board or bare as a heading) and the block (one solid).
Markup for each is at the top of its file in `src/components/`.
