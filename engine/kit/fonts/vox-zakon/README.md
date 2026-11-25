# vox-zakon

Our own drawing: the Vox Zakon glyph sets from `src/core/fonts/` laid flat as web fonts.
Ten cells to the em, so one cell is 2 px at 20 px and one voxel at 40 px.

- `vox-zakon-400-normal.woff2`, "Vox Zakon": the display set (`zakon.js`), capitals 11 cells tall like Vox Block.
- `vox-zakon-text-400-normal.woff2`, "Vox Zakon Text": the key set (`zakontext` in `zakon-text.js`), capitals 7 cells tall like Vox Text.
- `vox-zakon-text-700-normal.woff2`, "Vox Zakon Text" bold: its bold set (`zakontextbold`), drawn rather than smeared.

Build from `engine/kit` (needs fonttools and brotli), each set exported with
`node tools/vox-text-export.mjs <set> > glyphs.json` and then:

    python tools/vox-text-build.py glyphs.json fonts/vox-zakon "Vox Zakon" vox-zakon                       # zakon
    python tools/vox-text-build.py glyphs.json fonts/vox-zakon "Vox Zakon Text" vox-zakon-text             # zakontext
    python tools/vox-text-build.py glyphs.json fonts/vox-zakon "Vox Zakon Text" vox-zakon-text --as-bold   # zakontextbold

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"engine/kit/tools/vox-text-build.py":"dce000ec93cee49b923176de30374c60","engine/kit/tools/vox-text-export.mjs":"56314cc0af7738c133733391e64d26ff"} -->
