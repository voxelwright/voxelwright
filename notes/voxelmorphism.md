# Signal Desk

The generator exports `voxelmorphismPage(site)` from `generator/voxelmorphism.mjs`. Register its return value once in the normal HTML/Markdown page list. The result has kind `voxelmorphism`, route `/voxelmorphism/` and twin `/voxelmorphism.md`.

## Source and refresh

The hardware, scope algorithm, case finishes, material textures, component models, lighting, motion, audio and renderer come from `the private source repository` PR 443 at `dda49b0f8f6353e1ed3bee76b15600f4e8cf4b31`. The integration keeps the desk in `engine/kit/showcase/index.html` from the workbench through its settings. The site template owns the heading, instructions, view switch and no-script description. The two material images are the exact files introduced in Village commit `01252909` under `engine/kit/showcase/materials/`.

With Node 24+ and Git, run these from the site checkout. Substitute a path to an existing Village clone.

```sh
npm ci
git -C ../Village fetch origin refs/pull/443/head
node scripts/refresh-voxelmorphism.mjs ../Village
git diff --exit-code -- static/vendor/village
```

The script reads the exact commit object even when the clone is on a different branch. A clone already containing the object works offline. Dependency installation and refresh are development steps. The ordinary site build copies the checked-in static files.

The refresh bundles the upstream desk controller, shared kit registry and WebGPU blocks renderer with the site's locked esbuild. It limits registration to the desk's component families, removes the showcase auto-start and console handle, scopes its stylesheet, and copies the base, rotary and instrument styles. Desktop and mobile layouts, the scanned trace, shell-specific sound EQ and plain-control behavior come from upstream. The output omits the catalog, demos, standalone HTML, dev tools, source maps and world scenes. When advancing the pin, also compare the upstream workbench markup against the generator template before refreshing.

## Runtime contract

- `/vendor/village/kit/src/index.js` exports `use`, `adopt`, `release`, `ready`, `getStage`, `live`, `fitInstrument`, `LIGHTS` and `sound`. These ESM entry points share one module instance per document.
- Load `/vendor/village/kit/voxelmorphism.css` for the kit parts. The base registry supports push buttons, latching lamp keys, sliders, rotary dials, toggles and the instrument backplane. The desk entry adds its special Scan key, fader and dial finish.
- A world hosting controls can call `await use(worldRenderer)` before its first `adopt(panel)`. The renderer implements Village’s `draw(frame, target)` contract. Pass `null` for plain behavior. This keeps the world on its existing device.
- A standalone panel can import `renderer` from `/vendor/village/blocks/renderer.js` and pass `renderer()` to `use`. Await `ready()` to determine whether a stage is available. On the desk, the query `?view=2d`, reduced motion, or an unavailable GPU retains plain controls. Sound requires opt-in.
- The generator adds the desk stylesheet and host module only on its own page. Include the entire `kit/shared/` directory beside the entry points, including the switch samples. Relative imports and recording URLs work on a static host.

## Asset provenance

IBM Plex Sans and Mono retain their upstream OFL files beside their WOFF2s. Vox Text is Village's original Sentence glyph set rendered as two WOFF2s. Its source is `engine/kit/src/core/fonts/sentence.js` and its build instructions are in `engine/kit/fonts/vox-text/README.md`. Village has not selected a public license for it.

The press and release WAVs are byte-for-byte from `engine/kit/src/core/audio/`. Village cut them from the Mechvibes Cherry MX Brown PBT KeyJ recording, with separate downstroke and upstroke samples. The included MIT license accompanies the recordings. [Original sound pack](https://github.com/hainguyents13/mechvibes/tree/16afce45bd7cf12be399e2d1a8d20f221067f534/soundpacks/keyboard/cherrymx-brown-pbt)

This distribution contains compiled Village engine code and unpublished kit assets. Public distribution requires the owner's release decision.
