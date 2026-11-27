# Voxelmorphism

Skeuomorphism painted controls to look like real materials. Voxelmorphism builds them: every
control is a small solid made of voxels, lit by one light.

This file is the rule book, for anyone building or changing a part: the exact sizes, colours,
heights, timings and behaviours every part obeys. The overview is in the guide
([The kit](../../guide/kit.md)); how to build a part is in [BUILDING.md](BUILDING.md). Paths and
commands here start in `engine/kit`. `voxelmorphism.css` and `src/` implement it. Open the
examples at `http://127.0.0.1:5989/kit/showcase/` (`PORT=5989 node tools/serve.mjs`).

## Hardware look

Set `data-vx-look="lit"` on a region to use the hardware shown in
[the deploy panel](showcase/lit.html?still) and [the parts](showcase/parts/).
The following dimensions apply to this look. The original showcase illustrates
the construction rules in the numbered sections.

- A full enclosure has fourteen courses, from its inset foot through the casting and gasket
  to the removable cover. A cover wider than 100 voxels and at least 46 voxels tall
  carries four slotted steel screws. The top lip occupies a shared inset in the case.
  Tabs can sit on the cover with the words clear of its lip.
  Narrow enclosures have eight courses and a clear cover. Small plates use five.
  A steel bezel captures the slide paddle, and a steel socket seats each pilot lamp.
- Keys stand on light. Close is a seven-by-five thumb plate, one course thick, in a steel socket.
  It travels one course and keeps a 44 px hit target. An ordinary key rises six courses. The
  main key rises eight, with blue enamel and 2.6 times the local light.
- Follow seats four courses down. Follow, tabs, single-choice key banks and page buttons
  uncover the same fixed diffuser behind a sliding shutter. The end lamps dim with travel
  and go dark when the shutter closes. The slot stays inside its seat and has at least four
  clear pixel rows below the legend at the default scale. Inline keyboard shortcuts use miniature keycaps. Give each cap a visible
  top for its legend and a sidewall above the support. Its silhouette identifies the physical key.
  Keep the native `<kbd>` inline and outside the tab order.
- The kit supplies an optional finish per material to renderers that support it. Ordinary
  cubes use full chamfer and zero gloss. Steel and enamel catch direct light. The well
  floor is matte. The ground filter spans one voxel at the default four-pixel scale.
- One warm tube lights the header groove. The idle well walls emit no light. The deploy log has a passive warm reflection on its lower inside edge. Set `?log=quiet` on the demo for the unlined well. A pale slide paddle reveals a green slit. Pilot lamps light their socket locally.
- Two dark cells separate each pair of meter lamps. A warning uses amber in the daytime.
  A destructive menu row carries a red tracking light when selected.
- The chart opens at the reading in its table and animates a subsequent change.

## Slim HUD look

Set `--vx-look: slim` on a region (`src/looks/slim.js`, inheriting from `lit`) for a compact,
low-profile hardware tier suited to live gameplay HUDs over a 3D scene:

- Keys rise 3 courses (1.5-course travel) with no outer collar, using `--vx: 2px` so cabinet
  overhang stays within a few CSS pixels while chamfered octagonal silhouettes and backlit
  under-rings remain legible.
- Smoked translucent polycarbonate (`chalk`, `key`, `transmission: 0.14–0.15`) lets the world
  breathe through with physical Fresnel edge gleam while holding contrast over both bright sky and
  dark streets; primary/active keys use deep cobalt enamel (`transmission: 0.06`) with an optional
  top status LED bar.
- Small cue cards use 2 courses with a 1-voxel left accent edge; larger panels (such as the
  Settings drawer at `--vx: 3px`, in the first view and in play) use 4 courses with no top bolt shoulder.
- The realm's first view uses this look too (`#first`, the settings key and panel), so that the
  landing and play read as one device (#75).
- A floating touch thumbstick recess (`.vx-recess.float`) builds a hollow stepped octagonal gimbal
  ring with backlit cardinal ticks so the world shows through its interior, paired with a sculpted
  concave voxel thumbstick cap (`[data-vx-stick-cap]`).
- Its icon set (`SLIM_ICONS`, for `data-vx-icon`) adds a media player's: `play`, `pause`, `stop`, `next`, `sound`,
  `muted`, `minimize` and `playing` (level bars), drawn 7 to 9 cells tall to sit crisp at 2 px a cell.

## 1. Principles

1. **The voxel is the unit.** Size every part in whole voxels. Build the cap, mount and light
   fittings from cells in the shared model. Highlights can soften a face, and a spring can move it between grid
   positions. Magnifying a stationary control must still reveal the blocks that make up its shape.
2. **The front face sits on the pixel grid.** The view is a fixed projection, not a camera, so text
   stays sharp and a control is where its box says it is.
3. **Height says what you can do.** Proud means press me. A well means type here. Low means off.
4. **A control keeps its purpose across finishes.** Its shape and travel explain the action. Its finish determines how it catches or transmits light.
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

- Axes: x right, y down, z toward the viewer. `z = 0` is the page. A solid surface hides
  what passes behind it. An opening reveals the interior. In a text field the floor sits two
  voxels down and its far walls are visible through the opening. The recessed field casts no
  shadow on the surrounding page.
- **Seat a recessed control in a fixed opening.** Build the lip and inner walls from plate
  voxels. At rest and at full travel the moving part must clear them, and the lip must hide
  the portion behind it. If the mount carries a lamp, keep its emitter fixed and check which
  surfaces receive its light as the control moves. This fit makes the travel legible. An
  exposed low-profile key can instead stand above a solid plate on a visible mount.
- Cabinet projection: a point at height `z` is drawn `z / 2` voxels to the right and `z / 2` down.
  The viewer stands up and to the left, so you see the top and the left side of everything.
- The face that carries a label lands exactly on the element's box when the control is at rest.
  When that face moves (a press), its label moves with it by the same shift.
- Where labels must share a baseline (tabs), move the block under the label, not the label.

## 4. Materials

**Give each light a source and each material an optical response.** Clear plastic can reveal
the emitter, frost spreads its light, and an opaque cap can pass it through a translucent legend.
Apply the same reasoning to validation lights. Check where the bright core sits and how its
light falls across the field housing when the material changes.

The base palette (`src/core/materials.js`) gives each material a day and night color, grain and
emission. The lit look replaces several of these colours (`src/looks/lit.js`).

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
| Brick | `#d42c18` | `#ff5340` | Destructive actions, failure, pots |
| Ink | `#0a0f3d` | `#eceefb` | Lettering and icons in voxels |
| Soil, stem, petal, lamp | | | The garden and light sources |

- Text on enamel and brick is white. Text on signal is ink `#0a0f3d` in both themes. Text on chalk
  is `--vx-ink`. Body text contrast is 7:1 or better; quiet text is 4.5:1 or better.
- One enamel thing per group: enamel marks the main action. Secondary buttons are chalk.
- Reserve signal lights for state. Put decorative case lighting on its own control so changing the
  case color preserves the meaning of selection, success and error.
- **Give every dedicated status LED a visible unlit fitting.** Put a lens or slot where the light
  originates, then illuminate that same fitting in place. A user can see where the signal will
  come from before selecting a row.
- At night, order by lightness is ground, slate, steel, chalk: a disabled control (steel) is
  always duller than a live one beside it.
- Register a palette material with `defineMaterial(name, { day, night, jitter, glow })`.

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

These are the default look's heights (`BASE` in `src/core/look.js`). The lit look stands a key 6
high with 4 of travel, a card 5, a menu 6, a dialog 7, and cuts a well 4 deep.

- A button is a keycap: a body, and a top one voxel smaller all round. The step is what makes it
  read as a block at arm's length. Shadow length follows height, so the scale above is visible.
- A trigger stays down while what it opened is open, and carries a chevron in voxels.
- Press responds on pointer down, in the same frame. The press spring settles in about 110 ms
  (`k = 1500, c = 76`). A released key and a lifting plate share a damping ratio of 0.51.
  At 60 steps per second Close, Follow and the dialog overshoot by 14% to 15% of travel.
  They settle within 0.05 voxel of rest in 167, 267 and 450 ms respectively. Reversing a
  press, latch or lift starts at its current height.
- Sliders: while the pointer is down the thumb follows the value exactly. No easing, no spring.
- Switches and tabs slide on a spring with a little carry (`k = 420, c = 30`, about 220 ms).
- Hover lift is half a voxel and only for a mouse. Touch never hovers.
- **The plain version moves by the same springs.** The stylesheet carries PRESS and RELEASE as
  `linear()` curves sampled from `src/core/motion.js` (`--vx-press-*`, `--vx-release-*`,
  `--vx-slide-*`, `springCurve`), so a plain key goes down in about 170 ms at contact and comes back in about
  270 ms with the same 14% carry past rest. Its side is a registered length (`--_lift`), so the
  body follows the face. A mouse resting on a plain key raises it half a voxel: the body grows up
  and to the left and the face stays under the pointer, so the hit box never moves. A plain switch
  slides on SLIDE the same way. With less motion a plain key or switch changes state at once. `PORT=5989 node tools/feel.mjs` checks all of it.

## 7. Motion: building and breaking

Decide by how often it happens (from the site-craft rules):

| How often | Example | Motion |
|---|---|---|
| Many times a minute | Keyboard focus, arrow keys in tabs or a menu, typing | None. States swap. |
| Many times a visit | Press, hover, moving through a menu | Press spring; the menu tile jumps |
| Occasionally | Opening a menu or a dialog, a toast | Built: 200 to 460 ms |
| Rarely | The sign, a bloom | Delight lives here |

- **Assembly** marks making a new object. A note can rise out of the page in bricks of two
  to seven voxels laid in a running bond. Each brick rises through the surface, overshoots
  by about 8% and settles. The page hides the courses still below it.
- **Assemble newly added objects and disassemble removed objects in blocks.** This includes
  toasts and dialogs. Seeing the blocks come together distinguishes making an object from
  changing its state or scrolling it into view. Keep each control usable during the transition.
  With reduced motion, keep the overlay in place and fade it.
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
- **Brush.** While the pointer stays down the lettering keeps breaking under it, so it can be
  brushed: whatever rests between where the pointer was and where it is comes loose once a
  frame, and whatever is already loose there stays loose until the pointer has moved on. A kick
  sets a speed and never adds to one, so holding still throws nothing further. The letters mend
  behind the brush. `vx-poke` fires once for each press that breaks, however long it is held.
- **Growth.** A plant's voxels each have a birth between 0 and 1. Showing the plant at `g` shows
  every voxel born by then; each takes 140 ms to appear once its moment has come, however fast the
  value moves. The value itself follows a calm spring (`k = 170, c = 26`).
- Everything a hand can touch is a spring or a per-frame effect, so it can be interrupted and
  retargeted. Input is never blocked while something plays.

## 8. Sound

- Off by default. Nothing sounds, and no audio context exists, until the page calls `sound(true)`
  from a click or a key press.
- **Design a key’s downstroke and return as distinct events.** Audition both a quick tap and a
  held press. Check that the cap travels to its stop and the recorded impacts land with contact
  and return. Their timing gives a virtual switch its tactile feel.
- A key plays two short local recordings of a Cherry MX Brown switch under a PBT cap. The downstroke
  lands on press and the lighter return lands on release. The enclosure voices both through a
  high shelf. Walnut softens the treble and alloy lifts it. Other cues use Web Audio synthesis.
- **No two strokes sound alike.** Each press and release gets its own voice (`voice()` in
  `src/core/sound.js`): up to 2.5% of pitch and 12% of level at random, never within a hair of
  the stroke before. The cap the hand touched sets the register: a 44 px key is the recording
  as made, a small cap rings up to 7% higher and a wide one up to 10% lower and a little louder.
  A dial's detent is always a small, light stop. `cue('press', { mass })` names the mass (square
  voxels) where no hand touched anything.
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
- A live key's ring frames its whole solid, not its face alone: it reaches half the key's height
  (`--vx-face-z`, set as the part is built) up and to the left of the face, where the projection
  draws the body, and a voxel and a half past the face on the other sides. In forced colours the
  key's own outline returns. A plain key's ring frames its side band the same way.
- Keyboard-driven changes do not animate: arrow keys in tabs and menus move at once.
- Hit targets are at least 11 voxels (44 px) tall.
- Lettering in voxels (the sign, and headings set with `data-vx-board="none"`) keeps its text in
  the DOM for readers, wraps to fit its column and balances its lines.
- **Lettering is text first.** With voxels its words sit in a transparent box of the same
  glyphs, laid over the voxel letters line for line, so they can be selected, copied and found
  on the page like any heading. Every gesture a device already uses to select text still
  selects; play takes what is left.
  - Mouse: a drag, a double click, a triple click and a Shift-click select. A click breaks.
    Press and hold (200 ms without moving) and it brushes until it is let go.
  - Touch: a resting thumb selects and a thumb moving up or down scrolls, and neither breaks
    anything. A tap breaks. A thumb moved sideways brushes.
  - A board is an object more than a line of text, so on a board every mouse press is play: it
    breaks on the press and brushes at once, and its text is selected by dragging in from
    outside it. `data-vx-press="text"` on a board, or `"play"` on a heading, swaps this.
  - `PORT=5989 node tools/select.mjs` checks all of it with real pointer input, in two browsers.
- A dialog may be modal (`showModal()`) or not (`show()`, when the page behind must stay usable
  while a setting changes). Both assemble on entry and break down on exit; only a modal one has a backdrop.
- A value set from code (`input.value = 3`, `input.checked = true`) is drawn at once, with no
  sound and no slide: the hand did not move it. `vx-change` fires only when a person chooses.
- Toasts are `role="status"`, or `role="alert"` for a failure. Their clock stops on hover and
  while the tab is hidden.
- **Less motion** (`prefers-reduced-motion: reduce`): the voxels stay; travel goes. Builds and
  breaks become a 160 ms change of scale in place, the sign does not break (lettering is then
  plain text to every gesture), springs still give press feedback because that explains a state.

## 11. The plain version

- `voxelmorphism.css` alone is a complete interface: flat faces, two borders for the top and the
  side of a button, hard offset shadows. It is what shows with no script, with neither WebGPU
  nor WebGL2, or with `data-vx-plain` on the root.
- A part becomes voxels when the script gives it `data-vx-live`; its painted faces then step aside.
  `release()` gives it back.
- The plain version uses the same tokens, sizes and focus rules, so switching changes the surface
  and nothing else.

- If the renderer loses its device and can get no other, it says so (`onfail`) and every part
  goes back to plain CSS at once, with its behaviour. Nothing is ever left live without a face.
- **A plain key looks like its voxel one.** The Ridgeline print is drawn plain from the same
  horizon the voxels sample (`ridgeline` in `src/looks/fittings.js`), as a low range along the
  foot inside the cap's lip, clear of the legend. A link made a key keeps the key's legend colour
  whatever the page says about links.
- **A plain slide switch in the lit look is the voxel one.** A steel-edged slate bezel round a dark slot whose far
  walls catch the light, and a seven-voxel ivory paddle with a raised crest and a grip line. It
  travels seven voxels on the SLIDE spring (`--vx-slide-*`), and when it is on the trench behind
  it is full of light. An instrument's hardware colours (`hardware` in `src/looks/fittings.js`)
  are the voxels' and the plain version's alike (`--vx-hw-*`).
- **Behaviour without voxels.** Tabs, a dialog's `data-vx-close` buttons and a menu need script
  to behave. `adopt()` wires that behaviour when the page is plain too (it draws nothing), so a
  plain page needs no handlers of its own. With no script at all, tabs are buttons that do
  nothing: put the first panel's content where it can be read.
- A trigger whose panel is open (`aria-expanded="true"`) stays pressed, plain or live.

## 12. How it is drawn

- Each part has its own small canvas, which sits behind the part's content. So parts layer
  correctly inside dialogs and popovers and scroll with the page for free.
- **The Voxelwright engine's renderer draws them** (WebGPU, `src/engine.js`), straight into each
  part's canvas. It is the default: a page calls `adopt()` and nothing else. A WebGPU device
  takes a moment to arrive, so every page starts plain and becomes voxels when it does, and
  nothing moves when that happens. `src/engine.js` re-exports the renderer from
  `../blocks/renderer.ts` in the same Voxelwright checkout.
- **Where there is no WebGPU** the kit's own WebGL2 renderer (`src/core/gl.js`) still stands in,
  drawing into one hidden canvas and copying. It draws the same picture. It goes when the plain
  version looks right; a browser without WebGPU then gets the plain page.
- A page that is plain by choice (`data-vx-plain` on the root) asks for no GPU device.
  `PORT=5989 node tools/default.mjs` checks who draws in each case.
- At rest nothing runs: no frame loop, no timers. A part is redrawn only when its state changes.
  Parts off screen are not drawn until they come near.
- Voxels are instanced cubes with per-voxel colour, corner occlusion and a seam; one extra pass
  draws depth from the light. How the engine's renderer does it is in the guide
  ([Blocks and the Vox fonts](../../guide/blocks-and-fonts.md)).
- **Bleed.** A part's canvas is larger than its box by its `pad` (up to 16 voxels a side), for its shadow and
  for pieces in flight. Give the page `overflow-x: clip` so bleed never widens it, and do not put a
  part inside `overflow: hidden` unless you mean to cut its shadow.
- The renderer is behind one call, `draw(frame, target)`. The target is the part's 2D context,
  or the part's canvas itself for a renderer that says `ownsCanvas: true` and draws into each
  canvas with its own context. In Safari that is several times faster than copying from one
  shared canvas, which makes the page's thread wait for the GPU. `use(renderer)` hands the kit another
  backend without touching a part, and `use(null)` says none: the page stays plain. It takes a
  renderer or a promise for one: until it settles the page is plain,
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
PORT=5989 node tools/film.mjs                 # every scene
PORT=5989 node tools/film.mjs dialog-open --dark
```

- Time is stepped by hand (`stage.manual = true`, `stage.advance(1 / 60)`), so the film is the same
  on any machine. Each scene becomes a contact sheet, with the time on every frame, in the `film` folder of
  the kit's uncommitted `shots` output.
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
  container query (see the showcase). `PORT=5989 node tools/shift.mjs <page>` measures what moves.
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
  The same set, laid flat, is Vox Text.
- The type study that chose these faces is `/kit/showcase/type.html` (`?lang=uk` for Ukrainian).
  How the fonts are built is in the guide ([Blocks and the Vox fonts](../../guide/blocks-and-fonts.md)).

## 16. The kit

Every registered part is in `components` in `src/index.js`, grouped in the guide
([The kit](../../guide/kit.md#the-parts)); which tool each uses is in [BUILDING.md](BUILDING.md).
A part's file in `src/components/` opens with a comment describing it, usually with its markup.
The catalogue pages are under `showcase/parts/`. Button icons are in `src/core/icons.js`.
