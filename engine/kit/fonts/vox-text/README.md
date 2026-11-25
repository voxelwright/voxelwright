# Vox Text

Our own drawing: the Vox Sentence glyph set (`src/core/fonts/sentence.js`) laid flat as a web font.
Ten cells to the em, so one cell is 2 px at 20 px and one voxel at 40 px.

Build from `engine/kit` with `node tools/vox-text-export.mjs sentence > glyphs.json` and
`python tools/vox-text-build.py glyphs.json fonts/vox-text "Vox Text" vox-text --bold` (needs fonttools and brotli).

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"engine/kit/tools/vox-text-build.py":"dce000ec93cee49b923176de30374c60","engine/kit/tools/vox-text-export.mjs":"56314cc0af7738c133733391e64d26ff"} -->
