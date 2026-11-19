---
name: site-craft
description: Rules for designing and building the site's look, motion and feel: typography, reading column, colour, light and dark, motion curves and durations, press feedback, juice for the playful parts, and how the 2D page and the later 3D world relate. Use for any change to static/site.css, the Voxelmorphism kit's parts on the site, page templates, or anything that moves, makes sound or reacts to touch.
---

# Site craft

The blog is a calm building inside a playful world. Reading comes first, play second, and
the play never costs the reader anything. When a rule here conflicts with a nicer idea,
ask whether the idea makes reading or finding things better. If not, drop it.

Motion, easing and typography rules adapted from Emil Kowalski's skills,
https://github.com/emilkowalski/skills (MIT). The React, Motion and Base UI parts are left
out; everything here is plain CSS, HTML and small vanilla JS.

## 1. Loop

1. Build with drafts and a fixture with several posts, so lists and tag pages are real.
2. Screenshot home, a post, the blog list and a tag page at 1280 and 390, light and dark.
3. Gate on numbers first: fonts actually loaded, no external requests, no horizontal
   scroll at 390, body text contrast 7:1 or better, muted text and every code token 4.5:1
   or better (measure each token span, not the block's default colour).
4. Then judge taste against this file, score 1 to 10, fix the weakest thing, re-shoot.
5. Compare against the previous screenshots side by side, not from memory.

## 2. Reading

- Body text 17 to 20 px on desktop, never under 16 px on phones.
- Line length 60 to 72 characters. Set the column with `ch` or `rem` from the body face,
  and check it with a real paragraph, not lorem in a different face.
- Leading tracks size inversely: body 1.5 to 1.7, headings 1.05 to 1.25, captions 1.4.
- Tracking is size-specific. Large display text gets negative tracking (-0.01 to -0.03em),
  body stays at 0, small caps and tiny labels get positive tracking (+0.04 to +0.1em).
  One `letter-spacing` value for every size is wrong somewhere.
- Build hierarchy from size, weight and leading together. Emphasise with weight before
  colour.
- Paragraph spacing is one line of the body leading. Headings sit closer to what follows
  than to what precedes.
- `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs.
- Numbers that change or line up use `font-variant-numeric: tabular-nums`.
- Dates older than a week show as absolute dates, not "340 days ago".
- Use `font-optical-sizing: auto` when the face has an `opsz` axis.
- Respect the reader's text size: sizes and spacing in `rem` and `em`, never fixed px for
  type.
- Body contrast is high but not harsh: avoid pure black on pure white and pure white on
  pure black. Dark themes lower text to roughly 85 to 90 percent luminance and raise the
  background off black.

## 3. Type

- Self-host woff2 under `static/fonts/<family>/` with the licence (`OFL.txt`) beside it.
  No runtime requests to font services.
- Latin subset, variable when the axes are used, at most three text families plus one
  monospace per look, and about 300 KB of fonts per look at most.
- `font-display: swap`, and a fallback stack with similar metrics.
- Banned as the main face: Inter, Roboto, Arial, Helvetica, Space Grotesk, system-ui.
  The look needs a voice.
- Code gets a monospace that matches the text face's mood, at 0.85 to 0.9em.

## 4. Colour and theme

- Every colour is a custom property on `:root`. Light and dark follow
  `prefers-color-scheme`; both are designed, neither is an inversion.
- One accent per look. The accent marks links and the current place, not decoration.
- Visited links are distinguishable but quiet.
- Focus is always visible: a 2px outline in the accent with an offset, on every
  focusable thing, using `:focus-visible`. Never remove an outline without a replacement.
- Code blocks use a Shiki theme chosen for the look (on the kit: one dark theme for the
  instrument's code window, by day and at night); the block background comes from
  the look, not from Shiki. Most bundled light themes fall under 4.5:1 for some tokens;
  deepen them with `color-mix(in oklab, <token colour> N%, #000)` rather than giving up the
  theme's hues.
- Model output (`model-note`) must read as not the author's words at a glance: different
  face or size, a label, and a distinct surface. Pleasant, never alarming.

## 5. Motion

Should it move at all? Decide by frequency:

| How often | Decision |
| --- | --- |
| Many times a minute (keyboard nav, scrolling) | No motion |
| Many times a visit (hover, press on links) | Near-instant, subtle |
| Occasionally (opening an embed, a menu) | Standard motion |
| Rarely (first visit, an easter egg) | Delight lives here |

Name the purpose before writing it: feedback, spatial consistency, state change,
preventing a jarring jump, or (rare tier only) delight. No purpose, no motion.

Easing:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);     /* entering, leaving, press release */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);  /* edge sheets */
```

- Hover and colour changes use `ease`. Constant motion uses `linear`.
- Never `ease-in` on interface motion: it delays the moment the reader is watching.
- Don't invent curves; take them from this file, easing.dev or easings.co.

Durations:

| Element | Duration |
| --- | --- |
| Press feedback | 100 to 160 ms |
| Hover colour or underline | 120 to 200 ms |
| Small popover, tooltip | 125 to 200 ms |
| Menu, dropdown | 150 to 250 ms |
| Sheet, modal | 200 to 500 ms |

Interface motion stays under 300 ms unless it is a sheet or a modal.

Rules:

- Animate `transform` and `opacity` (and `clip-path`). Never `width`, `height`, `top`,
  `left`, `margin` or `padding`.
- Never `transition: all`. Name the properties.
- A transform on an element makes it the containing block for its absolute children. Don't
  transform a link whose `::after` stretches over a larger card or row; press feedback
  there uses colour.
- Never start from `scale(0)`. Start from 0.95 to 0.97 with `opacity: 0`.
- Popovers grow from their trigger; centred dialogs grow from the centre.
- Use transitions, not keyframes, for anything that can be triggered twice quickly:
  transitions retarget, keyframes restart.
- Entrances can use `@starting-style` with no JS.
- Stagger group entrances by 30 to 80 ms, never block interaction while they play, and
  never stagger on every page view of a list people read daily.
- Don't drive a child's transform through a CSS variable on its parent; set `transform`
  on the element itself.
- `will-change` only after seeing a 1px shift, and remove it when idle.
- Keep animated `blur()` under 20 px.

Press feedback: `transform: scale(0.97)` on `:active` with
`transition: transform 140ms var(--ease-out)`, 0.95 to 0.98 for larger targets.

Hover: gate motion behind `@media (hover: hover) and (pointer: fine)`; touch fires false
hovers on tap.

Reduced motion (`prefers-reduced-motion: reduce`) means fewer and gentler, not none:
drop movement, scale and shake; keep short opacity and colour changes that explain a
state change.

## 6. Springs and gestures

- While a finger or pointer is down, the thing tracks it 1:1. No easing, no spring.
- On release, finish with a spring seeded with the release velocity. A fixed-duration
  ease makes every fling land the same and reads as fake.
- Dismiss on distance (about 40 to 50 percent of travel) or velocity (a flick), not
  distance alone.
- Past a boundary, rubber-band (move a fraction of the distance), don't hit a wall.
- Bounce only after a drag or throw, 0.1 to 0.3. A button-triggered close gets none.
- Snap-back is fast.
- Use pointer events with `setPointerCapture`, ignore extra touches once a drag starts,
  and set `touch-action` for the drag axis.
- Anything a gesture can touch is interruptible: springs or transitions, never keyframes.
- Hit targets at least 44 by 44 px; enlarge with an invisible `::before`, not layout.
- Without a library, a critically damped spring is a few lines: integrate
  `a = -k(x - target) - c·v` per frame with `k` around 170 and `c` around 26 for a calm
  settle; lower `c` for more bounce.

## 7. Juice (the playful parts, mostly the 3D world)

- Feedback lands in the same frame as the input. Visual response first, sound and
  particles after.
- Impacts make a sound. Short, varied (pick from 2 to 4 samples, small pitch jitter),
  quieter than speech, and silent until the visitor has interacted with the page.
- Hit-stop of 30 to 100 ms, only for big impacts: breaking a sign, landing a big hit.
  Never on every touch.
- Screen shake is a sum of decaying impulses with a cap on total amplitude, so many hits
  don't add up to nausea. No shake at all under reduced motion.
- Overshoot of 5 to 10 percent on things that pop into place, then settle.
- Juice is for the world. Inside the reading column, the most a press gets is a small
  scale and a colour change.

## 8. The 2D page and the 3D world

- The 2D page is canonical. Everything in 3D exists on a plain page with a real URL.
- Every sign, door or object you can use in 3D mirrors a real link in the HTML, with the
  same destination and an accessible name.
- The first Tab stop on a 3D page is "Plain page" (a link to the 2D version).
- Choose the view in this order, and stop at the first answer:
  1. A saved choice from the visitor.
  2. `?view=2d` (or `?view=3d`) in the URL.
  3. `prefers-reduced-motion: reduce` means 2D.
  4. No WebGPU adapter (`navigator.gpu?.requestAdapter()` returns null) means 2D.
  5. A short frame-time probe; if frames are too slow, 2D.
- Never sniff the user agent.
- The 3D world loads only after the 2D page is readable; the 2D page never waits on it.

## 9. Mobile at 390 px

- No horizontal page scroll. Wide things (code, tables) scroll inside themselves.
- Gutters at least 16 px. Standalone links and controls (nav, tags, footer) get a hit area
  at least 44 px tall, enlarged with an invisible pseudo-element where the visible mark is
  smaller. Links inside running text are exempt.
- The header fits on one or two calm lines; nav never wraps into a ragged pile.
- `-webkit-tap-highlight-color: transparent` only when a designed `:active` state
  replaces it.
- Use `100dvh`, not `100vh`.
- Body text at least 16 px so iOS doesn't zoom on focus.

## 10. Never

- Card soup: every post in a shadowed box.
- Purple gradients, glassmorphism over text, neon glows behind body copy.
- Decoration that moves while someone reads.
- Scroll-jacking, parallax on text, fade-in on every section.
- Animation on keyboard-driven actions.
- A link that is only colour; links are underlined or otherwise marked in running text.
- Grey text below 4.5:1.
