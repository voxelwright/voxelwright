# Building the site from Voxelmorphism: what it found

The site (blog, posts, tags, Signal Desk, 404) is built from the kit and nothing else, so every
gap shows up as a page that needs CSS or script the kit should have had. Fixed means fixed in the
kit (Village branch `feature/site-dogfood`), not worked around here.

## Fixed in the kit

1. **An instrument could only be fitted from script.** `fitInstrument()` wrote its colours as
   inline styles on `<html>`, so a page without script, and every page before its script ran, had
   the lit look's blue palette and then flashed to walnut. Fittings are now data
   (`src/looks/fittings.js`) and CSS (`css/fittings.css`, generated); `<html data-shell="walnut">`
   is enough, and the first `adopt()` reads it.
2. **An instrument had no night.** Every material's night colour was its day colour, and the inline
   styles beat the lit look's dark tokens, so a fitted page ignored the system's dark setting. Each
   enclosure now has a night (the room's lights down), and the lit look's night no longer fights it.
3. **Alloy and Smoke were unreadable on their own ground.** Their ink is light (for the dark plate)
   but their ground was light too: 1.1:1. Their grounds are dark now (12:1 and 14:1).
4. **A small card was bare walnut with voxels and parchment without.** Only a large card got the
   reading plate, while the plain version always painted it. At night the light ink then sat on
   walnut. Any instrument card with room now has its plate.
5. **No page.** The ground, the column and the foot lived in the showcase's `parts.css`; a site had
   to copy them. They are `css/page.css` now.
6. **Georgia was hard-coded** for an instrument's prose headings. It is `--vx-serif`; the site sets
   Source Serif 4.
7. **Links on an instrument were the ink colour**, so in running text only the underline marked
   them. They follow the theme's link colour, like the lit look.
8. **A part too big for one GPU texture was not drawn.** Each live part gets a canvas the size of
   its element; a 400-line code block at 3x asked for 2088x24264 px and WebGPU refused it (the
   limit every GPU must allow is 8192), and a list of 60 posts reached 11925. Such a part now
   draws at the largest whole number of pixels a voxel that fits: softer, never missing.
9. **A plain card had a pale band on top.** The lit look's case shoulder is a transparent top
   border, and the plain version filled it with the plate's colour; the showcase covered it with
   page CSS. The kit paints it in the case's material now.

## Open (worth doing in the kit next)

- **A tall surface is soft.** Since fix 8 a long part draws at a lower density instead of failing,
  but a card around a whole article would be visibly soft on a phone, and past 32768 CSS px it
  still fails. The site keeps reading text on the ground ("reach for none first"); tiling a tall
  part across several canvases would remove the limit.
- **A site's handler on a toggle key fights the kit.** The kit's toggle button flips
  `aria-pressed` on click and sends `vx-change`; a page that also flips it in its own click handler
  undoes the press. The part's header says so, but nothing warns; a dev-mode warning when
  `aria-pressed` is set during the kit's own click would catch it.- **Themes are script-only too.** `theme('rose')` writes inline tokens like the old fittings did,
  so a themed page flashes. The fittings' generated-CSS approach would serve `data-vx-theme`.
- **The showcase desk's settings panel is not kit parts.** `showcase/desk.css` draws its own
  segmented controls and select for profile, lighting and keycaps. The site's Signal Desk page
  rebuilds that panel from `vx-toggle-group`, `vx-select` and `vx-toggle`; the showcase should too.
- **The navbar demo needs 30 lines of page CSS** (the brand window, route sockets). If they are
  part of the navbar, they belong in `navbar.css`; if not, the demo should not suggest them.
- **The showcase parts still use `parts.css`** for their ground and plate instead of `page.css`.
- **The city's own controls are painted, not kit parts.** The landing's Night, Pause, Sound and
  View controls are drawn onto the park sign by `static/landing/sign-paint.js` in a 2D canvas,
  with invisible native controls laid over the painted faces. They now share the site's faces
  (IBM Plex Sans, Source Serif 4) and its choices (night, sound, plain), but not the kit's keys.
  Handing the kit the city's renderer (`use(worldRenderer)`, the `draw(frame, target)` contract)
  and mounting real keys on the sign is the way to make them one system; it needs the kit to
  draw into a world-space quad rather than a page-space canvas.
- **The support character has its own sound switch** (`support-button-muted`), apart from the
  site's one sound choice, and its own fonts (Overpass, Fraunces).
- **The vendored stylesheet is 140 KB** (the site's 21 sheets). `existing.css` and
  `instrument-library.css` carry rules for parts the site does not use; per-part files would let a
  site take only what it needs.
