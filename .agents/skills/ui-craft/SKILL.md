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

## Loop

1. Capture the real thing. Drive the app with Playwright and take screenshots at
   desktop and narrow widths, light and dark where they exist, and the
   low-quality mode. Theo had agents use computer use "or whatever other
   techniques you have" (13:58). For 3D, wait for the scene to settle and
   capture several camera angles, not one.
2. Capture a baseline first and keep it. Always show before and after side by
   side (11:42-12:02: the agent made annotated before/after images with arrows
   because the owner could not see the subtle changes).
3. Get a council of reviewers. One strong model from each provider, read only,
   each given the screenshots plus the request, each returning a score out of 10
   per category (6:54-8:08). For Village use Claude Opus and GPT-6.1 Sol at
   minimum. A new review after fixes is a new round; log scores per round (12:37).
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

## Do not

- Do not add a pile of design skills expecting taste (1:23). The loop did it.
- Do not accept the first 9 from a reviewer that saw one screenshot or angle.
- Do not run unbounded. Set a round cap and a spend note; his full effort was
  about 17.6 agent-hours and roughly $250 to $400 (21:14-22:00). Village
  slices should stop at 3 to 5 rounds unless the owner asks for more.
- Do not treat a reviewer that hallucinates (invents line numbers, files) as
  signal; discard its score (9:50-10:59, his Gemini "jester").
- A high council score is model opinion, not owner approval. Report it so,
  with the screenshots.
