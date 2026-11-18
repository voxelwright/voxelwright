# Building a part

For whoever adds a part to the kit: a person or an agent. Read all of it once. It is short on
purpose, and every rule has its reason beside it. Run commands from `engine/kit`.
Open the parts at `http://127.0.0.1:5989/kit/showcase/parts/`.

## 1. What this is

Voxelmorphism turns plain HTML controls into small solids of voxels, drawn in WebGPU, lit by one
light. The page works with no script; the voxels arrive on top and nothing moves when they do.

The look is **lit**: one system of depth and light. Its owner chose it, in these words:

- "we need to take best parts of both [...] sometimes you want one 'card' and within that you
  choose whether you want to separate the content on one level and use this 'well' separator"
- "it feels a bit like overused cards in card-based designs" (about a page where every block had
  its own raised card: that is the fault to avoid)
- "For buttons, I think backlit keys are a cool idea"
- "shatter on click for something we will be destroying (like dismissing toasts, or the fun
  headers we had)"
- "right now it looks still early in development, we'll need much more polish and grounded look"
  (polish comes later, over the whole kit; do not spend your time tuning glow numbers)
- "The designs I see so far lean toward minimalistic voxels but I am looking more for
  skeuomorphism on voxels". Shown the choice between the same parts with more material and
  controls modelled on real devices, he chose the devices. So a part is an object: a keycap, a
  slide switch in a bezel, a row of lamps in a slot, a panel bolted down. Section 2a says how.

## 2. The four tools, and "none"

| Tool | What it is | Use it for | How |
|---|---|---|---|
| **Key** | A cap standing on a ring of light. The light lies on the surface round its foot and flares when the key goes down. | What you press to make something happen. | `ring()` under a cap; see `key` in `src/looks/lit.js` |
| **Surface** | One slab. | One per region (a window, a panel, a dialog). Never one per block of content. | `.vx-card` |
| **Groove** | A thin channel cut into the surface, with light in it. | Parting what is on one surface: header from body, a sidebar, a quote's rule, the mark of the current row. A few per screen. | `.vx-groove` |
| **Well** | A hole a level below the surface, lit from its rim. | What you put something into (fields), and at most one thing per screen that is read as set apart (a log, code). Tracks and trenches things slide or fill in. | `hole()`; `.vx-recess` |
| **Float** | A slab above everything, on a light that says what it is. | What appears for a moment: a menu, a notice, a popover. | see `notice` |
| **None** | Words and pictures on the surface. | Most of what a page holds. | plain HTML and CSS |

Rules that follow, each with its reason:

1. **Reach for "none" first.** A part that is only words (a breadcrumb, a label, a table) gets no
   voxels. A box round every block is the fault the owner named.
2. **Only what can be pressed stands up.** Height says "press me". A badge, a kbd, a tile that
   cannot be pressed must not look like a key.
3. **Light means something.** Accent (`light`): this acts, or this is on. Warm (`light-warm`): the
   room's own light, structure only. Green (`light-go`): done, live. Red (`light-stop`): failed,
   destructive. Never a light for decoration, never a new colour.
4. **One main action per group** (`data-vx-kind="main"`: the accent cap). Everything else is an
   ordinary key. `data-vx-kind="danger"` is an ordinary cap on a red light.
5. **Keys depress. Nothing shatters unless it is being destroyed** (a notice dismissed, an
   attachment removed) **or is there for play** (the voxel headings). Use `live.play('crumble')`.
6. **Words are words.** Body text is the text face (`--vx-font`). Only legends on keys use the
   key face (`--vx-key-font`). Never set reading text in a pixel face.
7. **The cubes show.** Every face is visibly made of cubes; that is the material. Do not add any
   other texture, and do not hide the cubes.
8. **State is shown one way everywhere:** on = full of the accent's light; current = an accent
   groove beside it or a key level with the surface in a trench; focus = the part's own light
   brighter (a well's rim turns to the accent) plus the browser's focus ring where there is no
   light to brighten.

## 2a. A part is an object

Ask what real thing this control is, and build that thing out of cubes. Not a picture of it: the
thing, at the scale of a hand, with the thickness, the edges and the mechanism it would have.

| What it is | The device | How |
|---|---|---|
| What you press | A keycap: a body and a top one voxel smaller all round, on its light | `cap()` on `ring()`. Every cap in the kit is drawn by `cap()`; never draw one with `slab()` |
| What slides | A knob in a slot, the slot in a bezel that stands a voxel proud; ridges on the knob to grip | `bezel()` round `hole()`; see the switch in `src/looks/lit.js` |
| What fills | A row of lamps in a slot, each two voxels of light, a voxel apart; one that is not lit is a dark stud | see `bar` in `src/looks/lit.js` |
| What shows a state | A lamp in a collar | `.vx-lamp` |
| What you type or read in | A window cut into the panel, lit from its rim | `hole()` with a light for its wall |
| A region | A thick panel, bolted down at its corners | `.vx-card` (bolts come by themselves on a large one) |
| What appears for a moment | A plate above everything, on its light. A plate, not a keycap: its top has no step | `ring()` and `slab()` |

Rules for objects:

1. **One mechanism, used everywhere.** If your part has something you press, it is the keycap.
   If something slides, it is the knob in a bezelled slot. Do not invent a second kind of key.
2. **Steel is for hardware:** bezels, bolts, collars, studs, and anything switched off. It never
   carries words.
3. **A bezel only where something moves in a slot.** A window you type in has no bezel; its edge
   is the panel's own.
4. **Thickness is part of the object.** Take every depth from `live.look` (`rise`, `travel`,
   `well`, `groove`, `slab`, `float`, `dialog`), never a number: the look sets how thick things
   are, and it has changed once already.
5. **Words stay words.** An object's legend is still real text laid on its face, and a part that
   is only words (rule 1 of section 2) still has no object at all.

## 3. Which tool each part uses

Settled, so that 76 parts are one system. If you think a row is wrong, build it as written and
say so in your report.

**Exists:** button (key), switch (trench with a key), slider, text field (well), card (surface),
list, dropdown menu (float), dialog (float), tabs (trench of seats, the chosen one a key level
with the surface), meter (trench that fills with light), toast (float), block, lettering (voxel
headings that break under the pointer), groove, recess, lamp, pointer, checkbox (a latching push-button in a steel collar, its lamp lit when ticked).

**Forms**

| Part | Tool |
|---|---|
| radio group | Latching push-buttons in steel collars, their corners stepped (the checkbox's latch); the chosen one latched down with its lamp lit. Arrow keys move the choice. |
| select (native) | A key with a chevron: it opens the browser's own picker. |
| label | None: words. |
| field with error and validation | The well. Invalid: the rim is red, and the message below is words beside a red lamp. Valid needs nothing. |
| floating label | The well; the label is words that rest inside and move above the well when it has focus or holds something. |
| input group | One well holding the input and its add-on words. A key that belongs to it stands beside the well, not in it. |
| number stepper | A well for the number, two small keys (minus, plus) beside it. |
| toggle button | A key that stays down while on, with its light held bright. |
| toggle group | One of many: a bank of latching keys in a slot with a bezel; the chosen one latched down on its light. Several of many: toggle buttons side by side. |
| button group | Keys three voxels apart, read as one group (nearer, a cap's side is drawn over the key before it). |
| close button | A small ordinary key with the cross icon. Its target is still 44 px. |

**Reading**

| Part | Tool |
|---|---|
| prose (headings, links, quote, lists) | None, but a quote's rule is a vertical groove. |
| code block | A recess. |
| kbd | An engraved legend set one voxel into the surface. |
| table | None. One groove between head and body; rows are parted by space or a hairline in `--vx-slate`. |
| figure and image | The picture is set in a recess; the caption is words. |
| aspect ratio | None (layout only). |
| separator | The groove, lying or standing, with an optional word in the middle. |
| badge | A lamp and a word. A count is words. No box. |
| callout (alert) | Words on the surface with a vertical groove at their left in the light of its kind. Not a card. |
| avatar | A picture or initials set in a small well. |
| item | None: a row of words (title, a line under it, something trailing). |
| breadcrumb | None: words parted by chevrons. |
| pagination | A trench of seats (the current page is the key in it), with previous and next as small keys. |
| skeleton | Shallow trenches the size of what is coming, with one soft light passing along them. |
| spinner | A small ring of light cubes that take turns. |
| empty state | Words and one key. |
| scroll area | A recess that scrolls; its bar is a thin trench with a small key in it. |
| scroll spy | Words, with an accent groove that moves to the current one. |
| list group | Rows of words parted by hairlines; the current row is marked by an accent groove at its left. |
| direction (right to left) | Every part mirrored by logical properties; a page that proves it, and a list of what breaks. |

**Overlays**

| Part | Tool |
|---|---|
| accordion, collapsible | Rows of words with a chevron, parted by grooves. What opens is on the same surface. |
| tooltip | A small low float with words, no light. |
| popover, hover card | A float on the accent's light. |
| alert dialog | The dialog, with its keys; the destructive one is danger. |
| sheet, drawer | A surface that comes in from an edge, a level above the page. |
| context menu | The menu, at the pointer. |

**Navigation**

| Part | Tool |
|---|---|
| navbar | One surface; links are words, the current one marked by a short accent groove; one key at the end at most. |
| navs | Words with the accent groove, or the trench of seats. |
| navigation menu, menubar | Words; what opens is a float. |
| sidebar | Part of the window's surface, parted from the rest by a standing groove; rows are words. |
| command palette | A dialog with a well at its top and rows of words; the active row marked. |
| combobox | A well, and a float of rows under it. |

**Heavy**

| Part | Tool |
|---|---|
| calendar | On the surface. Days are words; the chosen day is a key level with the surface on its light; today has a lamp; a range is a trench filled with light. |
| date picker | A key or a well that opens the calendar in a float. |
| carousel | A recess holding the slides; previous and next are keys; the dots are lamps. |
| data table | The table, with words you can press to sort, checkboxes, and pagination. |
| chart | Columns of light standing in a recess. |
| resizable panels | Regions of one surface parted by a groove you can drag; it turns to the accent while held. |
| code input | A row of small wells, one a digit; the one in focus has the accent's rim. |
| theme picker | A trench of seats for the theme with a lamp of each accent, and one for the time of day. Calls `theme()`. |

**Conversation**

| Part | Tool |
|---|---|
| message | None: words, with an avatar. |
| bubble | Theirs is set a level into the surface; yours stands a voxel above it. No light on either. |
| message scroller | The scroll area, with a key that appears when there is something new below. |
| attachment | A low tile with a name; removed, it shatters. |
| marker | The groove with a word in the middle. |
| questionnaire | A toggle group inside a message. |
| trace | A standing groove with a lamp at each step: green done, accent in progress, red failed. |

## 4. How a part is made

A part is three files that you own, and nothing else:

```
src/components/<name>.js     the part
css/<name>.css               its CSS: layout, the plain version (tools/css.mjs puts it in the kit's one stylesheet)
showcase/parts/<name>.html   its own page
tools/parts/<name>.mjs       (if it has behaviour) a check with real input
```

Copy the checkbox: `src/components/checkbox.js`, `css/checkbox.css`, `showcase/parts/checkbox.html`.
It is the example to hold yours beside. Read `src/looks/lit.js` for a key, a well, a trench that
fills, a switch, a float, and `src/core/light.js` for the helpers.

A part with "none" as its tool has no `.js` file unless it needs behaviour. For behaviour without
voxels, omit `build`: such a part gets no canvas and no model, and it may sit on the same element
as a part that draws (a context menu on a recess). Put its wiring in `plain(el, on)`, and supply
`bind(live)` too when it needs the stage.

The kit's one stylesheet, `voxelmorphism.css`, is made from the files in `css/` by
`node tools/css.mjs`. Never edit it by hand. Run the tool after you change a file in `css/`; a
page then needs only the kit's stylesheet. A part that is not yet in `src/index.js` is registered
by its own page (`show(part)` in `showcase/parts/parts.js`); one that is already there needs
nothing.

Things that exist and should be used, not written again: `.vx-aloud` (words for a screen reader
only); `place`, `anchored` and `slabOnLight` in `src/components/popover.js` (anything that floats
by a trigger);
the kit's own parts (`.vx-button`, `.vx-well`, `.vx-groove`, `.vx-lamp`, `.vx-recess`,
`.vx-tabs`, `.vx-check`, the menu, the dialog, the popover). Read `showcase/parts/index.html`
for the whole list; each part's file begins with its markup.

```js
export const thing = {
  name: 'thing',              // unique
  selector: '.vx-thing',      // the element that becomes voxels; it is measured, its box is the model's box
  pad: 7,                     // voxels of canvas round the element: room for height, shadow and halo
  glowRadius: 3, glowStrength: halo(0.05),   // only if something in it glows
  build(live, m) {},          // make the model from the element as it is now
  pose(live) {},              // before each drawing: move parts from springs
  step(live, dt) {},          // each frame while moving; return true to keep going
  bind(live) {},              // once: listeners; return a function that removes them
  plain(el, on) {},           // the same behaviour with no voxels: on(target, type, fn), on.watch(...)
};
```

`live`: `el`, `W` and `H` (the element's size in voxels), `vx` (px a voxel, 4), `theme` ('day' or
'night'), `look`, `state` (yours), `spring(name, x, k, c)`, `label(node, () => z)` (keeps a DOM
node on a face as it moves), `faceZ` (the height of the face the element's box lies on),
`well` (set by `hole`), `play('assemble' | 'crumble', partNames, opts)`, `invalidate()` (draw
again), `rebuild()` (the element changed), `glowStrength` and `glowRadius` (set in `pose` to make
light answer).

`m.part('name')` gives a `Part`: `box(x, y, z, w, h, d, material)`, `slab(..., cornerStep)`,
`carve(x, y, z, w, h, d)`, `plot(x, y, z, material, birth)` and `grow(amount, dt)` for things that
fill, `tx ty tz` (its pose, in voxels), `hidden`, `grounded = false` for a part that moves or does
not rest on the page, `sunk = true` for a part below the surface.

Space: x right, y down, z toward you; the surface is z = 0. A voxel of height shifts half a voxel
right and down on screen, so you see a solid's left and top sides, and its shadow falls right and
down. The light is upper left.

Depths come from `live.look` and are never written as numbers in a part. Today they are: a
groove 1 down (`groove`), a well 2 down (`well`), a panel 4 thick (`slab`), a key 5 high (`rise`:
a ring of light 1 and a cap 4, its top a voxel smaller all round) going 2 down when pressed
(`travel`), a float 6 (`float`), a dialog 7 (`dialog`).

Materials: `chalk` (the surface), `key` (an ordinary cap), `enamel` (the main cap), `floor` (the
bottom of a well), `slate` (trays, trenches), `gasket` (cover joints and key sockets), `steel` (hardware and switched-off controls), `ivory` (a knob), `ink`,
`light`, `light-warm`, `light-go`, `light-stop`. No new materials and no colours of your own:
a theme recolours these, and yours would be left behind.

Helpers (from `src/core/light.js`): `ring(part, x, y, z, w, h, material, cornerStep)`,
`cap(part, x, y, z, w, h, depth, material)` (a keycap), `bezel(m, x, y, w, h, { by, mat })`,
`hole(live, m, { x, y, w, h, depth, wall, floor })`, `halo(strength)`, `byTheme(live)`,
`warmth(live)`, `lightName(el, fallback)` (reads `data-vx-light`), `kindOf(el)` (reads
`data-vx-kind`). Motion (`src/core/motion.js`): springs `PRESS`, `RELEASE`, `SLIDE`, `CALM`.
Sound: `cue('press' | 'release' | 'tick' | 'slide' | 'done' | 'failed')`. Small glyphs:
`src/core/icons.js` (chevron, plus, check, cross); draw one of your own the same way, as rows of
`#` and `.`.

CSS: sizes in voxels, `calc(var(--vx) * n)`, so every edge lands on the grid. A control you can
press is at least 11 voxels (44 px) in its target. Colours only from the tokens in
`voxelmorphism.css` (the block that begins `[data-vx-look="lit"]`). The plain version
(`:not([data-vx-live])`) must be usable and take exactly the same box: it is what a browser with
no WebGPU, or a page with `data-vx-plain`, shows. It does not have to be pretty yet.

## 5. The floor: what every part must do

- A real HTML control underneath (`button`, `input`, `a`, `dialog`, `details`, `popover`), so it
  works with a keyboard, a screen reader and no script. Radix's and the WAI-ARIA practices' lists
  of keys and roles are the reference for what not to miss.
- Every state is in the markup or the control (`aria-*`, `disabled`, `checked`), never only in
  script. Changing it from code redraws the part.
- Focus can be seen. Contrast: text 7:1 on its surface, quiet text and legends 4.5:1.
- `prefers-reduced-motion`: nothing travels; states change at once.
- At 390 px wide nothing is cut and the page does not scroll sideways. A long word or a
  Ukrainian label ("Розгорнути на сервері") must fit or wrap.
- The first frame answers the hand. Nothing moves that was not asked to. At rest nothing runs.
- Use made-up names for people and sample content (harbor-api, fogline, Mina, Ada).

## 6. How to work

1. Read this, the checkbox's three files, and the parts of `src/looks/lit.js` nearest yours.
2. Write the part. Start with the plain HTML and CSS, then the voxels.
3. Its page shows it first **in use** (a few lines of a believable product), then **every state**.
4. Run `PORT=5989 node tools/part.mjs <name>` and open `shots/parts/<name>/sheet.png` yourself
   (`PORT=5989 node tools/parts.mjs <name> <name>` runs the harness and the checks of several).
   Fix what it prints, then what you see: the largest fault first. Hold it beside the checkbox's
   sheet and the pictures in `shots/lit/`.
5. Press it: write `tools/parts/<name>.mjs` (copy the shape of `tools/lit-hand.mjs`: a real mouse
   and real keys through Playwright, `ok` or `FAIL` per line, exit 1 on a failure) and run it.
6. If it has legends on keys, run `PORT=5989 node tools/crisp.mjs showcase/parts/<name>.html`.

## 7. Hard rules

- **Only your own files.** Never edit `voxelmorphism.css` by hand, `css/_kit.css`, `src/index.js`,
  `src/looks/lit.js`, `src/core/*`, `src/engine.js`, another part's files, or anything outside
  this worktree. If a
  shared file needs a change, write the exact change in your report; the coordinator makes it.
- **No git.** Do not commit, stash, switch branch or push. The coordinator commits.
- **One server: port 5989,** already running and serving this folder. Start no server, open no
  other port. Stop no process but one you started yourself, and that only by its PID: never
  `pkill` or `killall`, which can stop other people's servers.
- **Nothing leaves the machine:** no package installs, no uploads, no outside services. Reading
  public documentation is fine.
- No new dependencies. No licence file. No skill folders in the repository.

## 8. What to send back

For each part: its files; the tool it uses; what it does on press and on each key; what
`tools/part.mjs` and your own check printed on their last run (the lines, not a summary); what
is not done or not checked; any change you need in a shared file. Say plainly what failed.
