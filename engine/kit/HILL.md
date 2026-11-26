# The hill

How a change to the kit is judged, for anyone changing a part or the look. [SPEC.md](SPEC.md)
says what the kit is today; this file says how to tell that a change made it better and broke
nothing. Everything in the spec is open to change: shapes, level of detail, motion, how parts fit
a phone. A change that earns its place is written into the spec.

## 1. The floor

Every change passes these gates. Run them from `engine/kit` with the showcase server up
(`PORT=5989 node tools/serve.mjs`).

```sh
cd engine/kit
PORT=5989 node tools/shift.mjs      # nothing moves when voxels take over from plain
PORT=5989 node tools/board.mjs      # the board and tab strips fit narrow screens
PORT=5989 node tools/latch-fit.mjs  # ink clears the shutter, light stays inside, closed lamps are dark
PORT=5989 node tools/behave.mjs     # the same behaviour plain and live
PORT=5989 node tools/keys.mjs       # keyboard: tab order, rings, arrows, Escape
PORT=5989 node tools/crisp.mjs      # words on keys and canvases start on whole pixels
node tools/contrast.mjs             # 7:1 body text, 4.5:1 quiet text and labels
PORT=5989 node tools/select.mjs     # lettering is text: it selects, copies, and plays
PORT=5989 node tools/film.mjs       # every motion, frame by frame: must end "rehearsal passed"
PORT=5989 node tools/seam.mjs       # a renderer handed to the kit: late, none, failing, lost
PORT=5989 node tools/default.mjs    # who draws when no renderer is handed over
PORT=5989 node tools/feel.mjs       # keys answer the hand alike plain and live; no two strokes sound the same
node tools/root.mjs http://127.0.0.1:5989   # the address a person is given
```

The engine's renderer is the default, so the gates run on it. Check each gate's own exit code;
a pipe into `tail` hides it. `node tools/css.mjs --check` and `PORT=5989 node tools/parts.mjs`
are worth running beside these when a change touches `css/` or a part.

## 2. Numbers

Where a number exists, read it before anyone gives an opinion.

| Number | Tool |
|---|---|
| Gates passing | section 1 |
| Motion: time to settle against the spec's range; `no response`, `pop`, `snap`, `empty frame` | `tools/film.mjs` |
| Every part's page at 390 and 1280, plain and live, by day and night | `tools/parts.mjs` |
| Before against after, every page and every part state | `tools/baseline.mjs` |

## 3. Look and feel

Scored 1 to 10 each, by reviewers who see the pictures and this rubric and not the target. One
strong model from each provider at least. Scores are opinion; agreement between
reviewers is the signal, and the owner's eye outranks all of them.

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

The short form of the five ways a look fails: too much, wireframe, boxed, flat, bland.

Give reviewers references beside the kit's pictures, because a design scored alone scores high.
`node tools/refs.mjs` shoots other kits' public demo pages the same way. Drop a reviewer that
describes what is not in the picture.

## 4. A round

1. Say what is being tried and which criterion or number it should move.
2. Shoot before and after with the same tool: `PORT=5989 node tools/baseline.mjs <name>`, then
   `PORT=5989 node tools/baseline.mjs --compare <before> <after>`. Film any motion that changed.
3. Run the floor.
4. Score. Report the numbers as they are: a round that did not move the measure says so.
5. Keep, change or drop. What is kept goes into `SPEC.md`.

Judge candidates on the real kit, never on flat stand-ins. While a direction is still open,
compare several side by side before polishing any of them.
