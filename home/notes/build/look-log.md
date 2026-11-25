# Build mode look: scores and learning log (#48)

Read this before every look round. Scores are per rubric line, 1–10.

## Rounds

| Round | View | Opus | GPT-6.1 Sol |
| --- | --- | --- | --- |
| 1–4 (one unit) | placement | 8/7/7/6/7/6/7/6 | — |
| 1–4 (one unit) | room sketch | 6/5/5/6/6/7/7/5 | — |
| 2 | placement | — | 9/8/8/9/8/7/7/8 |
| 2 | room sketch | — | 8/6/8/8/8/6/8/7 |
| 3 | placement | 8/7/7/8/8/8/7/7 | 9/8/8/9/9/8/8/8 |
| 3 | room sketch | 6/6/6/7/6/7/6/6 | 9/8/8/8/8/7/7/8 |

Plateau: the room sketch moved less than 0.3 (Opus) over rounds 2–3, and the same
complaint repeated. Placement is near the bar; the regroup targets the room sketch.

## Regroup 1 (Nov 7): the ceiling

1. **The new room floats in the void.** The lawn, fence and lot are drawn once by
   `diorama.ts` from `layout.ts`, not from the plan. The proposal and the built room
   hang past the grass edge into beige nothing. Restyling the sketch can't fix this;
   the world has to answer the plan, or the void has to stop being a problem.
2. **The built room is a bare box.** Build it leaves an empty shell with planks, so the
   payoff moment reads as unfinished.
3. Secondary: tape measures and m² read as drafting software, not a home.

Strategies, prototyped side by side behind `?build=1&look=<name>`:

- **lot** — the ground answers the plan: the lot, lawn and fence regrow around the
  house's footprint the moment the outline appears; the proposal is staked out on the
  grass with string and pegs, and the built room arrives with a first piece or two.
- **blueprint** (too bold) — a different camera and interaction: saying "add a room"
  lifts the view to top-down and the house becomes a paper floor plan on the table;
  the room is drawn and shaped on paper, then Build it swings back to the dollhouse
  where the room rises furnished.
- **plinth** (remove the thing) — no yard at all: the house stands on a felt-and-wood
  model base cut to the plan's footprint, like an architect's model on a table; the
  base grows with the outline, and the proposal is a translucent felt room, already
  lit and lightly furnished, with no measures.

### Regroup 1 scores (one side-by-side sheet, same rubric)

Overall for proposal / built. Rubric: grounded, clarity, payoff, cohesion, warmth,
composition, craft, overall.

| Candidate | Opus | GPT-6.1 Sol | Rank (both) |
| --- | --- | --- | --- |
| A reference (paper sketch) | 5 / 4 | 6 / 5 | 4th |
| B lot | 7 / 7 | 8 / 7 | **1st** |
| C blueprint | 5 / 6 | 7 / 6 | 3rd |
| D plinth | 6 / 6 | 7 / 7 | 2nd |

Adopted **lot** (merged as b50cde7). Steal from D: restrained ghosted furniture in the
proposal and sizes in words ("a bit smaller than the kitchen"). Steal from C: the
door drawn on the shared wall.

What would take lot to 9 (both scorers):
- the outline must match what gets built: draw the curved wall as an arc, not a box;
- the lawn hugs the plan plus a small margin, and the fence follows it, with no big empty field;
- no visible lawn tiling; string lined up with the flour line, with stronger markers;
- a built room that is a real place: seating group, table, a picture or window;
- fix the light crescent under the curved wall and the slab corner that sticks out.

### Round 2 from lot (polish, 7f261f4)

| Candidate | Opus | GPT-6.1 Sol |
| --- | --- | --- |
| E polished lot | 7 / 7 (near 8) | 7.5 / 8 |

The built room gained about a point on both scorers; the proposal moved about half a point.
Left before 9, both scorers:
- the proposal card and faint size tags cover the plan; ghosts and handles too pale;
- the door on the shared wall is not visible from this camera;
- the lawn's stepped notch at the front left;
- the new room needs a window in the curved wall, a second grouping and a clear route to the door;
- the red arc over the table (the notebook spine, fixed upstream in 26a3b8c) and the pendant wire across the window.

### Round 3 on the two-room house (3ce242c)

| Candidate | Opus | GPT-6.1 Sol |
| --- | --- | --- |
| F round 3 | 7.5 / 7.5 | 8 / 8 |

Proposal up about 0.5 on both. Built: +0.5 Opus, +0 GPT, so the built shot rose 0.25 over
two rounds: plateau trigger. Both name the same top complaint.

## Regroup 2 (Nov 7): the reveal

**Ceiling:** the finished room is not presented as the reward. The default dollhouse camera
frames the whole house, so the new room sits small at the frame's edge, half behind the shared
wall, while the kitchen dominates. More furniture can't fix framing.

Strategies, prototyped side by side (`?build=1&look=<name>`), using #42's `view.glide()`:
- **glide** — the camera answers the room: the proposal frames the outline and the shared
  wall; on Build it the view glides in to frame the new room with the shared wall cut away, and
  the room rises in front of you.
- **movein** (too bold) — the room is lived in at once: after it rises, a villager walks in
  through the new door and settles at the room's main piece, and the camera follows them in.
- **inside** (too bold, different camera) — on Build it the view drops into the new room at eye
  level, as the seated kitchen view does, looking across the room to its window; a step back
  returns to the dollhouse.

### Regroup 2 scores (one sheet; built overall, proposal overall)

| Candidate | Opus | GPT-6.1 Sol | Rank (both) |
| --- | --- | --- | --- |
| REF round 3 | 5.5, 6.5 | 6, 7 | 3rd |
| glide | 6, 7.5 | 7, 8 | 2nd |
| **movein** | **7.5**, 6.5 | **8**, 7 | **1st** |
| inside | 4.5, 6.5 | 5, 7 | 4th |

Adopted **movein** (8113f76), combined with glide's proposal framing (outline, shared wall
and door in one view). Keep inside's "Back to the house" only as a way out, not the reward.
Left before 9 (both): the blank back wall over the play area (camera a little higher and
further back, one child-scale wall grouping); the curved wall seen edge-on and the lot edge
in frame; Dumpling standing behind the table instead of seated; a readable walk through the
door; tidy joins at the doorway stub and front corner.

### Move-in polish 1 (2379412)

| | Opus | GPT-6.1 Sol |
| --- | --- | --- |
| built reveal | 7.5 | 8.5 |
| proposal | 7 | 7.5 |

Both: the kitchen competes (bright table, "!" markers, half the frame); the two back walls
leave a grass slit; no visible doorway; a kitchen shelf floats where the shared wall is cut
low; Dumpling hidden behind shelving on the way in; the proposal mixes preview and built cues.
Polish 2 targets exactly these.

### Move-in polish round 2 (feature/village-build-movein-polish2)

Fixed in order from the scorers' shared list: the house's wall stands from the new door back to the
back corner (doorway with posts, lintel and wall over it; no grass slit at the back junction); the
kitchen's shelf and coat pegs go with the low stretch instead of floating; the walk is shot once the
villager is clear of the dresser; a patchwork play rug, a growth chart, a warmer sun patch and quiet
"!" markers during the reward; "Back to the house" in the top left; the doorway as a felt ghost frame
in the proposal. Not scored yet.

Scores for polish 2 (268452b): Opus built 7, proposal 7; GPT-6.1 Sol built 8, proposal 7.5.
Real gains (one back corner, nothing floating on the kitchen side, quiet "!" markers, the
play rug) were offset by a new defect both found: the shared wall's top cap runs past the
door and ends in mid-air over the play table, and the door stands at the wall's open end.
Fix unit dispatched; after it, one score, then land and report the ceiling.

### Shared-wall fix (4b944c3), last round before landing

| | Opus | GPT-6.1 Sol |
| --- | --- | --- |
| built reveal | 7 | 8.5 |
| proposal | 7 | 8 |

Both say it beat polish 2 (no floating cap, a real doorway, house-palette rug, pad away).

**The ceiling, reported plainly.** Across two regroups and five polish rounds the room flow
went from 5 / 4 (Opus) and 6 / 5 (GPT) to 7 / 7 and 8 / 8.5. Neither model gives 9. What both
still name, and what it would take:
- the kitchen stays the brightest, busiest part of the reward frame: the playroom needs its
  own warm light and the kitchen pendant dimmed during the reward, then a tighter
  playroom-first frame;
- the cut-away wall end beside the play area reads as a blunt slab: a finished, consistent
  dollhouse cut-away treatment for house walls (owned with #42's cut-away rule);
- the walk-in beat: Dumpling caught between the posts with the threshold visible, which needs
  the dresser to keep clear of the new door or fade during the walk;
- the proposal: a ghost door drawn in the wall, no stray inner peg or leftover stakes, a
  powdery flour line, the villager's line placed beside the door, not over the kitchen.
Opus also sees a hard-edged bright patch in the curved bay (the window's sun patch).

## Learning

- **Fix the world, not the drawing.** Three rounds of restyling the sketch moved the
  score less than 0.3. Making the ground answer the plan moved it by 2–3 in one round.
  The repeated complaint named a missing system (the lot doesn't follow the plan), not a
  style problem.
- **The payoff shot counts as much as the tool.** Every candidate that put a few
  pieces in the built room scored 2–3 higher on "payoff" than the bare box.
- **Bold lost, but taught.** The top-down blueprint read clearest (9 clarity) but felt
  like CAD (4–6 warmth); its door drawing is worth keeping. Removing the yard (plinth)
  read as a model, not a home. Cosy beats clear when they conflict.
- **One comparative sheet gives steadier scores** than separate calls: both models
  agreed on the ranking, and Opus stopped contradicting itself.
- **The built shot moves faster than the proposal.** Furniture as plan data lifted payoff at
  once; the proposal is capped by legibility (card placement, contrast), which is layout work,
  not more drawing.

- **A person in the room beats a better camera.** The villager walking in and speaking scored
  9 on "room as reward" and lifted warmth by 1–2, more than any framing change. The reward
  is someone living there, not the room seen better.
- **Eye level breaks a diorama.** Going inside showed what the dollhouse distance hides
  (low-poly props, blank windows). Keep the overhead distance the art was made for.
- **A full cut-away exposes what the wall was hiding** (a floating shelf); lower walls, don't
  delete them.
- **A fix that cuts geometry needs its own check.** Cutting the shared wall low without
  cutting its cap left a floating beam across the reward; pixels can't catch it, a scene
  assertion (no cap without wall below) can.


### Shared wall and doorway (feature/village-build-sharedwall)

The lead's read of polish 2's built shot: the shared wall's top cap ran past the door and ended in mid-air
over the play table (one cap spanned the whole wall while the wall under it went low), and the door was a
frame at the open end of a wall. Fixed: the house wall a new room backs is cut into stretches 0.55 m out
from the door, each with its own cap; the doorway sits in full wall (0.55 m in front, the rest of the wall
behind), and a knee-high stretch with the front walls' cut top runs on to the corner. A darker oak
threshold strip under the door; the held pad put away during the reward; the toy chest moved off the
window wall (it read as sitting on the sill) to the quiet wall; the play rug in ochre, sage, terracotta
and cream with stitched seams; the proposal's string dropped (stakes stand on the flour line) and the rug
ghost in the amber felt. The reveal shot is now taken as the villager reaches the doorway. Not scored yet.
