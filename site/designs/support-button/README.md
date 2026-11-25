# The tsundere support button

A floating "support" button in the top right that has no support behind it and no contact route. That is
the joke (the owner, Nov 17: "There is no real contact for support. That's the joke."). It mocks the chat
launcher every site has, and nods to the old "don't press the red button" games.

The landing mounts the original component from b43a235 beside the compass in both the world
and plain views. The `instrument` finish uses CSS, local OFL Overpass Mono, and the Signal
Desk’s keycap and pilot-light details. The dock keeps idle hops above the directory and scene
controls. The standoff follows the cursor or last touch across the viewport. The element can also
show the two earlier designs (`version="skeuomorphic"` or `"unbiased"`). A page includes the element like this:

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
| `static/support/fonts/` | Fraunces (unbiased) and Overpass Mono (skeuomorphic), both OFL, copied from `static/fonts/`. |
| `designs/support-button/site-check.mjs` | Browser QA against a built site. |

## Attributes

| Attribute | Meaning |
| --- | --- |
| `version` | `unbiased` (flat ink, default) `skeuomorphic` (arcade button), or `instrument` (engraved blue keycap). |
| `theme` | `light`, `dark` or `auto` (default, follows `prefers-color-scheme`). The 3D page can set it from the world's time of day. |
| `muted` | Start with sound off. |
| `returns` | Seconds until it sneaks back after escaping, or `never`. Default 25. |
| `calm` | Force the still version that `prefers-reduced-motion` gets. |
| `label` | Accessible name. Default "Support". |
| `dock` | ID of a layout marker. Its top-right corner positions the keycap and its bottom limits idle hops. When the marker scrolls out of view, the parked character and its controls scroll away too. |

Its home corner is set with `--support-top` and `--support-right` (px) on the element. On windows narrower
than 520px home is one row down by default, because the top right usually holds the page's nav.

## What it does

1. **Idle.** Eyes follow the pointer. Come close and it leans away, then jumps. It says a line every other
   jump. Five jumps tire it, and it stops to pant: that, or a fast flick, is how it gets caught.
2. **First press.** Mildly annoyed: a vein, a head shake, "H-hey! No touching!", and it gets harder to catch.
3. **Second press.** The standoff, about 12 seconds: an impact frame and hit-stop, menacing ゴゴゴ and speed
   lines, "Are you threatening me?!", a MUDA MUDA barrage at the pointer (zero damage), a bulldozer rammed
   into the pointer (zero damage), "…good grief.", and it leaves by the nearest side.
4. **After.** A sign stays where it was: "Support has left. There never was any." It comes back after
   `returns` seconds, embarrassed, and the whole thing can happen again.

**Touch.** There is no pointer to see coming, so its eyes follow the last touch, a tap that lands near it
makes it flinch, and a tap on it slips out from under the thumb twice before it tires and a tap lands.

**Keyboard and screen readers.** It is a real `<button>`. It cannot dodge a key, so on keyboard focus it
holds still and complains, and says what the keys do. Enter or Space is a press (so is a screen reader's
activation): the first annoys it, the second starts the standoff, which goes for the focus ring instead of
a pointer. Escape dismisses it for good, or cuts the standoff short. Every line goes to a polite live
region, and the standoff is told there beat by beat. After a keyboard standoff, focus moves to the
sign's close button. Dismissing Support or the sign returns focus to the landing's main content.

**Less motion.** Under `prefers-reduced-motion` it does not move: it looks away and says its lines, and the
standoff is a four-panel comic strip that fades in panel by panel.

**Sound.** Nothing makes a sound, and no audio context exists, until the visitor presses the button itself.
A sound switch appears beside home while there is sound to switch, and the choice is remembered.

**Cost.** No frame loop, no scene elements and no audio while nobody is near it. Everything animates
`transform` and `opacity`. A hidden tab stops the loop, the animations and the audio. It listens for
pointer movement across the landing. The fictional blows and effects let clicks and taps reach the
page beneath them.

## Evidence

The standalone demo server (and its shots and world proxy) built the site in the retired looks and
was removed on Nov 19; `npm run dev` shows the button on the real landing. For the landing
integration, serve a local production build and run:

```sh
BASE=http://127.0.0.1:5971 PLAYWRIGHT=/path/to/playwright/index.mjs node designs/support-button/site-check.mjs
```

This checks entry placement, pointer tracking over the world, real mouse and touch catches,
sound unlock, the reduced-motion comic, and keyboard focus and Escape in Chromium and WebKit.
Set `REQUIRE_WORLD=1` on a WebGPU-capable machine to require the live canvas. Whole-viewport
entry and standoff screenshots go under `.shots/support/` (override with `OUT`).

Since the full-screen city (fd954ee) the character waits off-screen until the park sign's Support
control summons it, so this script's first step (a visible Support key on `/`) times out; it
needs updating to summon the button first. `scripts/landing/check-eggs.mjs` covers the summoned
button meanwhile.

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"site/static/support/support-button.js":"f8ff5e5bfc0b01acae1cedc8ad77bd8f"} -->
