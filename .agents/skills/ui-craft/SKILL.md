---
name: ui-craft
description: Use for any Village UI, 3D scene or skeuomorphic surface work (three.js/WebGPU home, panels, textures, lighting, post effects). Drives a screenshot, score, fix, re-score loop so the result looks designed rather than merely working.
---

# UI craft

Source: Theo, https://x.com/theo/status/2118465321032106235 (2026-11-05, 31.7 min).
Timestamps are spoken moments from a local whisper small.en transcript; screen
content was not reviewed. The Village rubric and caps below are ours, not his.

## Principle

Looking is the verification. Treat each visual change as a hill climb:
screenshot, critique, score, fix, repeat until independent scores clear a stated
bar. His whole skill was "look at the new screenshot, compare it to the other
products and the old screenshot, score it, do it again" (25:47-25:59), "very,
very basic" (25:37).

**Read screenshot feedback as a diagnosis.** Name what feels wrong and judge the repair in the
working control. If an LED seems to appear out of nowhere, inspect the same fitting before and
after activation. Its housing can differ between an aluminum plate and a translucent case.
This keeps the reference useful across the kit while leaving room for a better mechanism.
<!-- 2026-11-18: “I'm just saying what feels wrong, not how to solve it” -->

## Loop

For every new physical control family, finish one working specimen before applying its design
to siblings. Pair a close-up of the stationary specimen with the physical reference. Magnify
the silhouette until the cells are visible, and verify the specimen uses the kit's shared
voxel stage. Then operate it at normal size beside its siblings. For a recessed control,
compare rest and full travel from the same view. Check which parts stay fixed, what clears
the lip, and which surfaces catch light from the fitting. A detail can look convincing up
close while the whole control still appears to float above its mount.
<!-- 2026-11-18: “one specimen for every new physical control family” -->

1. Capture the real thing. Drive the app with Playwright and take screenshots at
   desktop and narrow widths, light and dark where they exist, and the
   low-quality mode. Theo had agents use computer use "or whatever other
   techniques you have" (13:58). For 3D, wait for the scene to settle and
   capture several camera angles, not one.
2. Capture a baseline first and keep it. Always show before and after side by
   side (11:42-12:02: the agent made annotated before/after images with arrows
   because the owner could not see the subtle changes).
3. Get independent visual scores from different models. Choose reviewers using the current
   routing in `AGENTS.md`. Each gets the screenshots and request, works read-only, and returns
   a score out of 10 per category (6:54-8:08). Log a fresh round after fixes (12:37).
4. Fix what the reviewers found, then re-review with fresh context.
5. Stop only when every reviewer clears the bar in every category, or say plainly
   that you stopped on cost or time. Early rounds typically jump (6 to 8 to 9 in
   3 rounds, 11:21-12:50); each extra half point costs far more (9.5 took 10
   extra runs, 20:44-20:58).

## Make scores mean something

- Scores are noisy: the same screenshot can get three different scores (9:16).
  Trust agreement across models, and treat 9 and 10 as meaningful only when
  several models give them (9:20).
- Compare against references, not in isolation. A single design alone scored
  "fine" (7 to 9); the same design next to competitors dropped to about 7.4
  (14:34-15:43). Put the reference screenshots in the panel. For Village that
  is Paper Worlds (https://uberdesigner.ai/t/paper-worlds) and any prior Village
  capture.
- Hidden targets are better. Telling reviewers the goal may inflate scores
  (20:22-20:42). Give the parent the bar; give reviewers only the rubric.
- Escalate the bar after the first pass. "You decide what the top is" (18:28).
  The cheap rounds clear 9; a stricter second pass (9.5, then 10) found diff
  views, focus states, contrast (23:43-24:48).
- Loop with one model until it passes, then add slower ones (17:03-19:30).
- Programmatic checks beat model vibes (26:42-26:54). Where a number exists
  (frame time, draw calls, contrast ratio, layout overflow, console errors),
  gate on it first and use the council only for taste.

## What he found changed UI quality

Consistency, not decoration (17:41-18:10): one label per thing, one radius scale,
consistent fonts and indicators, calmer hierarchy, better body contrast. When
it came out too grayscale, one plain taste sentence fixed it (23:55-24:04).

## Village rubric (ours, give to reviewers)

Score 1 to 10 each: warmth and coziness (reads as a home, not an app), material
honesty (surfaces look made of something, textures painted in code, not flat
fills), lighting and depth (fog, bloom, vignette, grain restrained, not
smeared), hierarchy and legibility of any text, consistency, motion polish, and
low-quality mode still looking intentional on a weak GPU. Penalize corporate
dashboards, generic gradients and neon.

## Plateau: regroup, then go bolder (owner, November 7, 2026)

Polishing rounds flatten after 3 or 4 rounds. Stopping the polish is right; stopping
the climb is not. The owner wants a move to a bolder strategy that can swing the score,
not more of the same.

**Plateau trigger:** the cross-model mean rose by less than 0.3 over the last two
rounds, or the same top complaint survived two rounds.

**Regroup, in this order:**

1. **Name the ceiling.** List the complaints reviewers repeat across rounds and models.
   For each one, say why the current approach cannot fix it with more tuning. Examples
   from November 7:
   - "iso shows a suburban yard" in a neon theme needs a theme-owned exterior, not
     post-processing;
   - "villagers sound alike" needed decision style and rhythm, not more words in the
     prompt;
   - "the corner composer reads as a chat widget" needed a held notepad, not a lighter
     panel.
2. **Generate 2 or 3 radically different strategies** that change the approach, not its
   parameters. Examples:
   - a different camera or composition;
   - a different technique: baked lighting, painterly shading, toon ramps, geometry
     instead of textures, a sprite or card instead of a mesh;
   - a different art direction or reference;
   - a different interaction model;
   - removing the thing entirely.

   At least one should feel too bold.
3. **Prototype each one cheaply,** behind a flag and in parallel where possible. A
   rough version is enough to show the swing.
4. **Score them side by side.** Give the same rubric to the same cross-model council
   (Opus plus GPT-6.1 Sol), and add the current best as a reference.
5. **Adopt the winner,** even if it means throwing work away. Then resume polishing
   from the winner.
6. **Write it down.** Keep a learning log next to the round scores: what moved the
   score, what didn't, and why. Read it before every round. Copy lessons that
   generalise into this skill, so other threads benefit.

Lesson (villager look, November 7): fixing a defect in place often only moves it. Trimming
the scarf's tail and moving the owner colour to a chest badge both still read as a tongue or
a bib. Merging two competing signals into one element (the role mark dyed in the owner's
colour) removed the defect and raised contrast at once.

Run at most about three regroups per prototype. If a regroup still can't reach 9,
report the ceiling plainly, with the strongest candidate and what it would take (an
asset, a dependency, a decision). Don't pretend.

## Lessons from regroups (themes #50, November 7, 2026)

- Find which part owns the ceiling before tuning: fixing the exterior revealed the interior as
  the next ceiling. Name it, then regroup on that part.
- Partial restyling reads as stickers. Change the whole set in one language, or restyle each
  object keeping its details (photos, magnets, books).
- Look for a scale or parameter bug before blaming the style: a texture repeat made houses into
  towers, metalness made an indoor floor read as asphalt, and a pixel size tuned for one camera
  dissolved furniture in another.
- A night or dusk scene needs one warm, motivated refuge light. It was the largest interior gain.
- Score candidates in one capture session against references from the same session; one scorer
  moves about one point between sessions.

## Lessons from the talk regroup (#42, November 7, 2026)

Details and scores are in `home/README.md`, "Talk regroup".

- **Take motion frames by the app's clock.** On a loaded machine a screenshot
  "0.15 s after Enter" was taken 2 to 3 s late, so one look's sent note was never
  on screen and its motion score (2 to 3) measured the capture, not the design.
  Shoot at once, read the app's own time since the event, and retake if the frame
  missed it (`home/scripts/talk-shots.mjs`).
- **Keep words out of the post stack.** Paper "lit by the room" was bleached by
  bloom under a lamp, and temporal anti-aliasing ghosted a transparent mesh whose
  text changed every word. Words drawn on the page over the 3D view (a 2D canvas
  shaped and shadowed like the object) were crisp; keep the 3D object for what is
  not text.
- **Depth of field and haze cost more than they give** on a busy room seen up
  close: both models marked lighting down (4 to 6) and scored the low tier, which
  had none, above the high one.
- **A held object seen through a narrow lens looks flat.** At a 20 degree field of
  view, tilt it 45 to 50 degrees and turn it so the convergence shows.
- **A framing camera must test the whole frame, from the pose it will take.** A
  line of sight to the subject missed door posts at the frame's edge, and the
  dollhouse cutaway hid the very wall the new pose would show. Test rays across
  the frame and predict what the cutaway will draw from there.
- **Keep the current best in every round as a shuffled reference.** The unchanged
  reference moved up to 0.7 between rounds, so compare within a round, not across.
- **Read the split, not only the mean.** GPT-6.1 Sol rewarded legibility and
  consistency; Opus rewarded the input and the words being things in the world. A
  direction that wins the structural categories and loses on fixable rendering
  faults is worth adopting; fix the faults before judging it again.

## Lessons from the paper climb (#42, November 8, 2026)

Details and scores are in `home/README.md`, "Paper climb".

- **Make the thing that disappears persist as one object.** Both models' worst categories
  (motion, conversation) moved 2 to 3 points once the sent line stayed one object: torn off,
  flown, caught in the reader's paws, then taped to the reply or lying on the table. Showing it
  in a different form in each place (a header in the reply, a slip, a card) cost consistency
  until it was one form everywhere.
- **Pace a flight by the screen, not the room.** An object leaving a camera half a metre
  away covers most of the screen in its first moments. Weight its path by inverse distance,
  and scale its arc and size with distance, or the "0.8 s" frame shows it already arrived or
  off the top of the frame.
- **Judge transitions from where the camera is going.** A passer-by faded from the
  in-between camera started fading as the camera arrived, and the still frame caught a
  glittering half-fade. Decide from the target pose, and finish instantly while the camera
  moves.
- **A shared container reads as a chat log, even in paper.** In the regroup a single
  "sheet passed round" lost to separate slips beside each speaker ("a chat log in paper
  dress"), and a top-down camera lost faces. Keep each line near the one who said it.
- **Use real replies before the last round.** Scripted lines fit the layout. Real
  replies run to several pages, and they showed a reply covering the face on a phone and a
  stepped-back slip showing only its last fragment.
- **Weigh a single remark against the votes.** One scorer asked to keep the pad's
  address after sending, and later to blank it. Two rounds asked for a grey lead line to go.
  Settle a contradiction by moment (blank as it tears, the address once it settles), and act
  on what both models or several rounds repeat.
- **Freeze the reference before you edit.** A dev server serves the working tree, so a
  reference capture taken while you edit picks up the edits. Capture it from a
  `git archive` copy.

## Lessons from the build-mode regroups (#48, November 7, 2026)

Details and scores are in `home/screenshots/build/look-log.md`.

- **When a complaint repeats, look for the missing system.** Three rounds of
  restyling a room sketch moved the score less than 0.3; the complaint was that
  the yard didn't follow the floor plan. Making the ground answer the plan moved
  it 2 to 3 in one round.
- **A person in the scene beats a better camera.** For "the new room is the
  reward", a villager walking in and sitting down scored 9 on that category from
  both models; no framing change came close.
- **Keep the distance the art was made for.** An eye-level view of a dollhouse
  exposed low-poly props and blank windows and lost 3 to 4 points of cohesion.
- **The payoff shot moves faster than the tool shot.** Furnishing the built
  result lifted payoff at once; the proposal stayed capped by legibility (what
  covers what, one visual language), which is layout work, not more drawing.
- **One comparative sheet is steadier than separate calls.** Put the current best
  and every candidate on one image with one rubric, and ask for a ranking first.
- **Geometry fixes need scene assertions.** Cutting a wall low but not its top cap
  left a beam floating over the reward. Pixels didn't catch it; a check that no
  cap stands without wall below would have.

## Do not

- Do not add a pile of design skills expecting taste (1:23). The loop did it.
- Do not accept the first 9 from a reviewer that saw one screenshot or angle.
- Do not run unbounded. Set a round cap and a spend note (a regroup restarts the cap for the new strategy); his full effort was
  about 17.6 agent-hours and roughly $250 to $400 (21:14-22:00). Village
  slices should stop at 3 to 5 rounds unless the owner asks for more.
- Do not treat a reviewer that hallucinates (invents line numbers, files) as
  signal; discard its score (9:50-10:59, his Gemini "jester").
- A high council score is model opinion, not owner approval. Report it so,
  with the screenshots.
