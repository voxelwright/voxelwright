# The tsundere support button

A floating "Support" button with no support behind it and no contact route. That is the joke: it mocks the chat
launcher every site has, and nods to the old "don't press the red button" games. It dodges the pointer, gets
annoyed when caught, and on a second catch stages a standoff before it leaves.

Only the standalone 3D landing mounts it (`support()` in `generator/pages.mjs`, on the `home` page), in both the
city and the plain view. The landing is built only when the site owns its origin
(`base: "/"`), so zahynailo.dev does not show it today ([the site guide](../../../guide/site.md#the-landing)).
A page includes it like this:

```html
<script type="module" src="/support/support-button.js"></script>
<support-button version="instrument"></support-button>
```

On the landing, "Plain page" stays the first Tab stop. Tab again to reach Support.

## Files

| File | What it holds |
| --- | --- |
| `static/support/support-button.js` | The element: idle, eyes, dodging, lines, presses, keyboard, live region, sound unlock. |
| `static/support/support-button.css` | Three finishes, light and dark, loaded into the shadow root. |
| `static/support/standoff.js` | The second-press scene, fetched after the first press. Lettering, fists and bulldozer are our own paths. |
| `static/support/sound.js` | Every sound, synthesized with Web Audio. Fetched after the first press. |
| `static/support/fonts/` | Fraunces (`unbiased`) and Overpass Mono, both OFL. |
| `designs/support-button/site-check.mjs` | Browser check against a served build. |

## Attributes

| Attribute | Meaning |
| --- | --- |
| `version` | `unbiased` (flat ink, the default), `skeuomorphic` (arcade button) or `instrument` (engraved blue keycap, the Signal Desk's). |
| `theme` | `light`, `dark` or `auto` (the default, follows `prefers-color-scheme`). |
| `muted` | Start with sound off. |
| `returns` | Seconds until it sneaks back after escaping, or `never`. Default 25. |
| `calm` | Force the still version that `prefers-reduced-motion` gets. |
| `label` | Accessible name. Default "Support". |
| `dock` | ID of a layout marker. Its top-right corner places the button and its bottom limits idle hops. |

Without a dock, its home corner is `--support-top` and `--support-right` (px) on the element. On windows narrower
than 520 px it sits one row lower, because the top right usually holds the page's nav.

## What it does

1. **Idle.** Eyes follow the pointer. Come close and it leans away, then jumps, with a line every other jump. Five
   jumps tire it and it stops to pant: that, or a fast flick, is how it gets caught.
2. **First press.** Mildly annoyed: a vein, a head shake, "H-hey! No touching!", and it gets harder to catch.
3. **Second press.** The standoff, about 12 seconds: an impact frame and hit-stop, ゴゴゴ and speed lines, "Are you
   threatening me?!", a MUDA MUDA barrage at the pointer, a bulldozer rammed into it (zero damage both), "…good
   grief.", and it leaves by the nearest side.
4. **After.** A sign stays: "Support has left. There never was any." It comes back after `returns` seconds,
   embarrassed, and it can all happen again.

- **Touch.** Its eyes follow the last touch, a tap near it makes it flinch, and a tap on it slips out from under the
  thumb twice before one lands.
- **Keyboard and screen readers.** It is a real `<button>`. On keyboard focus it holds still and complains. Enter or
  Space is a press; the standoff then aims at the focus ring. Escape dismisses it, or cuts the standoff short. Every
  line goes to a polite live region.
- **Less motion.** Under `prefers-reduced-motion` it does not move, and the standoff is a four-panel comic strip.
- **Sound.** No audio context exists until the visitor presses the button itself. The sound switch's choice is
  remembered.
- **Cost.** No frame loop and no audio while nobody is near it. Everything animates `transform` and `opacity`, and a
  hidden tab stops it all. The motion rules are the [site-craft skill](../../../.agents/skills/site-craft/SKILL.md)'s.

## Check

Serve a build that has the landing (`base: "/"`), then:

```sh
BASE=http://127.0.0.1:5971 PLAYWRIGHT=/path/to/playwright/index.mjs node designs/support-button/site-check.mjs
```

It checks placement, pointer tracking, mouse and touch catches, sound unlock, the reduced-motion comic, and keyboard
focus and Escape in Chromium and WebKit. `REQUIRE_WORLD=1` requires the live canvas on a WebGPU machine. Screenshots
go under `.shots/support/` (or `OUT`).

**This check is out of date.** On the full-screen city the button waits off-screen until the park sign's Support
control summons it, so the script's first step (a visible Support key on `/`) times out. `scripts/landing/check-eggs.mjs`
covers the summoned button meanwhile.
