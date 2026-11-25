# Learning log: the villager look regroup (#47, November 7, 2026)

Read this before the next look round. It follows `.agents/skills/ui-craft` "Plateau: regroup, then go bolder".

## The ceiling

Two complaints came back in every round and from every model.

1. **The scarf reads as a tongue.** The owner-colour scarf's hanging tail looks like a tongue, worst on
   the phone and in close views. We only ever fixed it in the prompt ("tails off to one side"), so the
   model's geometry kept producing it. The new geometric check (below) finds hanging owner-colour parts
   on **all 8 of 8** round-4 reference villagers, two tails each. Moving the tail to the side of the
   chest does not help, because at 70 px any coloured strip under the mouth reads as a tongue.
2. **Marks get lost in busy bodies.** In round 4's blind test, Opus and Sol each scored 17/20, and both
   missed the same three: the hedgehog maker's lens among its spines, the snail gardener's sun hat
   against its shell, and the sheep carer's stocking cap against its wool. The checks pass on outline
   alone. A mark in a body-ish colour still loses to a busy outline, and no threshold on the outline
   can fix colour.

## The strategies

Each one is a code-arm prompt variant (`scripts/villagers/look-strategies.mjs`, exact replacements on
`style.md` and `arm-code.md` that stop the run if they miss) plus trusted code (`src/villagers/gen/assemble.ts`
`Strategy`), run with `run.mjs --strategy=a|b|c`. Leaving the flag unset gives today's scarf look.

- **A, a tidy owner band.** A snug collar or an armband, with nothing hanging from it. Trusted code
  removes any owner-colour part that hangs below the chin in front of the face (`checks.ts accentTails`:
  below the head core, inside the head's width, in the front half, taller than wide). Marks must break
  the outline by 0.15 H instead of 0.1 H, and the prompt asks for marks half again as big, in a colour
  apart from the body, on spiny, shelled or woolly bodies.
- **B, an owner badge.** No scarf. The owner colour is one round felt badge on the chest. Trusted code
  recolours the mark to cream, charcoal or plum, whichever is farthest in OKLab from the two colours
  that cover most of the villager. The owner-colour outline in `feltKit` only shows when the villager
  is pointed at, so at rest the badge carries the owner colour on its own.
- **C, too bold: the role mark is the owner colour.** Silhouette means role and colour means owner.
  Trusted code dyes every `villager.mark()` part in the owner's felt, and the prompt drops the scarf
  entirely.

## The run

These are real Sonnet calls through `claude -p` (code arm, not mocked): 8 villagers per strategy, run one
strategy after another with concurrency 3, on dev server 5332. The 8 are the hedgehog maker (Mia), the
snail gardener (Alex) and the sheep carer (Sam), which are the three hard cases, plus the round-1
tortoise keeper (Alex), two cooks with different owners (badger for Alex, fox for Sam), a giraffe
tidier (Robin) and a sparrow messenger (Sam). They are the `regroup` set in `descriptions.json`.

The round-4 reference uses the same 8 from round 4 (`r4-*`), measured with today's code. One exception:
the tortoise had no round-4 run, so it is round 3's rerun tortoise `r3-code-1` (`--checks=off`, because
it predates `villager.mark()`).

## The numbers

Owner colour is measured on the 128 px dollhouse-heading render (`readability.mjs`), with owner-colour
parts in red. "Hanging" counts villagers with an owner-colour part hanging in front of the face.

| | Owner px, min / median | Share of figure, min / median | Hanging | Species check | Mark check | First try | Repairs | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Round 4 (scarf) | 158 / 190 | 7.8% / 10.1% | 8 of 8 | 8 | 8 | n/a | n/a | n/a |
| A owner band | **0** / 68 | 0.0% / 3.1% | 0 (1 trimmed: the tortoise) | 8 | 8 (at 0.15 H) | 8 | 0 | $0.79 |
| B owner badge | 100 / 121 | 4.2% / 5.2% | 0 | 8 | 8 | 8 | 0 | $0.75 |
| C mark is the owner colour | 44 / **544** | 1.9% / **23.1%** | 0 | 8 | 8 | 8 | 0 | $0.70 |

The median call took 69 to 71 s.

The snail gardener in B and C was first refused as "the head itself is tagged". That was a false
positive in `checks.ts markBreak`: a sun-hat brim tilted back, as the role table asks, has a world
bounding box that swallows the eyes. The check now tests the eye in the part's own axes. Both first
tries then pass unchanged, with no regeneration (recorded as `recheckedAfterCheckFix` in those
results), and `check-villager-gen.mjs` still passes 35 of 35.

Per strategy, `readability.md` holds the rows, including the C-arm's per-villager owner px: lowest
is the tortoise keeper's pencil (44 px) and the hedgehog's lens (158 px). Highest are the sun hat,
the plume and the stocking cap (544 to 600 px).

## What the sheets show (my eye, not the council's)

- **A.** The tongue is gone, and so is most of the owner colour. Collars hide under heads and the
  tortoise's under its shell, showing 0 px. The sheep's cap came out rust, the same hue family as
  another owner's red. Marks are darker and bigger, and the hedgehog's lens reads better than round 4.
- **B.** Badges show, about 120 px each, but on the snail the red badge sits right under the mouth and
  reads as a bib or a tongue. The problem moved, it was not removed. Charcoal toques read as stovepipe
  hats rather than chef's hats. The contrast tone helps the hedgehog's lens and the sheep's cap.
- **C.** This one reads at a glance. The sheep's blue cap, the snail's red sun hat and the giraffe's
  green plume all win against wool, shell and spots. The two cooks, with a red toque and a blue toque,
  read as different owners at dollhouse distance. It is weak where the mark is thin: the keeper's
  pencil and the maker's lens carry little colour. The lens also looks like a halo in the close view.

## The bet

**C.** One strong element, with shape for the role and colour for the owner, beats a scarf or badge
competing with a body-coloured mark. It has the highest owner area (median 2.9 times round 4), nothing
hangs, and trusted code owns the colour, so the model cannot get it wrong. To make it safe:

1. Set an owner-area floor for thin marks. Either trusted code thickens the pencil and the lens ring to
   a minimum radius, or the role table gives the keeper and maker marks some mass (a pencil as thick as
   an ear, a lens with a thick rim).
2. Re-check the role table's colours. A red sun hat or a green chef's toque is fine for felt, but the
   owner may want a word.
3. Close the gap that a hand-coloured mark and an owner-coloured mark now look alike: forbid the
   accent everywhere except on the mark (C already says so in the prompt, but trusted code does not
   strip it).

## Council: blind silhouette and owner tests (to fill in)

- Blind role test on each `regroup-look/<a|b|c|r4>/readability-silhouettes.jpg` (key in `readability-key.md`):
  Opus __/8, Sol __/8 per strategy. Did the hedgehog lens, the snail hat and the sheep cap read?
- Owner test on the colour sheets: can each villager be matched to an owner (Alex rust, Sam blue,
  Mia mustard, Robin green)? Do the two cooks read as different owners? Opus __/8, Sol __/8 per strategy.
- Tongue test on `regroup-look/hard-cases-side-by-side.jpg`: does anything read as a tongue?
- Scores out of 10 and the winner:

## Files

- `regroup-look/hard-cases-side-by-side.jpg`: the three hard cases across round 4, A, B and C, each with
  its dollhouse tile and close view.
- `regroup-look/<r4|a|b|c>/`: `readability-colour.jpg` (dollhouse distance), `readability-silhouettes.jpg`
  with `readability-key.md`, `readability-accent.jpg` (owner colour in red), close views of the hard cases,
  and `readability.md`.


## Council, blind (lead, November 7)

The four sets were shown under neutral letters (W = round 4, X = C, Y = A, Z = B), with only the
legend of owner colours and role marks. Each model named every villager's owner and role at
dollhouse distance, then scored the set (owner / role / appeal / defects).

| Set | Opus answers (owner, role) | Opus scores | Sol answers (owner, role) | Sol scores |
| --- | --- | --- | --- | --- |
| W round 4 | 8/8, 8/8 | 5 / 6 / 6 / 6 | 8/8, 8/8 | 8 / 6 / 7 / 4 |
| X **C** | 8/8, 8/8 | **7 / 8 / 7 / 7** | 7/8, 8/8 | **8 / 7 / 8 / 7** |
| Y A | 7/8, 8/8 | 4 / 7 / 5 / 3 | 8/8, 8/8 | 5 / 6 / 7 / 5 |
| Z B | 8/8, 8/8 | 5 / 7 / 5 / 4 | 8/8, 8/8 | 9 / 6 / 6 / 3 |

Both picked X (C). Accuracy is near the ceiling with 8 villagers, so the scores separate the
sets. Lessons:
- Fixing the defect in place (A trims the tail, B moves the colour to a badge) moved the problem
  rather than removing it: both A and B read as bibs or tongues.
- Merging two signals into one element (the role mark carries the owner colour) removed the
  scarf entirely and raised contrast against busy bodies.
- Remaining for C: thin marks (the pencil) carry too little colour, as Sol's one owner miss
  shows; body felt close to an owner hue (red bird, orange fox) competes with the mark; and
  there are stocking-cap gaps and floating tools.

Adopted: C.

Round 5 (C as the default, the owner-area floor, felt kept off the owners' hues, props in hand): see the
README's "Look regroup and round 5" and `round5/`.


## Round 5 council, blind (lead)

| | Owner (colour sheet) | Role (colour sheet) | Role (silhouettes) | Appeal | Defects |
| --- | --- | --- | --- | --- | --- |
| Opus | 20/20 | 20/20 | 17/20 | 6 | 6 |
| Sol | 20/20 | 13/20 | 13/20 | 8 | 7 |

The owner is solved: both models scored 20 of 20. Roles split the models.
- **Sol** read 4 cooks as tidiers: the toque and the duster plume are both a round puff above the head.
- **Opus** saw mortarboards that look like signboards held overhead, and marks floating off heads.

The lesson: two marks of the same shape class at the same place fail, even when their outlines differ in detail. Position must differ as well as shape.

Round 6 (README "Round 6", `round6/`): the toque is a tall pleated column, the plume is held out beside the head, the board lies on a skullcap, and every marked part must sit on what holds it, measured on the triangles with a minimum joint width. On round 5's 20 these checks refuse 10, including all three pom-poms, which touched their caps only at a needle point. Both round-5 plumes were already well to the side, so the cook/tidier mix-up came from the toque's round puff.


## Round 6 council, blind (lead)

| | Owner (colour sheet) | Role (colour sheet) | Role (silhouettes) | Appeal | Defects |
| --- | --- | --- | --- | --- | --- |
| Opus | 20/20 | 20/20 | 20/20 | 6 | 6 |
| Sol | 20/20 | 20/20 | 20/20 | 8 | 7 |

Readability is solved: both models named every owner and role on both sheets. Sol's role score on silhouettes went from 13 to 20 once the toque became a tall column. What is left is appeal: mortarboards and sun hats are oversized flat slabs that hide heads, and dusters look like lollipops.

Round 7 (README "Round 7: appeal", `round7/`): the marks resized against the head core (board 1.0 to 1.4, brim 1.45 to 2.0 head widths), the face clear of the mark 20 degrees steeper than the camera, the plume at least 4 feathers, and a toque with a cloud of balls on top. Round 6's 20 fail 5 of these; round 7's 20 pass on first try or one repair, owner colour min 136 and median 425 px. Lesson: size a mark against what the eye reads as the head (with its ears), not the head core, or a big-eared elephant still wears a slab.


## Round 7 council, blind (lead)

| | Owner | Role (colour) | Role (silhouettes) | Appeal | Craft | Defects |
| --- | --- | --- | --- | --- | --- | --- |
| Opus | 20/20 | 20/20 | 20/20 | 7 | 6 | 6 |
| Sol | 20/20 | 20/20 | 20/20 | 7 | 6 | 5 |

Readability holds. Appeal is now at a plateau around 7: Opus went 6 → 7 and Sol 8 → 7.
- Opus: mortarboards are slabs that hover, with a ragged skullcap edge and a blob tassel.
- Sol: clipped, irregular eye shapes.

Both defects sit in parts the model builds from primitives (eyes, marks), and prompt tuning moves them only a little.

Regroup 2 (the look): a trusted felt kit. Village's own code builds the face (eyes, nose, smile) and each role mark, dyed in the owner's felt. The model gives the species body and the anchor points.


## Regroup 2: the trusted felt kit (builder P, November 7)

### The ceiling

Readability is solved (20/20 owner and role from both models, round 6 and 7), and appeal sits at 7. Every
defect the council named in rounds 5 to 7 is on a part the model builds from primitives: clipped, irregular eyes
(Sol), mortarboards as hovering slabs with a ragged skullcap edge and a blob tassel (Opus), and earlier lollipop
dusters and floating pom-poms. Prompt rules and checks only nudge these, because the model rebuilds them from
spheres and cylinders on every call.

### The strategy

Trusted code makes the parts that carry character and craft; the model keeps the species body and says where
things go. `src/villagers/gen/kit.ts`, applied in `assemble.ts` behind `kit` (`?kit=1`):

- **Face.** The anchor is the model's own `eye-left`/`eye-right`: their mean height and spacing, mirrored about
  the head's middle so the pair is always symmetric, and each eye's facing (its thinnest own axis). A ray along
  that facing finds the felt; a domed glossy button (radius 0.06 of the head core's width, sunk a little so its
  rim never stands off a curved face) and a small highlight go there, in the eye slot so blinking still works.
  A felt cheek goes below and outside each eye, only on the face the eye sits on (round one put them on the
  elephant's tusks). The model's eye meshes are dropped; its snout, nose, mouth and ears stay.
- **Marks.** The role comes from the checked spec. The model's marked parts are dropped and the kit builds the
  role's mark from the head core (an ellipsoid fitted to the largest unmarked head part) and the outline with
  ears, dyed in the owner's felt with a darker and a lighter tint of the same hue for bands, cords and pom-poms:
  - cook: a stitched band sunk in the crown, a pleated column flaring a little, a cloud of 6 balls round a centre ball;
  - tutor: a skullcap hugging the crown (tilted back, clean edge), a stitched rounded board 1.1 to 1.28 head widths
    lying on it, a button, a cord to the front corner, and a tassel cap with 7 hanging strands;
  - gardener: a domed crown with a ribbon, a lens-shaped felt brim with a rolled stitched edge, tilted back only
    0.22 rad (a brim tilted back 0.5 is edge-on to the dollhouse camera), and moved back on the head until the
    eyes show from 25 degrees steeper than the camera, so it passes the face check by construction;
  - carer: one bent knitted tube with ribs, a ribbed band, and a pom-pom of 9 balls over the blunt end;
  - keeper: an octagonal pencil 0.42 H with eraser, ferrule, sharpened tip and lead, sunk in the head's side;
  - maker: a hinge knob on the temple, an arm, and a thick open ring beside the head;
  - tidier: a knot on the model's own handle (the held part nearest the model's plume) and 7 feathers fanned
    across the view;
  - messenger: a pole from where the model fixed its pole to the back, a waving stitched flag to the model's side, a finial.

### The comparison (no model calls)

The kit is a post-process on round 7's 20 saved modules (`home/generated/villagers/r7-*`), so the two sets have the
same bodies. `results.json` was rebuilt from each `meta.json`. Both measured with today's code, seed 61.

| | Round 7 | Kit |
| --- | --- | --- |
| Pass every check (enforced) | 20 | 20 (19 on the first kit pass: the hippo's brim covered the eyes at 10 degrees steeper; the kit now moves the hat back until it clears) |
| Owner colour, trusted, min / median px | 136 / 425 | 103 / 723 |
| Visible accent, min / median px; median share of the figure | 132 / 443; 18.6% | 101 / 774; 34.2% |
| Nearest silhouette same role; within / between IoU | 30%; 0.596 / 0.549 | 25%; 0.593 / 0.538 |
| Loose mark parts | 0 | 0 |
| Board across (head core widths) | 1.27, 1.35 | 1.28, 1.28 |
| Brim across | 1.59 to 1.70 | 1.76 to 1.89 |
| Face clear past the mark, degrees steeper than the camera | 30 to 40 on gardeners and tutors | 25 (gardeners 04, 06), 35 (tutors), 30 to 40 (carers), 45 elsewhere |
| Toque rise over width | 1.27 to 1.43 | 1.25 to 1.26 |

The lowest owner area is the hedgehog's plume (103 px): its handle is short and low, so the kit's plume sits beside
its spines. The kit's marks are bigger on average (median owner area 1.7 times round 7), mostly tutors' boards
(1438 and 1808 px) and the stocking caps (about 1100).

The hand-made Dumpling, Moss and Tuft do not change: `kinds.ts` is untouched, their triangle and mesh counts and
heights match before and after, and the screenshot differs from before by 30,690 pixels against 31,452 between two
runs of the same code (the idle animation).

### My impression (not the council's)

The kit fixes what it was built for, and the swing is smaller than a regroup should give.

- Better: the eyes. Every pair is the same round glossy button with a highlight, symmetric and set on the felt,
  with a soft cheek; the faces read as one set and as sewn rather than modelled. Stocking caps are clearly knitted
  caps with a real pom-pom; toques are pleated; the tutor's skullcap now shows as a clean band under the board and
  the tassel is a fringe, not a blob; flags wave.
- Same: dusters (the round-7 fans were already fine; the hedgehog's is still small), pencils and lenses.
- Worse or open: the elephant's board is still a big flat slab from the dollhouse view; rabbit ears go through
  the board and the brim (the kit does not cut holes); the sun hat sits further back, so from above it is a
  halo behind the head more than a hat on it; owner colour is heavier (34% of the figure at the median).
- Caveats: the owner-area numbers count the kit's darker and lighter tints of the owner's hue (bands, cords,
  pom-poms) as owner colour. The kit reads the role from the model's `villager.about()` (checked), not from
  the runner's request, so the mark is only as trusted as that declaration (20 of 20 agree in round 7); if
  adopted, pass `Meta.role` into `assemble`. All 20 villagers had both kit eyes land on the felt.

Side by side (`regroup-look-2/side-by-side.jpg`), I would score the kit about half a point above round 7 on
appeal and craft, not 2. Its larger value is that the face and the mark are right by construction: the model
can no longer clip an eye, float a pom-pom or draw a lollipop, and no repair call is spent on them.

### Tokens and latency (proxy, no real calls)

The kit stays behind the flag, so the prompts are unchanged and no real Sonnet generations were run for it. On
round 7's saved output, lines that build eyes and marks are about 15% of the module text (12,019 of 81,780
characters; 11% of the raw replies). Dropping them from the prompt and the output would save roughly that share
of output tokens and generation time, plus the role-mark table and the mark checks in the system prompt, and the
repairs mark checks cause (round 7 repaired 3 of 20; one was a mark, the elephant's skullcap taken for its head).

### For the council

- Colour sheet `regroup-look-2/kit/readability-colour.jpg` (key `readability-colour-key.md`), silhouettes
  `kit/readability-silhouettes.jpg` (key `readability-key.md`), closes `kit/r7-{11,12,04,07,08,01}-close.jpg`.
- Reference: the same for round 7 in `regroup-look-2/r7/` (a fresh shuffle, seed 61, so the numbering differs from round 7's own sheets).
- `regroup-look-2/side-by-side.jpg`: the six close-view villagers, round 7 against the kit.

### Files

`src/villagers/gen/kit.ts` (new), `src/villagers/gen/assemble.ts` (`kit` flag), `src/villagers/gen/load.ts`
(`&kit=1`, `trial({ kit })`), `scripts/villagers/readability.mjs` and `measure-marks.mjs` (`--kit`).


## Look regroup 2 council, blind (lead)

G is the kit and H is round 7: the same 20 bodies, plus six matched close views.

| | Appeal | Craft | Readable | Defects | Pairs won |
| --- | --- | --- | --- | --- | --- |
| Opus, kit | 7 | 7 | 7 | 6 | 6 of 6 |
| Opus, round 7 | 5 | 4 | 6 | 3 | 0 |
| Sol, kit | 8 | 8 | 8 | 7 | 6 of 6 |
| Sol, round 7 | 6 | 5 | 7 | 5 | 0 |

Adopted: the kit. The builder's own estimate was about half a point; the council scored it 1.5 to 3 points better on craft. The lesson: put the parts that carry character and craft (eyes, accessories) in trusted, hand-made code, and let the model own what has to vary (species body, placement). What remains: oversized hats (the mortarboard is still a slab from above), thin lenses, and held props that don't convincingly attach.


## Round 8: the kit as the default (builder R)

The kit is on everywhere (`&kit=0` only to debug). The model tags an eye disc on each side and one small anchor
(crown, ear side, back, or the duster handle's top knot); the requested role, not `about()`, picks the mark. Fixed
from the council: the board is about the head's width at the crown (1.04 to 1.18 head cores) and thinner; the sun hat
sits on the head and tilts its front up instead of sliding back; ears come up through stitched felt holes in the crown,
skullcap, board, brim or cap, and the toque narrows between them; the lens has a thicker rim, a longer arm and glass;
held props are moved so the handle runs through the mitten, with a felt wrap.

Real Sonnet, the readability 20: first call median 65 s (round 7: 85 s) and 6,148 output tokens (round 7 was not
recorded; round 6 was 8,128), $1.79 (round 7: $2.29). 16 first try, 4 repaired, 20 usable. Two repairs were partly the
kit's own fault: the beaver's pencil showed 98 px of owner colour (now thicker), and the hedgehog's plume sat too close
to its head on a short handle (a short handle is now lengthened). Repairs are from the run-time kit; the owner colour
and the sheets are from the final one.
Owner colour min 143, median 704 px.

Lessons: the prompt shrank by the whole role table and most of the checks list, and the model spent the saving on
nothing else: output fell about a quarter. Sizing a hat against the head's width at the hat's own height (ears there,
not ear tips) is what keeps a rabbit's board from being sized to its ears. A hat tilted, not slid, reads as worn.

Open: a few bodies are weak on their own (the "rabbit" gardener has short round ears, the "badger" cook reads as a
panda); a narrowed toque between round ears is a stovepipe; the keepers' pencils carry the least owner colour (143 to
151 px); the blind council on `round8/` is next.


## Round 8 council, blind (lead): the kit is the default

| | Owner | Role (colour) | Role (silhouettes) | Appeal | Craft | Defects |
| --- | --- | --- | --- | --- | --- | --- |
| Opus | 20/20 | 20/20 | 18/20 | 7 | 6 | 6 |
| Sol | 20/20 | 20/20 | 19/20 | 8 | 7 | 7 |

The kit made the eyes and marks right by construction, and it is cheaper: about a quarter fewer tokens, a 65 s median against 85 s, and $1.79 against $2.29. Craft is held at 6 to 7 by the body itself. Sol saw the elephant's trunk as "overlapping cylinders, not a continuous sewn plush form". Opus found that ears poke through hats awkwardly. The model builds bodies from separate primitives, and prompting cannot make that seamless.

Look regroup 3 (the last of about three): sewn skin. Trusted code fuses the model's body parts into one smooth felt surface (smooth union, then a remesh, using three's own MarchingCubes addon; no new dependency). Hats sit between or behind ears instead of being cut with ear holes.


## Regroup 3: sewn skin (builder T, November 7)

### The ceiling

The kit fixed eyes and marks; craft held at 6 to 7 because the body is still separate primitives pushed into each
other. Sol: the elephant's trunk is "overlapping cylinders, not a continuous sewn plush form". Opus: ears pierce hat
crowns and boards, and the elephant's board floats over a barely visible skullcap. Prompting cannot make primitives
seamless, and round 8's stitched ear holes are a patch over a hat that sits in the wrong place.

### The strategy

Trusted code turns each rig slot's felt into one sewn surface (`src/villagers/gen/skin.ts`, behind `&skin=1`, the
scripts' `--skin`; no new dependency):

- **Shapes.** Each matte, unmarked part (not eyes, held prop or kit parts) is matched to the analytic shape its
  vertices lie on, in its own axes with its transform folded in: sphere (ellipsoid when scaled), capsule, cylinder or
  cone, box or rounded box, torus. Three's primitives put every vertex exactly on that surface, so the fit test is
  "max |SDF| at the vertices under 1.5% of the size". A part that fits nothing, is sheared, or is thinner than 2.2 grid
  cells keeps its own mesh (whiskers, thin tails, tortoise shell rings).
- **Fusing.** Smooth minimum, blend 0.03 of the height, sampled on a grid (head height / 42 cells for the head, / 32
  for the rest), contoured with surface nets (my own, about 60 lines; three's `MarchingCubes` is a cubic metaball box
  with a poly cap). Each vertex is pulled onto the exact field with one Newton step and takes its normal from the
  field's gradient, so a coarse grid shades smooth.
- **Rig.** Fusing is within a slot only: the body (pose), the head, each foot, a hand with 2 or more parts. Head turn,
  nod, hand swing and steps all still work; nothing blends across a moving joint, so the neck and leg tops are
  still two surfaces meeting.
- **Colour and seams.** Each vertex takes the felt of the nearest part; triangles where two felts meet are cut on the
  line where both are equally near (shared cut vertices, projected onto the field), one mesh per felt, and a running
  stitch (a short flat dash per cut segment, in a thread darker than both) lies along every seam. Felt texture is
  fuzz only, mirrored, triplanar in the node material (`triplanarTexture`), so no UVs and no seam line repeated.
- **Checks.** All checks run on the model's parts first, as before (species, mark and board widths are measured on
  separate ears and head cores). Then the skin replaces the parts, the kit's buttons and cheeks are moved out with the
  surface under them (`userData.onFelt`), and the face test runs again on the skin (`checks.ts faceViews`, the same
  rule `inspect` uses). A budget of 1.5 times the parts' triangles triggers one rebuild on coarser cells.
- **Hats around the ears** (`kit.ts around`, on with the skin): no grommets. The tutor's board and a deeper skullcap
  (reach 1.2 rad, so it shows under the board) turn together over the crown, back first, and narrow, until no ear
  crosses the board or comes out of the cap, the face shows 25 degrees steeper than the camera, and the board still
  rises a tenth of the height. The sun hat moves at most 0.45 head depths and tilts to -0.8; the toque slides along the
  crown to where the ears leave the most room and narrows to 0.24 at most (round 8: 0.22). When nothing fits, round 8's
  stitched holes stay, and the kit says so.

### The numbers (no model calls, round 8's 20 saved modules)

`scripts/villagers/skin-bench.mjs r8- --runs=3 [--skin]` (fastest of 3, the sandbox and assembler in the page, all checks on):

| | Round 8 | Sewn skin |
| --- | --- | --- |
| Pass every check | 20 | 20 |
| Triangles, median / max | 12,884 / 15,988 | 15,096 / 20,590 (per villager 0.91 to 1.47 times) |
| Meshes (a proxy for draw calls; the shadow pass doubles both), median | 37 | 32 (hedgehog 47 to 30, sheep 45 to 35) |
| Skin build, median / max | n/a | 34 ms / 123 ms (hedgehog, rebuilt once on coarser cells; includes the face re-check) |
| Assemble, median | 100 ms | 152 ms (the skin's 34 ms plus the hat placement search, which skin ms does not time) |
| Owner colour, min / median px | 143 / 704 | 143 / 685 |
| Nearest silhouette same role | 30% | 25% |

Hats: the elephant's board now sits on a visible skullcap with no holes; both cooks' toques moved forward 0.3 head
depths and narrowed to 0.24 (badger, fox); the hippo's sun hat moved back 0.45 and tilts -0.65. Still stitched holes:
both rabbits (04 sun hat, 11 board) and the snail's stalks (05). A first search without limits put the hippo's and the
rabbit's sun hats behind the head at -0.95 to -1.1: a halo, worse than holes, so the search is capped.

Dumpling, Moss and Tuft are unchanged: `kinds.ts` is untouched and the skin is off by default (`check-villager-gen.mjs`
80 of 80, `check-prop-sandbox.mjs` 40 of 40).

### My impression (not the council's)

The skin does what it was built for in close view. The elephant's trunk is one tapered, curled form growing out of the
face, the tusks are sewn on, the badger's eye patches and belly are stitched panels, the hippo's muzzle has a seam
round it, the hedgehog's spines grow out of its back. It reads as sewn rather than assembled. At dollhouse distance the
sheets barely change: the swing is in the close views, which is where the craft complaint came from. I would put it at
about half a point to a point on craft, not more, because what remains is the neck and leg joints (two surfaces still
meet), the hats, and the bodies' own proportions.

### What is weak

- No blend across moving joints: head on body, legs on body, arms on body still meet as two shapes.
- The hats are half solved: three of seven hatted villagers keep stitched holes, and the hippo's sun hat sits well back.
  A sun hat between short ears would need a different hat (a narrow crown perched between the ears with the brim above
  their tips), and a rabbit's mortarboard has no place that avoids tall ears without hiding the face.
- The grid is coarse (about 69 cells round the elephant's body): silhouettes show soft facets up close, and parts under
  2.2 cells stay separate primitives.
- Parts a model paints with its own texture would lose it in the skin (none of the 20 do).
- Assemble is about 50 ms slower at the median; under the 150 ms budget for the skin itself, worst case 123 ms.

### For the council

- `regroup-look-3/skin/` and `regroup-look-3/r8/`: the same seed (63), so the colour and silhouette sheets share their
  numbering and keys (`readability-colour-key.md`, `readability-key.md`); closes `r8-{01,04,07,08,11,12}-close.jpg`
  (badger, rabbit gardener, hedgehog, giraffe, rabbit tutor, elephant). The `r8/` set is round 8 rendered again with
  today's default code, not a copy of `round8/`, so the shuffle matches.
- `regroup-look-3/side-by-side.jpg`: the six, round 8 against the sewn skin.

### Files

`src/villagers/gen/skin.ts` (new), `assemble.ts` (`skin` flag, the swap, the re-seat, the face re-check, the budget),
`kit.ts` (`around` hats, `domeCrossings`, `onFelt`), `checks.ts` (`faceViews` taken out of `inspect`), `load.ts`
(`&skin=1`, `trial({ skin })`, timing), `scripts/villagers/readability.mjs` and `measure-marks.mjs` (`--skin`),
`scripts/villagers/skin-bench.mjs` (new).


## Look regroup 3 council, blind (lead)

| | Appeal | Craft | Readable | Defects | Pairs won |
| --- | --- | --- | --- | --- | --- |
| Opus, skin | 7 | 6 | 7 | 5 | 5 of 6 |
| Opus, round 8 | 6 | 5 | 7 | 5 | 1 |
| Sol, skin | 8 | 7 | 8 | 6 | 4 of 6 |
| Sol, round 8 | 8 | 6 | 8 | 7 | 2 |

Both models picked the skin: it reads as one sewn plush up close. At dollhouse distance the two look the same. The skin brought its own artifacts: ragged attachment edges, stray pale flecks, the elephant's board floating (the hat is placed against the pre-skin surface), and the panda's head squashed. Adopted, with those fixed.

**The ceiling, after three look regroups:** appeal is 7 to 8, craft 6 to 7, and readability is solved (owner and role 20 of 20 for both models).

Reaching 9 on craft would take one of these:
- (a) a real skinned rig, with one mesh and bone weights, so necks and limbs blend across moving joints;
- (b) hand-authored base meshes per body plan that the model only parameterises (less variety, more polish);
- (c) a finer grid and sculpted felt detail (more triangles).

Each is a larger unit than a polish round. (a) keeps the most variety.
