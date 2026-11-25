# Villager setup: learning log

Read this before every round. Round scores and what changed per round are in `NOTES.md`.

## Regroup 1 (November 7, 2026)

### The ceiling

Six polish rounds of the bench (`&setup=1`, every tool on the table at once) plateaued at 7 to 8
from Opus and GPT-6.1 Sol. The complaints that kept coming back, and why more tuning cannot fix them:

| Complaint (rounds) | Why tuning can't fix it |
| --- | --- |
| How each object works isn't self-evident (2 to 5) | Nine tools share one view, so each gets a 14 px tag and a stitched arrow at best. There is no room to say how a tool moves next to the tool. |
| Tablet and phone: tags crowd the villager and the slip (2 to 6) | About ten HTML tags pinned to 3D points on a perspective tabletop. Every size trades one overlap for another; the layout gate keeps them apart, not readable. |
| Villager scale and framing compete with the tools (4 to 6) | The camera must fit the villager and a 1.7 m bench. Round 6 shrinks a tall villager to two fifths on a phone to make room. |
| Floating paper panels (3 to 6) | Paper over a 3D table either covers tools or floats over the rug. |
| The waiting doesn't focus on the sewing (2 to 5) | The phone keeps the rack, the mat and the slip in one frame. |

### The three strategies

All three share the slip, the patterns, the waiting, the stitching, the persona, the host, the
voice and the send-off with the bench. Every value still goes through the tools' `set()`, so the
jokes lock ("set by the household's admin") and the host's pin hold on every surface. Each waits
close over the mat at every size (the bench keeps the phone's wider frame). Flag:
`?villager=gen&setup=a|b|c`. Code: `src/villagers/gen/setup-{a,b,c}.ts`, the parser in
`setup-talk.ts`, the hooks in `setup-strategy.ts`.

- **A, one tool at a time.** The villager stands big on the mat. The tools lie in an open sewing
  tin on the table, each compartment's name stitched on its felt. Clicking one (or Enter on its
  name in a keyboard list) holds that one tool up in front of the camera, big, with its two ends
  written beside it ("smaller", "bigger") and one line on how it moves ("Pull the tape out, or
  push it back in"). The other tools stay in the tin; clicking another swaps them; Escape or
  "Put it back" returns it. At most one control is out.
  Changes: one control at a time, so it gets room to explain itself; the tags no longer compete.
- **B, a fitting mirror.** Straight on, no tabletop: the villager stands in a tall felt-framed
  mirror. A tape measure runs up the left of the glass; its brass marker sits at the villager's
  head, and dragging it sets their height. Felt colour dots run along the bottom. On the right:
  pitch, pace and energy dials, three short manner ribbons, and a clean / cheeky / crude switch with
  crude locked. Before there is a villager the right side holds the pattern swatches, hanging like
  fabric samples, and the slip is tucked into the glass. The 3D rack is hidden.
  Changes: the controls live in the frame, never over the 3D, so nothing overlaps the villager by
  construction; the composition is frontal and fixed.
- **C, no tools: talk to tune.** No tools on the table at all. After stitching, a paper slip says
  "Tell Brindle what to change". Trusted code (`parseTweak`) maps phrases to the nine values: "a
  bit taller", "warmer" (manner; "warmer colour" is the felt), "lower voice", "talk slower",
  "livelier", "less chatty", "more serious", "greener" (toward green whichever way that is for this
  felt), "keep the jokes clean", "undo", "as made". **Data only: no model call per tweak, and no
  model fallback.** A phrase it can't read changes nothing and says so. Each change is a stitched
  note with a felt swatch (the new colour for the felt, a bead on a stitch for the rest), and the
  newest has Undo. A paper card lists example phrases, each a button. The villager answers in its
  babble voice.
  Changes: removes the controls entirely; the screen is the villager and one slip.

### Scores

Captures: `regroup-1/{a,b,c,ref}/{wide,tablet,narrow}/` at the moments `1-empty`, `1b-picked`,
`2-waiting`, `3-tuning`, `5-walking`. Side-by-side sheets of the tuning moment:
`regroup-1/sheet-{wide,tablet,narrow}.jpg`.

Builder's first impressions (rough prototypes; scores are the council's to give):

- **A, tin.** The held tool with its one line ("Pull the tape out, or push it back in") and its two
  end words answers "how does this work" better than any bench round did, and the villager is big
  and uncluttered. But the held tool hangs in mid-air over the far chair on wide and tablet, so the
  floating complaint moves from paper into 3D. On wide the tin's tools and stitched names are small
  from that angle (the phone, where the tin is held low like a tray, reads well). Every change is
  three steps: pick, adjust, put back.
- **B, mirror.** Nothing overlaps by construction, and the phone is the best of the three: one frame,
  every control legible. The brass marker riding the villager's head is the best single affordance
  in the regroup. But it reads as a control panel dressed in felt: the kitchen-table workshop is gone,
  the villager is smallish in the glass on wide, the right rail has empty felt, and before there is a
  villager the glass shows mostly window.
- **C, talking.** The screen is the villager and one slip; there are no labels on the 3D at all, and
  the "Try saying" card makes it self-evident. It is Village's own interaction: you talk to
  villagers. But on wide and tablet the band of paper still sits over the rug below the table (the
  floating-panel complaint survives), you can't see where "a bit taller" lands within the range (the
  swatch's bead is tiny), a typed tweak is slower than a drag for colour, and anything off the
  parser's list is "didn't catch".

Council (Opus and GPT-6.1 Sol, belongs / clarity / hierarchy / craft / delight), to fill in:

| | A wide | A tablet | A phone | B wide | B tablet | B phone | C wide | C tablet | C phone | ref wide | ref tablet | ref phone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Opus | | | | | | | | | | | | |
| Sol | | | | | | | | | | | | |

### Bet

C. It removes the cause (labels pinned to 3D) instead of moving it, it turns tuning into the thing
Village is about (talking to a villager), and what is weak in it can be tuned within the strategy: lay
the slip on the table in front of the villager instead of over the rug, show each change as a stitch
with the bead's place between its two ends, and widen the phrase list from what people type. Take B's
lesson with it: when a fine control is needed, show one at a time outside the 3D (tapping a change
note could bring out just that tool, A's idea). The risk is that the council scores B's phone higher
for clarity, and that the parser's coverage is only as good as its list.

### Notes for the next round

- Another builder edited files in this worktree during the captures; Vite's hot reload then reloaded
  the headless pages and broke two runs. `check-setup.mjs` now starts Vite with no watcher and no hot
  reload, so an edit elsewhere can't reload a check mid-run.
- One hook object (`setup-strategy.ts`) and `front()` (frame the villager between given page rows,
  at its biggest size so a size change shows) let three strategies run the whole flow cheaply. Fit
  by scanning distance with panning, and drop any pose where a corner is behind the lens; the first
  version diverged to y = -400.

### What moved, what didn't

(to fill in after the council)


## Regroup 1 council, blind (lead, November 7)

Shown under neutral letters: P = C talk to tune, Q = A sewing tin, R = round-6 bench (reference), S = B fitting mirror.
Means over the five categories:

| Design | Opus wide / tablet / phone | Sol wide / tablet / phone | Opus's pick | Sol's pick |
| --- | --- | --- | --- | --- |
| P talk | 6.6 / 6.6 / 5.8 | 7.2 / 7.2 / 6.8 | | |
| Q tin | 6.4 / 6.4 / 6.4 | 7.4 / 7.4 / 7.8 | | |
| R bench | 7.6 / 7.6 / 5.6 | 7.4 / 7.4 / 5.6 | R | |
| S mirror | 7.0 / 7.0 / 7.2 | 7.8 / 7.6 / 7.6 | | S |

- Clarity: S is the clearest (Opus 9 at every size, Sol 8). Hidden adjustments sank both P (typed only) and Q (tools unlabelled in the tin).
- Belonging: S reads as "a felt-skinned form covering the house" (Opus belongs 5). R belongs (9) but collapses on the phone.
- Lesson: removing visible controls (P) hurts discoverability more than clutter does. Controls outside the 3D scene end overlap at every size (S), but they must stay part of the world.

Next, regroup 2: keep S's clarity and fix its belonging.

## Regroup 2 (November 7, 2026)

### The ceiling

B's clarity with the bench's belonging. B is clearest at every size because its controls sit outside the 3D,
but its frame is a felt form laid over the house. The bench belongs, but collapses on the phone.

### The two candidates

Flag: `?villager=gen&setup=d|e`. Code: `src/villagers/gen/setup-{d,e}.ts`; E reuses B (`setup-b.ts`, now with a
`grounded` variant and `park()`).

- **D, a real mirror in the room.** A cheval mirror (posts, brass finials, a frame swung forward on its pivots)
  and a felt fitting box stand at the table's left end, with the kitchen and window round them. The glass is a
  real `reflector()`: it shows the table, the floor and the villager's back. The villager stands on the box's
  pad. The controls are laid over the furniture's faces every frame from the camera: the tape up the left
  rail (the brass marker rides the head), colour dots pinned down the right rail, three dials on the top
  drawer, the three ribbons and the jokes switch on the lower drawer. Before there is a villager, the pattern
  swatches are tucked into the glass. A phone comes close, so the mirror is the width of the screen.
  The furniture is a fixed size, so a big villager is shown smaller while it is on the box (new `fit()` hook,
  the same mechanism as the bench's phone size); it grows to its tuned size as it hops down.
  Sizing: the `code-1` tortoise is about 0.66 m wide at size 0.5, so at full size it is wider than any
  dressing mirror. A floor cheval beside the table would have made it smaller on screen than B's, so the
  mirror stands on the table instead of beside it.
- **E, the hybrid.** The round-6 bench on wide and tablet. On a phone (the bench's own switch, aspect below
  0.9), B's mirror, grounded: no top rail, a thin arched frame of light wood, the kitchen and the window above
  it and at its sides, the tape along the glass's own edge, and the controls as the mirror's felt base. On the
  bench a short brass-ended tape stands by the villager's head, and its marker drags the height.

### Builder's impressions (scores are the council's to give)

- **D** is the first candidate where the controls are visibly parts of furniture in the room: the tape
  is on the rail, the dots are pinned on the frame, and the reflection sells the glass. It reads as a mirror, not
  a form, at every size, including the phone. Against it: the villager is small in the glass on wide and tablet
  (about a third of the glass height), because the box and the frame take the rest. The box's front is dense
  on the phone (12 to 13 px end words). The furniture is the most visually dominant thing in the frame, and the
  workshop table is pushed to the edge.
- **E** keeps the bench where it scored 9 and swaps only the phone. The grounded phone mirror is softer than B
  (the kitchen is visible above the arch), but it is still a form across the lower half. On wide, the head tape
  floats beside the shell against the wall. It reads as an add-on, not a tool.
- **A bench defect E exposed:** after a size increase, the bench lets tool tags fall under a big villager
  (wide) and the size and pace tags touch (tablet). The round-6 reference passes only because its check
  changes the size after the capture. E's check drags the size first, so it fails the layout gate on wide and
  tablet.

Council (Opus and GPT-6.1 Sol, belongs / clarity / hierarchy / craft / delight), to fill in. Sheets:
`regroup-2/sheet-{wide,tablet,narrow}.jpg` (tuning) and `-1-empty` (before a villager).

| | D wide | D tablet | D phone | E wide | E tablet | E phone | B wide | B tablet | B phone | ref wide | ref tablet | ref phone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Opus | | | | | | | | | | | | |
| Sol | | | | | | | | | | | | |

### Bet

D. It is the only one that changes the cause: the controls are part of an object in the room, not a panel
over it, and it holds on the phone. What is weak can be tuned within D: a slimmer box (one drawer, the jokes
switch on the frame's foot) so the villager stands bigger in the glass, and a fitting scale that lets a small
villager fill more of it. E is the safe fallback: two different compositions to maintain, and its wide half
carries the bench's size defect.


## Regroup 2 council, blind (lead)

The designs were shown under neutral letters: J = B mirror (regroup 1), K = D cheval mirror in the room, M = E hybrid, N = round-6 bench. Each number is the mean of the five categories.

| Design | Opus (wide / tablet / phone) | Sol (wide / tablet / phone) |
| --- | --- | --- |
| B mirror panel | 6.2 / 6.4 / 6.4 | 7.2 / 7.0 / 7.0 |
| **D cheval in the room** | **7.2 / 7.2 / 6.8** | **7.6 / 7.6 / 7.6** |
| E hybrid | 7.2 / 7.0 / 6.8 | 7.4 / 7.2 / 7.0 |
| Bench | 7.4 / 7.2 / 5.6 | 8.2 / 8.2 / 6.6 |

Both models picked D, the first design rated consistent at every size.
- **Opus** on D: the reflection in the glass muddies the villager, and the control base is still a dense form.
- **Sol** on D: the controls are squeezed into a small pedestal while the scenery takes the screen.

Lesson: making the panel a real object in the room fixed belonging without giving up the panel's clarity. The hybrid lost because switching interfaces between sizes reads as two products.

Adopted: D. Next: polish D.

## D polish (November 7, builder N)

D is the default `&setup=1`. A, C and E are removed (their captures stay in `regroup-1/` and `regroup-2/`); B stays
as `&setup=b` and the round-6 bench as `&setup=bench`. B and D share one owner for the controls, `setup-controls.ts`.

### Round 1 (`d-round-1/`)

What changed against regroup 2's D, by council note:
- **Reflection muddies the villager (Opus).** No `reflector()`: the glass is painted in TSL, a warm silver lighter at the
  top with a soft vignette and two faint glints. One render of the room instead of two.
- **Controls squeezed into a pedestal (Sol), dense box (Opus).** The box is now a fitting stool with one drawer (three
  dials, the knob sized from the drawer's height), the ribbons tied across its legs, the jokes switch on its foot rail;
  the tape on the left rail, the dots on the right, "height" and "colour" on the top rail. Every face is a separate
  layer laid over its 3D face; a `spill()` check proves nothing spills out of its face.
- **Villager a third of the glass (L).** The fit is measured on the glass (at full size the villager clears both rails,
  allowing for it standing nearer the camera than the glass), and may grow a small villager. The camera frames the whole
  furniture to the screen's height, so the mirror owns the frame; the room is dimmed and warmed at the edges.
- **Waiting.** The cutting moves onto the stool's top (`workshop.bench()`): the felt sheet, the scissors, the pieces in
  one row, the needle on a scrap and the reel beside it. The camera looks down at it, the glass behind.
- **Phone.** No word under 14 px (checked). The slip sits at the screen's foot so the swatches have the glass; a swatch
  the glass can't hold whole is put away instead of cut off.
- **Keyboard.** The colours and the jokes are radio groups with one tab stop; Tab walks the nine values in order, then
  saving and "Off you go" (checked).

Self-critique, strict: the glass rendered nearly white (the colours were written as sRGB, the node takes linear), so the
biggest surface read as a lightbox; the band behind the ribbons sank to black, so the stool front read as a panel; the
dial ends ran into each other on the phone ("highslow"). Strict self-score 7.0 / 7.0 / 7.0 (wide / tablet / phone).

### Round 2 (`d-round-2/`)

- Glass in linear values: a soft silver with a warm darker foot, the room's window painted in faintly high on the left.
  It now reads as a mirror and the felt stands out against it.
- A tan felt ground behind the ribbons, lifted out of the stool's shadow.
- Each dial's ends sit under its knob at every size; the waiting looks more steeply down so the work fills more of it.

Strict self-score 8.0 / 8.0 / 7.5. Still short of 9:
- A wide villager (the `code-1` tortoise) is limited by the glass's width: it fills about 60% of the glass's height on wide
  and tablet, 55% on the phone. A tall villager fills more.
- On wide the room still takes the sides (a portrait mirror on a landscape screen); the dimming is mild.
- On the phone the knobs are small (about 30 px) and there is dead room above the mirror.
- The waiting is honest but quiet: one piece every 4.5 s on a small surface.
- On the phone the glass holds six swatches; a seventh pattern (two saved plus five built in) is put away and can't be picked.
- The colour dots have no written ends (the dots are their own labels), and the tape's ends are vertical words on the tape.
- A small villager may be shown larger than its own size on the stool (`fit()` up to 1.6); it shrinks to its size as it hops down.

Frame time, `q=high`, 1440×900 at 2×, tuning (villager on the stool), 6 s, two runs each, headless Chrome:

| | GPU p50 / p95 ms | CPU p50 ms | draw calls |
| --- | --- | --- | --- |
| D before (reflector at half resolution) | 7.4–8.2 / 9.4–11.2 | 7.0–7.2 | 1039 |
| D after (painted glass) | 7.3–7.7 / 9.7–12.3 | 4.6–4.9 | 602 |
| Bench (reference) | 5.9–6.9 / 7.1–9.0 | 6.3–6.6 | 815 |

The second scene pass cost CPU and draw calls, not much GPU: it ran at half resolution, and the frame is bound by the
full-screen passes at 2×. Both frames hold 16.7 ms.

Lesson: in a TSL `colorNode`, colours are linear. A design value taken from a CSS or sRGB swatch must be converted
(about `v ** 2.2`) or it renders far lighter than intended.


## D polish, round 2 council, blind (lead)

T is the polished D and V the regroup-2 D. Means are over the five categories.

| | Opus (wide / tablet / phone) | Sol (wide / tablet / phone) |
| --- | --- | --- |
| D regroup (V) | 6.8 / 7.0 / 6.8 | 7.0 / 7.2 / 7.0 |
| **D polished (T)** | **7.4 / 7.6 / 7.0** | **8.0 / 8.0 / 7.2** |

Both models picked T. The gain is +0.3 to +0.8, so this is not a plateau.

What is left is concrete:
- duplicate pattern cards on the phone (a bug);
- small phone controls;
- the sewing should be the focus while waiting;
- the waiting paper should show the person's own words;
- the villager's face should show at send-off;
- save and "Off you go" belong beside the mirror.

### Round 3 (`d-round-3/`, builder Q)

What changed, by council note:
- **Duplicate pattern cards on the phone (bug).** Saved patterns are de-duplicated by maker and name (the newer "Like Brindle"
  wins) and come after the built-in ones, so a save no longer pushes a built-in pattern off. When the glass can't hold
  them all, the swatches scroll and the last row fades. Before there is a villager, the phone frames the glass alone, so
  all seven fit (`d-round-3/narrow/1-empty`). Checked: one swatch per pattern, built-in first, no two alike, and each one
  is scrolled into view and hit-tested.
- **Phone controls.** The furniture's measures are per layout. On a phone the stool stands taller (a dressing table, top
  at 0.64 m) and the mirror rides up its posts, which uses the empty room above the mirror. Knobs grew from about 30 px to
  64 px, the ribbons are 45 px apart with 44 px touch areas, and the phone's words are 16 to 17 px (checked at 16 px).
  Touch targets are probed with `elementFromPoint`: all of them are 44 px or more except the seven colour dots, which are
  52 px across but only 30 px apart.
- **Waiting.** The cheval frame tips forward on its pivots and the person's own words are pinned in the glass on tissue
  paper. The paper is a page layer mapped exactly onto the tipped glass with a CSS `matrix3d` (Heckbert's square-to-quad
  map). The camera looks down at the stool's top, where the cutting is now bigger (0.78, was 0.6). Checked: the words are
  exactly what was typed, whole, inside the glass, and 16 px or more on the page. The check now types words that match the
  stub's villager (a pup baker), not "sleepy hedgehog".
- **Send-off.** It turns square on, says "Bye for now!" and waves (1.4 s, skipped under reduced motion), then hops down.
  The furniture keeps its controls at rest while it waves (`4-waving`). The walking camera keeps ahead of it and to one
  side, at a distance scaled to its size, so it is seen in profile or from the front, not from behind. A late tuned line
  can no longer talk over the goodbye.
- **Save and "Off you go".** On wide and tablet they are tags tied with thread to the posts at the stool's height. On a
  phone they lie under the stool, tied to its front legs. Checked: within 40 px of the furniture (18 to 19 px).
- **Fill the glass.** The glass is wider (0.52 m, was 0.46), and the fit is measured through the tuning camera, not a
  guessed nearness factor. The tortoise at its default size fills 71 to 73% of the glass's height and 85 to 88% of its
  width (68% and 87% on a phone), and it is checked to stay clear of both rails.

Strict self-score: 8.2 / 8.2 / 7.8 (wide / tablet / phone).
- Still weak: the phone's waiting shows the stool's blank drawer and legs below the work. The walk-off is side-on, not
  face-on: the route to the counter leads away from every camera that stays inside the kitchen. The wave reads mostly
  through the turn and the line, because the waving hand is the one holding the prop. The colour dots are 30 px apart on
  a phone. The stool's front is an empty slab before there is a villager. On wide the frame's top leaves the screen while
  waiting.

Gates: `check-setup.mjs --strategy=1`, 86 of 86 at 1440×900, 1024×768 and 390×844, layout gate included; the bench suite
(`&setup=bench`), 75 of 75; `npm run typecheck` passes. One earlier run failed the stub villager at "the held prop is 0.23
long", from the felt kit work in progress, not from this change. A later run passed.

Lessons:
- A page layer on a tilted 3D surface needs a projective map, not a bounding box. `matrix3d` from four projected corners
  is about 15 lines, and it keeps page text (checkable, sharp) on a surface the camera sees at an angle.
- A phone is width-bound. Height to spare is a reason to change the furniture's proportions per layout, not to shrink
  the controls.
- Sample hit areas with `elementFromPoint`. Pseudo-element touch areas overlap their neighbours, and only a probe shows
  the size that actually works.


## D round 3 council, blind (lead)

Means over the five categories, round 3 against round 2.

| | Opus (wide / tablet / phone) | Sol (wide / tablet / phone) |
| --- | --- | --- |
| Round 2 | 7.0 / 7.0 / 6.0 | 8.2 / 8.0 / 7.4 |
| **Round 3** | **7.8 / 8.0 / 7.8** | **8.4 / 8.4 / 7.8** |

Both models picked round 3. Sol gave its first 9s, for belongs and delight on wide and tablet. The phone gained most, +1.8 for Opus. Next, round 4:
- make the chosen card lift or glow;
- keep the departing villager clear of chairs and lighten the walk-off ceiling;
- trim the wall above the mirror on the phone, give the swatches room, and keep the mirror's outline while picking a pattern;
- raise label contrast;
- hide the locked crude option.

### Round 4 (`d-round-4/`, builder S)

What changed, by council note:
- **Chosen pattern card.** The felt is now a layer inside the card (`span.felt` carries the pinked clip), so the card itself
  can lift on its pin, tip its foot forward (`perspective(360px) rotateX(18deg)`, scale 1.08), glow warm and get a stitched
  outline round its words. The others settle back (scale 0.95).
- **Walk-off.** The watching camera tests each candidate spot for a clear line to the walker's feet, middle, head and both
  sides of its middle against the chairs' and the table's boxes, and rises over the chairs when the frontal spots are
  blocked (heights 1.3, 1.65, 2.0 m, a 50° lens on a phone). It keeps its spot while that stays clear. Looking down keeps
  the dim upper wall mostly out of frame; the room's lighting is unchanged.
- **Phone composition.** The phone's mirror is 0.1 m taller and the stool 0.07 m lower, and the phone frames the
  furniture's real silhouette instead of its bounding box (whose phantom corners left about 50 px of empty wall above the
  mirror). The colour dots run down over the bottom rail, `space-between`: seven dots 44 px apart (were 30), all 44 px
  targets. Before there is a villager the phone shows the whole mirror, its frame and a strip of kitchen each side, with
  the stool's drawer label between the glass and the slip.
- **Label contrast.** New check: each visible text run's box from a Range, one screenshot with the words transparent, the
  ground taken strictly (the lightest tenth behind light words, the darkest tenth behind dark ones), WCAG ratio against
  the computed colour. Lowest now 4.83 (was 1.91, the cream words on the mustard swatch). Fixes: each swatch picks dark
  or cream thread by its felt and a mid felt is dyed deeper until one reads at 4.8:1 (`feltInk`, also the slip's chip and
  the name tag's pattern strip); "Off you go" a deeper green; the tape's ends on their own yellow ground.
- **Jokes.** No padlock. Free, the switch is clean and cheeky, and the arrows and End stop at cheeky. Pinned at crude by
  the household admin, it shows crude as the third position, chosen, and the admin's note comes out with the controls.
  The host's `humourCeiling` still decides; the page only reads `HUMOUR_DIAL`.
- **Stool front.** A brass card holder on the drawer names the pattern it will be cut from ("Calm coach pattern", or
  "made to measure"). It is tucked away where the slip would cover it (a tablet with a pattern chip on the slip).
- **Role (lead's addition).** `roleFor()` picks one of the eight roles from the first role word in the description, or
  from a built-in pattern; the page sends it with the make, and passes the host's returned role to `assemble`. Checked:
  "a wry badger who fixes the bikes" asks for maker, the host returns maker, the kit sews the maker's mark over the stub
  module's cook.

The bench's layout gate measured the villager as one box. With the maker's loupe that box covered the ribbons, though
nothing overlapped on screen; the gate now takes one box per visible part.

Strict self-score: 8.5 / 8.4 / 8.4 (wide / tablet / phone). Still weak: on a tablet and a phone the walker passes close to
a chair back while the camera eases to a new spot; the phone's walk still shows a band of the dark upper wall; on wide
the glass's lower half is empty with five patterns; the chosen card's tilt is subtle; the role comes only from words.

Gates: `check-setup.mjs --strategy=1` 101 of 101 at 1440×900, 1024×768 and 390×844 (layout gate and contrast check
included); bench suite 76 of 76; `npm run typecheck` passes; one `--live` run 80 of 80 (Sonnet through the host, 70.6 s
wall, 64.8 s model, $0.113, no remake).

Lessons:
- `clip-path` clips the element's own filters and outlines. To glow or shadow a clipped shape, clip a child and filter
  the parent.
- Framing a box's eight corners wastes a portrait screen: the near corners project wider and higher than anything real.
  Frame the silhouette's points.
- Contrast has to be measured where the words sit. Rails and dials that looked marginal measured 6 to 12:1; the bright
  swatches that looked fine measured 2 to 3:1.


## D round 4 council, blind (lead)

| | Opus (wide / tablet / phone) | Sol (wide / tablet / phone) |
| --- | --- | --- |
| Round 3 | 6.4 / 6.2 / 5.8 | 8.0 / 7.8 / 7.4 |
| **Round 4** | **7.6 / 7.6 / 6.4** | **8.4 / 8.2 / 7.8** |

Both models picked round 4. Opus's absolute scale came out about a point lower than in its last session (it gave round 3 7.8 / 8.0 / 7.8 then), so read the gaps, not the levels. Sol gave 9s for belongs and delight on wide and tablet.

Real bugs found:
- the saved "Like Brindle" card is missing on the phone (both models);
- the persona ribbons jump to blunt, serious and brief on send-off (Opus);
- during the phone farewell the villager outgrows the mirror and covers the swatches.


## D round 5: bug fixes (lead)

- **"Like Brindle" missing on the phone.** It sat in a fourth swatch row below the fold, and the fade gave no hint of more. A filter also kept only two saved patterns. Every pattern now shows, packed snug when there are many.
- **The ribbon "reset" on send-off.** This was our own check moving the ribbons between captures, not the product. The lesson: a reviewer can only see what the capture script did, so a council finding about state needs the script checked first.
- **The phone farewell overflow.** It happened in the hop down, not the wave. The villager grew and turned too early. It now stays inside the glass in every frame.
- **Tablet.** The tuning words are 16 to 17 px and the cards wrap.

Gates: 127 of 127 at three sizes (the baseline failed 8 of them), and the bench suite 76 of 76.
