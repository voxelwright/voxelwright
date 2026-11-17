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

- Axes: x right, y down, z toward the viewer. `z = 0` is the page. **Nothing goes below the page**;
  a well is cut into a slab that stands on it. Anything pushed below `z = 0` is hidden by the page.
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
| Chalk | `#fbfcff` | `#303a7c` | Surfaces that carry content: cards, dialogs, menus, the floor of a field |
| Slate | `#c3c9de` | `#161c4f` | Trays, tracks and rims |
| Steel | `#aab1c9` | `#59629c` | Housings, and anything switched off |
| Ivory | `#fbfcff` | `#ccd1f2` | The knob of a switch, and icons on enamel: it stays light at night so it can be found |
| Walnut | `#7c4a29` | `#5a3520` | Structure that carries other things: shelves, frames |
| Leaf | `#23a84b` | `#2ec25c` | Growth, progress, "it went well" |
| Brick | `#e0331f` | `#ff5340` | Destructive actions, failure, pots |
| Ink | `#0a0f3d` | `#eceefb` | Lettering and icons in voxels |
| Soil, stem, petal, lamp | | | The garden and light sources |

- Text on enamel and brick is white. Text on signal is ink `#0a0f3d` in both themes. Text on chalk
  is `--vx-ink`. Body text contrast is 7:1 or better; quiet text is 4.5:1 or better.
- One enamel thing per group: enamel marks the main action. Secondary buttons are chalk.
- Signal is never decoration. If nothing is on or current, nothing is yellow.
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
| Rest | 3 voxels | Can be pressed |
| Hover (mouse only) | 3.5 | You are on it |
| Pressed | 1 | Is being pressed |
| Disabled | 1, in steel | Cannot be pressed |
| Card, list tile | 2 | Holds content, is not pressed |
| Menu, toast | 4 | Floats over the page for a moment |
| Dialog | 6 | In front of everything, over a scrim of ink at 50% |
| Well (field) | floor 1 below its rim | Takes input |

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
  Voxels are set in place lowest layer first, in a front that sweeps outward from an origin, each
  dropping in from the viewer's side with 5 to 10% overshoot and growing from nothing over 75 ms.
  One voxel takes 140 to 200 ms; the whole build takes 200 ms (menu), 300 ms (toast), 460 ms
  (dialog). The first block lands on the frame of the input. Gaps shrink toward the end, and 5%
  noise keeps the front from being a wipe. Words appear once there is a slab to carry them.
- **Origin.** A menu is built out of the corner nearest its trigger. A dialog is built from its
  centre. A toast is built from its stripe.
- **Crumble** marks removal: voxels fall down the page, spinning, and shrink away. 280 to 340 ms,
  always shorter than the build. Content fades out in 80 ms first, so text is never seen breaking.
- **Never** assemble something because it scrolled into view, and never on page load except one
  orchestrated moment the page chooses. Nothing moves while someone reads.
- **Break and mend** (the sign): a poke knocks the lettering under the pointer loose; pieces fly
  for 0.55 to 1.05 s, then are pulled home by a critically damped spring. It can be poked again
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
  part, using `:focus-visible`. A focused field also changes its rim to enamel.
- Keyboard-driven changes do not animate: arrow keys in tabs and menus move at once.
- Hit targets are at least 11 voxels (44 px) tall.
- Lettering in voxels (the sign, and headings set with `data-vx-board="none"`) keeps its text in
  the DOM for readers, wraps to fit its column and balances its lines.
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

## 12. How it is drawn

- One WebGL2 context serves the whole page. Each part is drawn into a corner of that context's
  canvas and copied to the part's own small 2D canvas, which sits behind the part's content. So
  parts need no context of their own, layer correctly inside dialogs and popovers, and scroll with
  the page for free.
- At rest nothing runs: no frame loop, no timers. A part is redrawn only when its state changes.
  Parts off screen are not drawn until they come near.
- Voxels are instanced cubes with per-voxel colour, corner occlusion and a seam; one extra pass
  draws depth from the light. A button is about 500 voxels; a dialog about 6,000.
- **Bleed.** A part's canvas is larger than its box by 5 to 16 voxels a side, for its shadow and
  for pieces in flight. Give the page `overflow-x: clip` so bleed never widens it, and do not put a
  part inside `overflow: hidden` unless you mean to cut its shadow.
- The renderer is behind one call, `Renderer.draw(frame, ctx2d)`. Another backend (the Village
  engine, WebGPU) can replace it without touching a part.

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

- `part.box`, `part.slab` (stepped corners), `part.carve`, `part.text` (Vox Sign lettering),
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

## 15. The kit

Button (with icons: chevron, plus, check, cross, drop, seed), toggle, slider, text field, note
card, list, menu, dialog, tabs, meter (plain and growth), toast. Also the sign (voxel lettering
that breaks and mends, on a board or bare as a heading) and the block (one solid).
Markup for each is at the top of its file in `src/components/`.
