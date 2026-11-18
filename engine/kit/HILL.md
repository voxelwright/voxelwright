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
PORT=5989 node tools/behave.mjs     # the same behaviour plain and live
PORT=5989 node tools/keys.mjs       # keyboard: tab order, rings, arrows, Escape
PORT=5989 node tools/crisp.mjs      # words on keys and canvases start on whole pixels
PORT=5989 node tools/contrast.mjs   # 7:1 body text, 4.5:1 quiet text and labels
PORT=5989 node tools/select.mjs     # lettering is text: it selects, copies, and plays
PORT=5989 node tools/film.mjs       # every motion, frame by frame: must end "rehearsal passed"
PORT=5989 node tools/seam.mjs       # a renderer handed to the kit: late, none, failing, lost
PORT=5989 node tools/default.mjs    # who draws when no renderer is handed over
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
