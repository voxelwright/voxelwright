# Voxelmorphism on the site

From `site/`, run `npm ci` and `npm run build`. npm links the adjacent
`engine/kit` package. Each build reads its current modules, stylesheet, fonts and
notices into the site's public `vendor/village/` directory. The renderer there
is the one included with Voxelmorphism. The Signal Desk imports its controls
before site startup and scopes the showcase's stylesheet to the desk.

## Runtime contract

- `/vendor/village/kit/src/index.js` exports `adopt`, `use`, `release`, `ready`, `live`, `refresh`,
  `getStage`, `fitInstrument`, `toast`, `LIGHTS` and `sound`. One module instance per document.
- Each page's `<html>` names its fitting (`data-vx-look="lit" data-shell="walnut" data-caps="field"
  data-profile="high" data-rail="steady"`); the kit's `css/fittings.css` colours the page from it,
  by day and at night, before any script runs, and the first `adopt()` fits the voxels the same way.
- `static/site.js` calls `use(renderer())` (or `use(null)` when the page stays plain) before the
  first `adopt()`, so the kit never opens a second WebGPU device. A page with its own setup sets
  `script` on its page object; that script imports `boot` from `/site.js` and passes `before`.
- Plain or voxels: `?view=2d`/`?view=3d`, then the saved choice (`vx-plain` in localStorage, the
  footer's link), then reduced motion. The head's early script sets `data-vx-plain` before paint.
- The Night key saves `vx-theme`; the Signal Desk's build (`vx-instrument-build` in sessionStorage)
  refits every page for the visit.

## Asset provenance

IBM Plex Sans and Mono retain their upstream OFL files beside their WOFF2s. Vox Text is Village's original Sentence glyph set rendered as two WOFF2s. Its source is `engine/kit/src/core/fonts/sentence.js` and its build instructions are in `engine/kit/fonts/vox-text/README.md`. The OFL notice accompanies each family.

The press and release WAVs are byte-for-byte from `engine/kit/src/core/audio/`. Village cut them from the Mechvibes Cherry MX Brown PBT KeyJ recording, with separate downstroke and upstroke samples. The included MIT license accompanies the recordings. [Original sound pack](https://github.com/hainguyents13/mechvibes/tree/16afce45bd7cf12be399e2d1a8d20f221067f534/soundpacks/keyboard/cherrymx-brown-pbt)

This distribution contains compiled Village engine code and unpublished kit assets. Public distribution requires the owner's release decision.
