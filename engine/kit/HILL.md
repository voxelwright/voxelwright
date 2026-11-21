# The hill

How the kit gets better, and how anyone can tell that it did. `SPEC.md` says what the kit is
today; this file says how a change to it is judged. Everything in the spec is open: shapes, level
of detail, motion, how parts fit a phone. A round that earns a change writes it into the spec.

Order of work (the owner's, 17 November 2026): the voxel version is climbed first and the full
set of parts is built in it. The plain web version is made after, from the settled result.

## 1. The floor

A round must pass these gates. Run them from `engine/kit` against the showcase at `http://127.0.0.1:5989/kit/showcase/`.
To start that server, run `PORT=5989 node tools/serve.mjs` in that directory.

```sh
cd engine/kit
PORT=5989 node tools/shift.mjs      # nothing moves when voxels take over from plain
PORT=5989 node tools/board.mjs      # the board and tab strips fit narrow screens
PORT=5989 node tools/latch-fit.mjs  # ink clears the shutter, light stays inside, closed lamps are dark
PORT=5989 node tools/behave.mjs     # the same behaviour plain and live
PORT=5989 node tools/keys.mjs       # keyboard: tab order, rings, arrows, Escape
PORT=5989 node tools/crisp.mjs      # words on keys and canvases start on whole pixels
PORT=5989 node tools/contrast.mjs   # 7:1 body text, 4.5:1 quiet text and labels
PORT=5989 node tools/select.mjs     # lettering is text: it selects, copies, and plays
PORT=5989 node tools/film.mjs       # every motion, frame by frame: must end "rehearsal passed"
PORT=5989 node tools/seam.mjs       # a renderer handed to the kit: late, none, failing, lost
PORT=5989 node tools/default.mjs    # who draws when no renderer is handed over
PORT=5989 node tools/feel.mjs       # keys answer the hand alike plain and live; no two strokes sound the same
node tools/root.mjs http://127.0.0.1:5989   # the address a person is given
```

The engine's renderer is the default, so the gates run on it. Check each gate's own exit code;
a pipe into `tail` hides it.

## 2. Numbers

Where a number exists it is read before anyone gives an opinion.

| Number | Tool | Today |
|---|---|---|
| Gates passing | section 1 | all |
| Motion: time to settle against the spec's range; `no response`, `pop`, `snap`, `empty frame` | `film.mjs` | passes |
| Parts built, of the full set (shadcn's and Bootstrap's lists) | the inventory, section 5; `tools/parts.mjs` | 76 of 76 |
| Plain against voxels, per part and state (an image difference) | to be built with the web version | not measured |

## 3. Look and feel

Scored 1 to 10 each, by reviewers who see the pictures and this rubric and not the target. One
strong model from each provider at least. Scores are opinion; agreement between reviewers is the
signal, and the owner's eye outranks all of them.

| | Criterion | A 10 looks like | It fails as |
|---|---|---|---|
| 1 | **Built from blocks** | At arm's length each part reads as a small solid. Shape says it, not surface pattern. | Flat boxes with a texture; pixel-art stickers |
| 2 | **Says what it does** | Height, material and state tell what can be pressed, what is on, what is off, before any word is read. One main action per group. | Everything the same weight; decoration that looks pressable |
| 3 | **Level of detail** | Enough voxels to have character, few enough to stay calm. Seams and grain never louder than the shape. Icons read at a glance. | Too much (noise, static) or wireframe (bare slabs) |
| 4 | **Type** | Legends, lettering and text are sharp at 1x and 2x, sit level on their faces, and belong to the same world. | Soft edges, words off-centre, two voices fighting |
| 5 | **Colour and light** | A small palette where each colour has one job. Day and night are both designed. Shadows place every part on the page. | A rainbow; night as an inversion; parts floating or lost |
| 6 | **Motion and touch** | The first frame answers the hand. Presses, slides, builds and breaks feel like blocks with weight. Nothing moves that was not asked to. | Lag, pops, static, motion for show, anything that cannot be interrupted |
| 7 | **Composition and fit** | Parts sit together on a page at 390 and at 1280 with an even rhythm; nothing is cut, cramped or stranded. | Boxed, empty bands, sideways scroll, a part that only works wide |
| 8 | **Consistency** | One depth scale, one corner step, one way to show state, on every part. | Each part solving the same problem its own way |
| 9 | **Its own voice** | Could not be mistaken for another kit, and a working designer would want to use it. | Bland; a novelty that tires in a minute |

Stageshow's five failures are the short form: too much, wireframe, boxed, flat, bland.

Reviewers also get references beside the kit's pictures, because a design scored alone scores
high. A reviewer that invents what is not in the picture is dropped.

## 4. A round

1. Say what is being tried and which criterion or number it should move.
2. Shoot before and after with the same tool: `node tools/baseline.mjs <name>`, then
   `node tools/baseline.mjs --compare <before> <after>`. Film any motion that changed.
3. Run the floor.
4. Score. Report the numbers as they are: a round that did not move the measure says so.
5. Keep, change or drop. What is kept goes into `SPEC.md`, and one line goes into the log below.

Candidates are judged on the real kit, never on flat stand-ins. While the direction is still
open, a round compares several directions side by side before anything is polished.

## 5. The full set

Held against shadcn's component index and Bootstrap's Components, Forms and Content lists, as
they stood on 17 November 2026. Names follow whichever of the two is plainer.

Exists (13): button, switch, slider, text field (input and textarea), card, list, dropdown menu,
dialog, tabs, meter (progress), toast, block, lettering.

To build, in this order:

1. **Forms (12):** checkbox, radio group, select (native first), label, field with error and
   validation states, floating label, input group, number stepper, toggle button, toggle group,
   button group, close button.
2. **Reading (20):** prose (headings, links, quote, lists), code block, kbd, table, figure and
   image, aspect ratio, separator, badge, callout (alert), avatar, item, breadcrumb, pagination,
   skeleton (placeholder), spinner, empty state, scroll area, scroll spy, list group, direction
   (right to left).
3. **Overlays (9):** accordion, collapsible, tooltip, popover, hover card, alert dialog, sheet,
   drawer (offcanvas), context menu.
4. **Navigation (7):** navbar, navs, navigation menu, menubar, sidebar, command palette, combobox.
5. **Heavy (8):** calendar, date picker, carousel, data table, chart, resizable panels, code
   input (one-time code), the theme picker.
6. **Conversation (7),** shadcn's newest set: message, bubble, message scroller, attachment,
   marker, questionnaire, trace.

That is 63 to build and 76 in all.

## 6. Log

| Round | Date | What | Result |
|---|---|---|---|
| 0 | 2026-11-17 | Baseline of the kit as merged at `bf55acd`, shot on the engine renderer (`shots/baseline/`) | GPT 6.2 Sol: 6.22. Opus 5.5: 6.33. See below. |
| 1 | 2026-11-18 | Hardware baseline at `dc46636f`, 100 showcase images, nine part pages, the deploy panel at 390 and 1280, and the two hardware references. | Sol 7.11 (6/8/6/7/7/7/8/7/8). Opus 5.78 (5/6/5/6/6/6/7/5/6). |
| 2 | 2026-11-18 | Cast housing, quieter daylight finish, latched window, engraved shortcuts, seated lamps. The same nine pages and deploy views, compared against round 1 and both references. | Sol 7.78 (8/7/7/8/8/7/8/8/9). Opus 5.94 (6/5.5/6/6/6/5/6.5/5.5/7). |
| 3 | 2026-11-18 | Cast case (A), exposed rack (B) and round 2 (C) on the main renderer. Both ranked A > B > C. Same phone and desktop panel, both references, latch states and press frames. | Cast case: Sol 8.33 (9/8/8/8/9/8/8/8/9). Opus 7.33 (8/7/7/7/8/8/6/8/7). |
| 4 | 2026-11-18 | Adopted cast case on the whole showcase. 104 baseline shots, fit at 390 and 1280, all 69 part pages and four motion films. Sol reviewed the full gallery. Opus viewed the full showcase and five of nine component sheets. | Sol 8.22 (9/8/8/8.5/8.5/8/7/8/9). Opus 6.89 (7.5/7/7/7/7/6/6/7/7.5). |
| 5 | 2026-11-18 | Both reviewers opened the same nine sheets, covering all 69 component pages, the whole showcase at 390 and 1280 by day and night, both hardware references, round 1 and the round 3 winner. Both ranked the seated lift above the drawer, and the drawer above round 4. | Lift: Sol 7.56 (8/7/7/7/8/7/8/7/9). Opus 6.33 (7/6/6/6/6/5/6/7/8). Opus marked type provisional at contact-sheet scale. |
| 6 | 2026-11-18 | One warm header tube, quiet idle wells and an opaque lifting plate that catches at its mechanical stop. Both reviewers saw the same whole showcase, all nine component sheets, the two references, rounds 1, 3 and 5, four paired motion films and native 1×/2× crops. Both preferred round 6. | Sol 8.91 (9.2/8.8/8.6/9/9.1/8.5/8.8/9/9.2). Opus 7.33 (7.5/7.5/7/7.5/7/6.5/7/8/8). Mean 8.12, up 1.18 from round 5. |
| 7 | 2026-11-18 | A one-course Close plate, shared latch window, clearer night key faces and mass-scaled returns. Both reviewers opened the same 14 sheets, including all parts, both references and the full tab strip at 2×. Both narrowly preferred the candidate to round 6. | Sol 8.67 (9/9/8.5/9/9/8/8.5/8/9). Opus 6.78 (7/7/7/7/7/6/7/6/7). Mean 7.72, down 0.40 from round 6. Trial only. Replaced in round 8. |
| 8 | 2026-11-18 | Final regroup. A fixed lens in the bezel (A) and a fixed lit slot with a shutter (B). Both reviewers opened the same 15 panels, including all nine part sheets, the showcase at both sizes and times of day, the references, earlier rounds, 2× sections and three interrupted motions. Both chose B. | A scored 8.81 Sol and 7.72 Opus. B scored 9.08 Sol and 8.11 Opus. B’s mean of 8.59 is 0.47 above round 6 and 1.65 above round 5. |
| 9 | 2026-11-19 | Feel, from the site's audit: the plain Ridgeline print redrawn from the voxels' horizon and a link key that keeps its legend; plain keys on the voxels' own springs with a mouse hover; the plain slide switch built like the voxel one; a focus ring round the whole solid, live and plain; a voice per key stroke, pitched by the cap's mass. `tools/feel.mjs` joins the floor. A crossfade for the voxels' arrival (a view transition) was tried and dropped: presses during the fade landed on the page root (3 of 3). | Gates: all pass but `contrast.mjs`, which crashes on the base commit too. Opus 5.5 on five before/after sheets, before → after: plain matches voxel 3 → 6 (print), 3 → 6 (press), 2 → 7 (switch); motion 2 → 7 (press), 3 → 8 (focus). GPT-6.2 Astra: plain matches voxel 5 → 7 (print), 4 → 9 (switch), 6 → 8 (site at 390); motion 6 → 8 (press), 6 → 9 (focus). Both name the next fault: a plain key reads as a bevelled plaque, not a raised cap with depth round it. |

### Final regroup and ceiling

| Criterion | Lens · Sol | Lens · Opus | Shutter · Sol | Shutter · Opus |
|---|---:|---:|---:|---:|
| Built from blocks | 9 | 8 | 9.2 | 8 |
| Says what it does | 8.5 | 7 | 9.2 | 8.5 |
| Level of detail | 8.8 | 7.5 | 9 | 8 |
| Type | 9.1 | 8 | 9.1 | 8 |
| Colour and light | 8.6 | 8 | 9.1 | 8 |
| Motion and touch | 8.8 | 7.5 | 9 | 8 |
| Composition and fit | 9 | 8 | 9 | 8 |
| Consistency | 8.6 | 7.5 | 9 | 8.5 |
| Its own voice | 8.9 | 8 | 9.1 | 8 |

The round-7 lamp stuck out two pixels below the tab bezel. Pushing it up touched the g in Growing. The shutter lets the light stay in its own row. The selected solid finishes four pixels inside the bezel, its closed neighbour two. The lit strip clears the letters by six pixels at 390 and 1280. Follow shows 12 of 12 diffuser cells when latched and zero when released. Close travels one course in its socket. Close, Follow and the dialog overshoot by 14%, 14% and 15% and settle within 0.05 voxel of rest in 167, 267 and 450 ms. The input films show a second press, relatching and Escape reversing the lift at 83 ms with its words still on the plate.

**Where the climb stopped.** Sol cleared all nine criteria. Opus gave 8.5 for reading state and consistency, and 8 for the other seven. The following options are ranked by likely gain for the effort. The ranking is the kit team's judgment.

| Priority | What Opus saw | What could move it |
|---|---|---|
| 1 · Small kit changes | **Detail (8), state and consistency (8.5 each).** A blue tick remained on the closed grooves. The active band narrowed to one or two pixels at 1×. **Motion (8).** The cap reversed on time, but the lamp barely showed the unlatch. | After scoring, the end lamps and diffuser dim with shutter travel. Two emitting cells per closed groove fell to zero. Compare a two-device-pixel minimum band at native scale if state reading is revisited. |
| 2 · One reading-page trial | **Type, composition and voice (8 each).** Opus found the glyphs crisp but called out long grey passages of small text. The reviewer also flagged a possible tooltip clip. | The native tooltip page showed two pinned examples overlapping. They now clear by 18 px at both widths. The owner can decide whether the catalogue should keep all examples open or show one worked example first, with the other states below. Try this on one dense page before changing all of them. |
| 3 · Material reference, then a renderer trial if warranted | **Built from blocks and colour/light (8 each).** Opus saw the same casting and bevels in both trials and liked the quieter glow. Opus gave no specific shader or asset requirement. Sol saw more depth to the light in the physical references. | Choose one existing hardware reference and compare its metal lip and opal lamp at 4 px per cube. If the difference is in how they catch light, ask the #430 builder for a native comparison of steel gloss and softer shadows. A new matched day/night material study would help only if the existing references leave the finish undecided. |

The third regroup ends here. The nine scores above belong to the council images. The closed-lamp correction and the tooltip spacing have measured checks and were made after scoring.

### Earlier rounds

Round 6 removed all 1,512 emitting wall cells from the idle log. The header pilot’s halo fell to one-fifth. The dialog rose 0.96 voxel past its seat and returned to level with opaque lettering. Reduced motion had zero travel. Both reviewers still found small secondary keys and selected states hard to read at night. The log divided them. The scored version has a quiet well. For shipping, the coordinator chose the passive warm reflection on the lower inside edge. It changes four pixel rows and has 312 warm wall cells with zero emission. The scored quiet version remains available with `?log=quiet`.

Round 5 is the first fair whole-kit baseline. Scores fell from 8.22/6.89 to 7.56/6.33. Earlier rounds used smaller panels or gave the two reviewers different coverage. Compare subsequent rounds with 7.56/6.33 and keep this panel in the comparison.

**First regroup.** Both councils still read the housing as thin and the latch as too similar to a resting key. A thicker flat slab and a brighter rim gained little on their own. The cast shell won on the section of its cover and on the height and light of its latch. Both reviewers found the phone header too close to the screw heads.

**Second regroup.** Both reviewers could read the casting. Both saw chalk keys competing at the same weight, tab legends behind a case lip, and an empty menu before the text appeared. Deepening the case further would consume more clearance. Compare two ways of bringing in a whole engraved plate and docking controls on it.

The old lip covered 864 of 948 painted tab-letter pixels at 1280 (91%) and 10 of 948 at 390. The lift preserved all 948 pixels in both themes and kept the three legends 35 px clear at both widths. The night heading had 29 px of visible air above the casting at 390 and 41 px at 1280. Deploy stood eight courses to Roll back’s six, with 2.6 times its local light. Under full-parts load the input-through-rest films found zero unsupported text samples for either mechanism (lift 0/1,404, drawer 0/1,330). The extra sample at input caught a flash before the first tick in the trial. Both reviewers saw the final lift lose weight as its words faded. Both found small hardware and lit wells competing for attention at rest.

### Round 0, by criterion

| | GPT | Opus |
|---|---|---|
| Built from blocks | 7 | 8 |
| Says what it does | 6 | 6 |
| Level of detail | 5 | 6 |
| Type | 7 | 6 |
| Colour and light | 7 | 6 |
| Motion and touch | 5 | 6 |
| Composition and fit | 5 | 5 |
| Consistency | 6 | 6 |
| Its own voice | 8 | 8 |

Both reviewers opened the pictures. What both found, so it is taken as true:

1. At 390 px the page is cut: the fourth swatch of the light demo and its long button run off
   the right edge. No gate sees it, because the page clips sideways overflow.
2. At night every content surface and the action colour are one blue. A field does not read as
   a hole, and a chalk button reads like an enamel one.
3. The grid on reading faces is louder than the shape: cards look like graph paper.
4. Words appear before the surface that carries them (menu and toast, the first 50 ms). The
   film gate passes it, because it reads voxels and not labels.
5. The dialog's scrim snaps off after the break has ended.
6. The focus ring is a flat rectangle outside the solid, and at night it is the state colour.
7. Menu items are set in a thin pixel weight beside a bold trigger.

One each: hover shows nothing, the field is the weakest part (Opus); the dialog's blue header
competes with its blue action, the tab block passes over the middle tab (GPT). Strongest part,
both: the slider.

Directions they would compare: fewer and larger blocks with quiet faces (both, GPT's bet);
moulded material where light does the work instead of grid lines (Opus); only what you touch is
solid, content is flat lit paper (Opus's bet).
