# Voxelmorphism on the site

Every page is built from the kit. The vendored copy in `static/vendor/village/` comes from one
Village commit, pinned as `PIN` in `scripts/refresh-voxelmorphism.mjs` and written to
`kit/REVISION`. `test/kit.test.mjs` fails when the copy names no commit (a working-files refresh)
or when a page uses a `vx-` class the copy does not style.

## Refresh

With Node 24+ and Git, from the site checkout, with a Village clone that has the commit:

```sh
npm ci
node scripts/refresh-voxelmorphism.mjs ../Village            # the pinned commit
node scripts/refresh-voxelmorphism.mjs ../Village <commit>   # another commit; then update PIN
git diff --exit-code -- static/vendor/village
```

To change the kit and the site together, refresh from a Village checkout's working files with
`--worktree`, build, look, and repeat. Commit the kit change in Village first, then refresh from
that commit; the test refuses a working-files copy.

The script takes only the parts in `PARTS` (the kit's registry is cut to them, so esbuild drops the
rest) and their stylesheets, put together in the kit's own order (`tools/css.mjs`). A new part on
a page means a line in `PARTS`. It also bundles the Signal Desk's controller from the kit's
showcase, without the showcase's boot, and scopes the desk's stylesheet to `.signal-desk`.

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

IBM Plex Sans and Mono retain their upstream OFL files beside their WOFF2s. Vox Text is Village's original Sentence glyph set rendered as two WOFF2s. Its source is `engine/kit/src/core/fonts/sentence.js` and its build instructions are in `engine/kit/fonts/vox-text/README.md`. Village has not selected a public license for it.

The press and release WAVs are byte-for-byte from `engine/kit/src/core/audio/`. Village cut them from the Mechvibes Cherry MX Brown PBT KeyJ recording, with separate downstroke and upstroke samples. The included MIT license accompanies the recordings. [Original sound pack](https://github.com/hainguyents13/mechvibes/tree/16afce45bd7cf12be399e2d1a8d20f221067f534/soundpacks/keyboard/cherrymx-brown-pbt)

This distribution contains compiled Village engine code and unpublished kit assets. Public distribution requires the owner's release decision.
