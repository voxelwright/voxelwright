# vox-sign

Our own drawing: a glyph set from `src/core/fonts/` laid flat as a web font.
Ten cells to the em, so one cell is 2 px at 20 px and one voxel at 40 px.

Build from `engine/kit` with `node tools/vox-text-export.mjs sign > glyphs.json` and
`python tools/vox-text-build.py glyphs.json fonts/vox-sign "Vox Sign" vox-sign` (needs fonttools and brotli).

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"engine/kit/tools/vox-text-build.py":"dce000ec93cee49b923176de30374c60","engine/kit/tools/vox-text-export.mjs":"56314cc0af7738c133733391e64d26ff"} -->
