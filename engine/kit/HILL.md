# The hill

How the kit gets better, and how anyone can tell that it did. `SPEC.md` says what the kit is
today; this file says how a change to it is judged. Everything in the spec is open: shapes, level
of detail, motion, how parts fit a phone. A round that earns a change writes it into the spec.

Order of work (the owner's, 17 November 2026): the voxel version is climbed first and the full
set of parts is built in it. The plain web version is made after, from the settled result.

## 1. The floor

A round may not break any of these. Run them against your own server; a pass on another port
proves nothing.

```sh
PORT=5989 node tools/shift.mjs      # nothing moves when voxels take over from plain
PORT=5989 node tools/board.mjs      # the board and tab strips fit narrow screens
PORT=5989 node tools/behave.mjs     # the same behaviour plain and live
PORT=5989 node tools/keys.mjs       # keyboard: tab order, rings, arrows, Escape
PORT=5989 node tools/crisp.mjs      # words on keys and canvases start on whole pixels
PORT=5989 node tools/contrast.mjs   # 7:1 body text, 4.5:1 quiet text and labels
PORT=5989 node tools/select.mjs     # lettering is text: it selects, copies, and plays
PORT=5989 node tools/film.mjs       # every motion, frame by frame: must end "rehearsal passed"
node tools/root.mjs http://127.0.0.1:5989   # the address a person is given
```

Both renderers: once with `node tools/serve.mjs`, once with `--engine`. Check each gate's own
exit code; a pipe into `tail` hides it.

## 2. Numbers

Where a number exists it is read before anyone gives an opinion.

| Number | Tool | Today |
|---|---|---|
| Gates passing, both renderers | section 1 | all |
| Motion: time to settle against the spec's range; `no response`, `pop`, `snap`, `empty frame` | `film.mjs` | passes |
| Parts built, of the full set (shadcn's and Bootstrap's lists) | the inventory, section 5 | 13 of about 53 |
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

Exists: button, switch, slider, text field, card, list, menu, dialog, tabs, meter, toast, block,
lettering.

To build, in this order:

1. **Forms:** checkbox, radio group, select, field errors, input group, number stepper, toggle
   button and group.
2. **Reading:** prose (headings, links, quote, code, kbd), table, separator, badge, callout,
   avatar, figure, breadcrumb, pagination, skeleton, spinner, empty state.
3. **Overlays:** accordion, tooltip, popover, alert dialog, sheet, context menu, hover card.
4. **Navigation:** navbar, sidebar, menubar, command palette, combobox, scroll area.
5. **Heavy:** calendar and date picker, carousel, data table, chart, resizable panels, code input.

Also: the theme picker.

## 6. Log

| Round | Date | What | Result |
|---|---|---|---|
| 0 | 2026-11-17 | Baseline of the kit as merged at `bf55acd` | see `shots/baseline/` |
