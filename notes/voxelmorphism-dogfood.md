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

## Open (worth doing in the kit next)

- **A tall surface cannot be voxels.** Each live part gets a canvas the size of its element plus
  padding, so a card around a long article would pass the GPU's texture limit (8192 px at most on
  many devices; a 6000 px post at 2x is 12000). The site keeps reading text on the ground ("reach
  for none first"), but the kit should tile, cap or refuse such a surface rather than fail.
- **Themes are script-only too.** `theme('rose')` writes inline tokens like the old fittings did,
  so a themed page flashes. The fittings' generated-CSS approach would serve `data-vx-theme`.
- **The showcase desk's settings panel is not kit parts.** `showcase/desk.css` draws its own
  segmented controls and select for profile, lighting and keycaps. The site's Signal Desk page
  rebuilds that panel from `vx-toggle-group`, `vx-select` and `vx-toggle`; the showcase should too.
- **The navbar demo needs 30 lines of page CSS** (the brand window, route sockets). If they are
  part of the navbar, they belong in `navbar.css`; if not, the demo should not suggest them.
- **The showcase parts still use `parts.css`** for their ground and plate instead of `page.css`.
- **The vendored stylesheet is 163 KB** (the site's 28 sheets). `existing.css` and
  `instrument-library.css` carry rules for parts the site does not use; per-part files would let a
  site take only what it needs.
